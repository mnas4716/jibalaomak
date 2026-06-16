const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { authenticate, requireRole, requireVerified } = require('../middleware/auth');
const { structureCase, generateSOAP, generateLetter, generateReferral, generatePatientHandout } = require('../services/ai');
const { sendConsultNotification } = require('../services/sms');
const { createVideoRoom } = require('../services/video');
const billing = require('../services/billing');

const router = express.Router();

// All consult routes require auth
router.use(authenticate);

// ── Helper: generate ref code like C-7421 ──
function genRefCode() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `C-${num}`;
}

// Current Sydney date/time { date:'YYYY-MM-DD', time:'HH:MM' } for availability checks.
function sydneyNow() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// ── POST /api/consults — Create new consult (GP only) ──
router.post('/', requireRole('gp'), (req, res) => {
  try {
    const {
      specialty, urgency, case_summary,
      patient_first_name, patient_last_name, patient_medicare, patient_irn,
      patient_dob, patient_sex, patient_initials,
      booking_type, scheduled_at,
      attachments
    } = req.body;

    if (!specialty || !urgency || !case_summary) {
      return res.status(400).json({
        error: 'Required: specialty, urgency, case_summary'
      });
    }

    if (!['routine', 'soon', 'urgent'].includes(urgency)) {
      return res.status(400).json({ error: 'Urgency must be: routine, soon, or urgent' });
    }

    const booking = ['on_call', 'scheduled'].includes(booking_type) ? booking_type : 'on_call';
    if (booking === 'scheduled' && !scheduled_at) {
      return res.status(400).json({ error: 'Scheduled consults require a scheduled_at date/time' });
    }

    // Derive initials from name if not provided
    const initials = patient_initials ||
      `${(patient_first_name || '?')[0]}${(patient_last_name || '?')[0]}`.toUpperCase();

    // Derive age from DOB for quick display
    let age = null;
    if (patient_dob) {
      const d = new Date(patient_dob);
      if (!isNaN(d)) age = Math.floor((Date.now() - d.getTime()) / (365.25 * 864e5));
    }

    const ref_code = genRefCode();

    db.run(`
      INSERT INTO consults (ref_code, gp_id, specialty, urgency, status,
        patient_initials, patient_first_name, patient_last_name, patient_medicare,
        patient_irn, patient_dob, patient_age, patient_sex,
        booking_type, scheduled_at, case_summary, attachments)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      ref_code, req.user.id, specialty, urgency,
      initials, patient_first_name || null, patient_last_name || null,
      patient_medicare || null, patient_irn || null, patient_dob || null,
      age, patient_sex || null,
      booking, scheduled_at || null,
      case_summary, JSON.stringify(attachments || [])
    ]);

    const consult = db.get('SELECT * FROM consults WHERE ref_code = ?', [ref_code]);

    // Audit
    db.run(`
      INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['CONSULT_CREATED', req.user.id, 'user', 'consult', ref_code,
      JSON.stringify({ specialty, urgency, booking })]);
    db.save();

    res.status(201).json({ message: 'Consult created', consult });
  } catch (err) {
    console.error('[CONSULTS] Create error:', err);
    res.status(500).json({ error: 'Failed to create consult' });
  }
});

// Statuses a GP may still edit/delete (not past/finished)
const EDITABLE_STATUSES = ['draft', 'structured', 'broadcasting', 'accepted'];

// ── PATCH /api/consults/:id — Modify a pending/active consult (GP, not past) ──
router.patch('/:id', requireRole('gp'), (req, res) => {
  try {
    const consult = db.get('SELECT * FROM consults WHERE id = ? AND gp_id = ?',
      [req.params.id, req.user.id]);
    if (!consult) return res.status(404).json({ error: 'Consult not found' });

    if (!EDITABLE_STATUSES.includes(consult.status)) {
      return res.status(403).json({
        error: `Cannot modify a ${consult.status} consult. Only pending/active consults can be edited.`
      });
    }

    const allowed = [
      'specialty', 'urgency', 'case_summary',
      'patient_first_name', 'patient_last_name', 'patient_medicare',
      'patient_irn', 'patient_dob', 'patient_sex',
      'booking_type', 'scheduled_at'
    ];
    const updates = [];
    const values = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(req.body[key]);
      }
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Recompute age if DOB changed
    if (req.body.patient_dob) {
      const d = new Date(req.body.patient_dob);
      if (!isNaN(d)) {
        updates.push('patient_age = ?');
        values.push(Math.floor((Date.now() - d.getTime()) / (365.25 * 864e5)));
      }
    }

    updates.push("updated_at = datetime('now')");
    values.push(consult.id);

    db.run(`UPDATE consults SET ${updates.join(', ')} WHERE id = ?`, values);
    db.save();

    db.run(`INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id)
            VALUES (?, ?, ?, ?, ?)`,
      ['CONSULT_MODIFIED', req.user.id, 'user', 'consult', consult.ref_code]);

    const updated = db.get('SELECT * FROM consults WHERE id = ?', [consult.id]);
    res.json({ message: 'Consult updated', consult: updated });
  } catch (err) {
    console.error('[CONSULTS] Modify error:', err);
    res.status(500).json({ error: 'Modify failed' });
  }
});

// ── DELETE /api/consults/:id — Delete a pending/active consult (GP, not past) ──
router.delete('/:id', requireRole('gp'), (req, res) => {
  try {
    const consult = db.get('SELECT * FROM consults WHERE id = ? AND gp_id = ?',
      [req.params.id, req.user.id]);
    if (!consult) return res.status(404).json({ error: 'Consult not found' });

    if (!EDITABLE_STATUSES.includes(consult.status) && consult.status !== 'active') {
      return res.status(403).json({
        error: `Cannot delete a ${consult.status} consult. Completed/past consults are permanent records.`
      });
    }

    // Clean up related rows
    db.run('DELETE FROM documents WHERE consult_id = ?', [consult.id]);
    db.run('DELETE FROM notes WHERE consult_id = ?', [consult.id]);
    db.run('DELETE FROM notifications WHERE consult_id = ?', [consult.id]);
    db.run('DELETE FROM billing_records WHERE consult_id = ?', [consult.id]);
    db.run('DELETE FROM consults WHERE id = ?', [consult.id]);
    db.save();

    db.run(`INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id)
            VALUES (?, ?, ?, ?, ?)`,
      ['CONSULT_DELETED', req.user.id, 'user', 'consult', consult.ref_code]);

    res.json({ message: 'Consult deleted' });
  } catch (err) {
    console.error('[CONSULTS] Delete error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── GET /api/consults — List consults (role-filtered) ──
router.get('/', (req, res) => {
  try {
    const { status, specialty, limit = 50 } = req.query;
    let sql = '';
    let params = [];

    if (req.user.role === 'gp') {
      sql = 'SELECT * FROM consults WHERE gp_id = ?';
      params = [req.user.id];
    } else if (req.user.role === 'specialist') {
      // Specialists see their assigned consults + broadcasting consults IN THEIR SPECIALTY
      sql = `SELECT * FROM consults WHERE (specialist_id = ?
             OR (status IN ('broadcasting','accepted','active') AND specialty = ?))`;
      params = [req.user.id, req.user.specialty || ''];
    } else {
      // Admin sees all
      sql = 'SELECT * FROM consults WHERE 1=1';
    }

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (specialty) {
      sql += ' AND specialty = ?';
      params.push(specialty);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const consults = db.all(sql, params).map(liteConsult);
    res.json({ consults, count: consults.length });
  } catch (err) {
    console.error('[CONSULTS] List error:', err);
    res.status(500).json({ error: 'Failed to list consults' });
  }
});

// Strip heavy base64 attachment payloads from list rows — keep only metadata so
// list responses stay small (this is what broke specialists seeing consults that
// had a big image/PDF attached). Full attachment data is served by GET /:id.
function liteConsult(c) {
  let atts = [];
  try { atts = JSON.parse(c.attachments || '[]'); } catch {}
  const meta = atts.map(a => ({ name: a.name, type: a.type, size: a.size }));
  return { ...c, attachments: meta, attachment_count: meta.length };
}
function declinedBy(c, specialistId) {
  try { return (JSON.parse(c.declined_specialist_ids || '[]')).includes(specialistId); }
  catch { return false; }
}

// ── GET /api/consults/incoming — specialist queue, split by specialty ──
// Availability-gated: an OFFLINE specialist sees nothing; toggling ON reveals all
// currently-broadcasting consults (incl. ones broadcast while they were offline).
// Declined consults are excluded (they move to /past for that specialist only).
router.get('/incoming', requireRole('specialist'), (req, res) => {
  try {
    const me = db.get('SELECT is_available, specialty FROM users WHERE id = ?', [req.user.id]);
    // effective availability = manual toggle OR within a scheduled slot now
    let available = !!me.is_available;
    if (!available) {
      try {
        const { date, time } = sydneyNow();
        const slot = db.get(
          `SELECT COUNT(*) c FROM availability_slots WHERE specialist_id = ? AND slot_date = ? AND start_time <= ? AND end_time > ?`,
          [req.user.id, date, time, time]);
        available = slot && slot.c > 0;
      } catch {}
    }
    if (!available) return res.json({ available: false, mine: [], others: [] });

    const rows = db.all(`SELECT * FROM consults WHERE status = 'broadcasting' ORDER BY COALESCE(broadcast_at, created_at) DESC LIMIT 100`);
    const mine = [], others = [];
    for (const c of rows) {
      if (declinedBy(c, req.user.id)) continue;
      (c.specialty === me.specialty ? mine : others).push(liteConsult(c));
    }
    res.json({ available: true, mine, others });
  } catch (err) {
    console.error('[CONSULTS] Incoming error:', err);
    res.status(500).json({ error: 'Failed to load incoming' });
  }
});

// ── GET /api/consults/past — specialist's completed + personally-declined cases ──
router.get('/past', requireRole('specialist'), (req, res) => {
  try {
    const completed = db.all(
      `SELECT * FROM consults WHERE specialist_id = ? AND status IN ('completed','active','accepted') ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]);
    const all = db.all(`SELECT * FROM consults WHERE status = 'broadcasting' ORDER BY created_at DESC LIMIT 100`);
    const declined = all.filter(c => declinedBy(c, req.user.id));
    res.json({
      completed: completed.map(liteConsult),
      declined: declined.map(liteConsult)
    });
  } catch (err) {
    console.error('[CONSULTS] Past error:', err);
    res.status(500).json({ error: 'Failed to load past' });
  }
});

// ── GET /api/consults/:id — Get single consult ──
router.get('/:id', (req, res) => {
  try {
    const consult = db.get('SELECT * FROM consults WHERE id = ? OR ref_code = ?',
      [req.params.id, req.params.id]);

    if (!consult) {
      return res.status(404).json({ error: 'Consult not found' });
    }

    // GPs see own, specialists see assigned or broadcasting, admin sees all
    if (req.user.role === 'gp' && consult.gp_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get related documents
    const documents = db.all('SELECT * FROM documents WHERE consult_id = ?', [consult.id]);
    // Get related notes
    const notes = db.all('SELECT * FROM notes WHERE consult_id = ? ORDER BY created_at DESC', [consult.id]);
    // Get billing
    const billing = db.get('SELECT * FROM billing_records WHERE consult_id = ?', [consult.id]);

    res.json({ consult, documents, notes, billing });
  } catch (err) {
    console.error('[CONSULTS] Get error:', err);
    res.status(500).json({ error: 'Failed to get consult' });
  }
});

// ── POST /api/consults/:id/structure — AI structures the case ──
router.post('/:id/structure', requireRole('gp'), async (req, res) => {
  try {
    const consult = db.get('SELECT * FROM consults WHERE id = ? AND gp_id = ?',
      [req.params.id, req.user.id]);

    if (!consult) {
      return res.status(404).json({ error: 'Consult not found' });
    }

    // Call AI service
    const structured = await structureCase(consult.case_summary, consult.specialty);

    // Update consult
    db.run(`
      UPDATE consults SET ai_structured_summary = ?, status = 'structured',
        structured_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `, [JSON.stringify(structured), consult.id]);
    db.save();

    // Audit
    db.run(`
      INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id)
      VALUES (?, ?, ?, ?, ?)
    `, ['CONSULT_STRUCTURED', req.user.id, 'ai', 'consult', consult.ref_code]);

    res.json({ message: 'Case structured by AI', structured });
  } catch (err) {
    console.error('[CONSULTS] Structure error:', err);
    res.status(500).json({ error: 'AI structuring failed' });
  }
});

// ── POST /api/consults/:id/broadcast — Send to specialists ──
router.post('/:id/broadcast', requireRole('gp'), async (req, res) => {
  try {
    const consult = db.get('SELECT * FROM consults WHERE id = ? AND gp_id = ?',
      [req.params.id, req.user.id]);

    if (!consult) {
      return res.status(404).json({ error: 'Consult not found' });
    }

    if (!['draft', 'structured'].includes(consult.status)) {
      return res.status(400).json({ error: `Cannot broadcast from status: ${consult.status}` });
    }

    // Current Sydney date/time for schedule-based availability
    const _fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney',
      year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false });
    const _p = Object.fromEntries(_fmt.formatToParts(new Date()).map(x => [x.type, x.value]));
    const nowDate = `${_p.year}-${_p.month}-${_p.day}`;
    const nowTime = `${_p.hour}:${_p.minute}`;

    // Available = active + matching specialty + (manual toggle ON OR within a scheduled slot now)
    const specialists = db.all(`
      SELECT * FROM users u
      WHERE u.role = 'specialist'
        AND u.specialty = ?
        AND u.is_active = 1
        AND (
          u.is_available = 1
          OR EXISTS (
            SELECT 1 FROM availability_slots s
            WHERE s.specialist_id = u.id AND s.slot_date = ?
              AND s.start_time <= ? AND s.end_time > ?
          )
        )
      ORDER BY u.verified DESC, u.updated_at DESC
      LIMIT 10
    `, [consult.specialty, nowDate, nowTime, nowTime]);

    // NOTE: we no longer hard-fail when nobody is online. The consult still goes
    // to 'broadcasting' so any matching specialist who comes online sees it in their inbox.

    // Update consult status
    db.run(`
      UPDATE consults SET status = 'broadcasting',
        broadcast_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `, [consult.id]);

    // Notify each specialist
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const notified = [];

    for (const spec of specialists) {
      const acceptUrl = `${appUrl}/?accept=${consult.id}`;

      // Create notification record
      db.run(`
        INSERT INTO notifications (recipient_id, type, title, body, consult_id)
        VALUES (?, ?, ?, ?, ?)
      `, [
        spec.id, 'incoming_consult',
        `${consult.specialty} consult — ${consult.urgency}`,
        `${consult.patient_initials}, ${consult.patient_age || ''}${consult.patient_sex || ''}. ${consult.case_summary.slice(0, 100)}`,
        consult.id
      ]);

      // Send SMS if specialist has phone
      if (spec.phone) {
        try {
          const smsResult = await sendConsultNotification(spec, {
            ...consult,
            gp_name: `${req.user.first_name} ${req.user.last_name}`
          }, acceptUrl);

          // Mark notification as SMS sent
          db.run(`
            UPDATE notifications SET sms_sent = 1
            WHERE consult_id = ? AND recipient_id = ?
          `, [consult.id, spec.id]);

          notified.push({ id: spec.id, name: `${spec.first_name} ${spec.last_name}`, sms: true });
        } catch (smsErr) {
          console.error(`[SMS] Failed for ${spec.email}:`, smsErr.message);
          notified.push({ id: spec.id, name: `${spec.first_name} ${spec.last_name}`, sms: false });
        }
      } else {
        notified.push({ id: spec.id, name: `${spec.first_name} ${spec.last_name}`, sms: false, reason: 'no phone' });
      }
    }

    db.save();

    // Audit
    db.run(`
      INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['CONSULT_BROADCAST', req.user.id, 'user', 'consult', consult.ref_code,
      JSON.stringify({ specialists_notified: notified.length })]);

    res.json({
      message: notified.length > 0
        ? `Broadcast live — notified ${notified.length} ${consult.specialty} specialist(s).`
        : `Broadcast live. No ${consult.specialty} specialist is online right now; it will appear in their inbox as soon as one becomes available.`,
      specialists_notified: notified,
      online_count: notified.length
    });
  } catch (err) {
    console.error('[CONSULTS] Broadcast error:', err);
    res.status(500).json({ error: 'Broadcast failed' });
  }
});

// ── POST /api/consults/:id/accept — Specialist accepts ──
router.post('/:id/accept', requireRole('specialist'), async (req, res) => {
  try {
    const consult = db.get('SELECT * FROM consults WHERE id = ? AND status = ?',
      [req.params.id, 'broadcasting']);

    if (!consult) {
      return res.status(404).json({ error: 'Consult not found or already taken' });
    }

    // Create video room
    const room = await createVideoRoom(consult.ref_code);

    // Assign specialist and update status
    db.run(`
      UPDATE consults SET specialist_id = ?, status = 'accepted',
        accepted_at = datetime('now'), video_room_url = ?, video_room_id = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `, [req.user.id, room.url, room.room_id, consult.id]);

    // Notify GP
    db.run(`
      INSERT INTO notifications (recipient_id, type, title, body, consult_id)
      VALUES (?, ?, ?, ?, ?)
    `, [
      consult.gp_id, 'consult_accepted',
      'Specialist accepted your consult',
      `Dr ${req.user.first_name} ${req.user.last_name} (${req.user.specialty}) accepted ${consult.ref_code}. Video room ready.`,
      consult.id
    ]);

    db.save();

    // Audit
    db.run(`
      INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['CONSULT_ACCEPTED', req.user.id, 'user', 'consult', consult.ref_code,
      JSON.stringify({ specialist: `${req.user.first_name} ${req.user.last_name}`, video_provider: room.provider })]);

    res.json({
      message: 'Consult accepted',
      video_room: room,
      consult_ref: consult.ref_code
    });
  } catch (err) {
    console.error('[CONSULTS] Accept error:', err);
    res.status(500).json({ error: 'Accept failed' });
  }
});

// ── POST /api/consults/:id/decline — Specialist declines ──
router.post('/:id/decline', requireRole('specialist'), (req, res) => {
  try {
    const consult = db.get('SELECT * FROM consults WHERE id = ? AND status = ?',
      [req.params.id, 'broadcasting']);

    if (!consult) {
      return res.status(404).json({ error: 'Consult not found or not broadcasting' });
    }

    // Per-specialist decline: add this specialist to the declined list. The consult
    // STAYS broadcasting for everyone else — it only disappears from THIS specialist's
    // incoming queue and shows under their Past instead.
    let declined = [];
    try { declined = JSON.parse(consult.declined_specialist_ids || '[]'); } catch {}
    if (!declined.includes(req.user.id)) declined.push(req.user.id);
    db.run(`UPDATE consults SET declined_specialist_ids = ?, updated_at = datetime('now') WHERE id = ?`,
      [JSON.stringify(declined), consult.id]);

    // Mark notification as actioned
    db.run(`
      UPDATE notifications SET read = 1, read_at = datetime('now')
      WHERE consult_id = ? AND recipient_id = ? AND type = 'incoming_consult'
    `, [consult.id, req.user.id]);
    db.save();

    // Audit
    db.run(`
      INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id)
      VALUES (?, ?, ?, ?, ?)
    `, ['CONSULT_DECLINED', req.user.id, 'user', 'consult', consult.ref_code]);

    res.json({ message: 'Consult declined' });
  } catch (err) {
    console.error('[CONSULTS] Decline error:', err);
    res.status(500).json({ error: 'Decline failed' });
  }
});

// ── POST /api/consults/:id/start — Mark consult as active (video started) ──
router.post('/:id/start', (req, res) => {
  try {
    const consult = db.get('SELECT * FROM consults WHERE id = ? AND status = ?',
      [req.params.id, 'accepted']);

    if (!consult) {
      return res.status(404).json({ error: 'Consult not found or not accepted' });
    }

    // Only GP or assigned specialist can start
    if (req.user.id !== consult.gp_id && req.user.id !== consult.specialist_id) {
      return res.status(403).json({ error: 'Not authorized to start this consult' });
    }

    db.run(`
      UPDATE consults SET status = 'active', started_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `, [consult.id]);
    db.save();

    // Audit
    db.run(`
      INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id)
      VALUES (?, ?, ?, ?, ?)
    `, ['CONSULT_STARTED', req.user.id, 'user', 'consult', consult.ref_code]);

    res.json({ message: 'Consult started', video_room_url: consult.video_room_url });
  } catch (err) {
    console.error('[CONSULTS] Start error:', err);
    res.status(500).json({ error: 'Start failed' });
  }
});

// ── POST /api/consults/:id/end — End consult + trigger AI doc generation ──
router.post('/:id/end', async (req, res) => {
  try {
    const consult = db.get('SELECT * FROM consults WHERE id = ? AND status = ?',
      [req.params.id, 'active']);

    if (!consult) {
      return res.status(404).json({ error: 'Consult not found or not active' });
    }

    if (req.user.id !== consult.gp_id && req.user.id !== consult.specialist_id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Calculate duration
    const startedAt = new Date(consult.started_at + 'Z');
    const duration_seconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);

    // Billing signals. Curbside simplification: patient is in the room for the whole
    // consult, so patient face-to-face time = total video-on (active) duration.
    const {
      consult_mode = 'video',
      location_type = 'in_rooms',
      is_initial_attendance = true,
      specialist_billing_mbs = true,
      transcript = ''
    } = req.body;
    const patient_present = true;
    const gp_in_room = true;
    const duration_patient_face_seconds = duration_seconds;

    // Update consult
    db.run(`
      UPDATE consults SET status = 'completed', ended_at = datetime('now'),
        duration_seconds = ?, duration_patient_face_seconds = ?,
        transcript = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [duration_seconds, duration_patient_face_seconds,
        transcript || consult.transcript || '', consult.id]);

    // ── MBS billing recommendation ──
    const rec = billing.recommend({
      patient_present, gp_in_room, specialist_billing_mbs,
      consult_mode, location_type,
      duration_patient_face_seconds,
      is_initial_attendance
    });

    const platformFeeCents = Math.round((rec.specialist_schedule_fee_cents || 0) * 0.15);

    db.run(`
      INSERT INTO billing_records (consult_id, billing_pathway, gp_mbs_item,
        gp_schedule_fee_cents, specialist_mbs_item, specialist_schedule_fee_cents,
        specialist_billing_mbs, patient_present, gp_in_room, consult_mode,
        duration_patient_face_seconds, location_type, is_initial_attendance,
        patient_consent_recorded, platform_fee_cents, decision_rule_applied,
        compliance_flags, billing_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recommended')
    `, [
      consult.id, rec.pathway, rec.gp_mbs_item, rec.gp_schedule_fee_cents,
      rec.specialist_mbs_item, rec.specialist_schedule_fee_cents,
      specialist_billing_mbs ? 1 : 0, 1, 1, consult_mode,
      duration_patient_face_seconds, location_type, is_initial_attendance ? 1 : 0,
      1, platformFeeCents, rec.decision_rule, JSON.stringify(rec.compliance_flags)
    ]);

    // Fetch GP and specialist info
    const gp = db.get('SELECT * FROM users WHERE id = ?', [consult.gp_id]);
    const spec = consult.specialist_id
      ? db.get('SELECT * FROM users WHERE id = ?', [consult.specialist_id])
      : null;

    const consultDetails = {
      specialty: consult.specialty,
      patient_initials: consult.patient_initials,
      patient_age: consult.patient_age,
      patient_sex: consult.patient_sex,
      gp_name: gp ? `${gp.first_name} ${gp.last_name}` : 'GP',
      specialist_name: spec ? `${spec.first_name} ${spec.last_name}` : 'Specialist',
      specialist_qualifications: spec?.qualifications || ''
    };

    // Use the full stored transcript (from live scribing) merged with any body transcript
    const fullTranscript = (consult.transcript || '') + (transcript || '');

    // Generate AI documents
    const soapNote = await generateSOAP(
      fullTranscript.trim() || 'No transcript available',
      consult.case_summary,
      consultDetails
    );

    // Save SOAP note
    db.run(`
      UPDATE consults SET soap_note = ? WHERE id = ?
    `, [JSON.stringify(soapNote), consult.id]);

    db.run(`
      INSERT INTO documents (consult_id, doc_type, content, generated_by, ai_model)
      VALUES (?, 'soap_note', ?, 'ai', ?)
    `, [consult.id, JSON.stringify(soapNote), process.env.AI_PROVIDER || 'mock']);

    // Generate letter to GP
    const letter = await generateLetter(soapNote, consultDetails);
    db.run(`
      INSERT INTO documents (consult_id, doc_type, content, generated_by, ai_model)
      VALUES (?, 'letter_to_gp', ?, 'ai', ?)
    `, [consult.id, letter.content, process.env.AI_PROVIDER || 'mock']);

    // Generate referral letter
    const referral = await generateReferral(soapNote, consultDetails);
    db.run(`
      INSERT INTO documents (consult_id, doc_type, content, generated_by, ai_model)
      VALUES (?, 'referral_letter', ?, 'ai', ?)
    `, [consult.id, referral.content, process.env.AI_PROVIDER || 'mock']);

    // Generate patient handout
    const handout = await generatePatientHandout(soapNote, consultDetails);
    db.run(`
      INSERT INTO documents (consult_id, doc_type, content, generated_by, ai_model)
      VALUES (?, 'patient_handout', ?, 'ai', ?)
    `, [consult.id, handout.content, process.env.AI_PROVIDER || 'mock']);

    // Notify both parties
    db.run(`
      INSERT INTO notifications (recipient_id, type, title, body, consult_id)
      VALUES (?, ?, ?, ?, ?)
    `, [consult.gp_id, 'consult_completed', 'Consult completed',
      `${consult.ref_code} completed. SOAP note and documents ready for review.`, consult.id]);

    if (consult.specialist_id) {
      db.run(`
        INSERT INTO notifications (recipient_id, type, title, body, consult_id)
        VALUES (?, ?, ?, ?, ?)
      `, [consult.specialist_id, 'consult_completed', 'Consult completed',
        `${consult.ref_code} completed. Please review and confirm billing.`, consult.id]);
    }

    db.save();

    // Audit
    db.run(`
      INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['CONSULT_COMPLETED', req.user.id, 'user', 'consult', consult.ref_code,
      JSON.stringify({ duration_seconds, documents_generated: 3 })]);

    res.json({
      message: 'Consult completed',
      duration_seconds,
      soap_note: soapNote,
      documents_generated: ['soap_note', 'letter_to_gp', 'referral_letter', 'patient_handout'],
      billing: {
        pathway: rec.pathway,
        gp_mbs_item: rec.gp_mbs_item,
        gp_fee: billing.dollars(rec.gp_schedule_fee_cents),
        specialist_mbs_item: rec.specialist_mbs_item,
        specialist_fee: billing.dollars(rec.specialist_schedule_fee_cents),
        tier: rec.tier_label,
        location: rec.location_label,
        eligible: rec.eligible,
        decision: rec.decision_rule,
        compliance_flags: rec.compliance_flags
      }
    });
  } catch (err) {
    console.error('[CONSULTS] End error:', err);
    res.status(500).json({ error: 'End consult failed' });
  }
});

// ── POST /api/consults/:id/rate — GP rates the consult ──
router.post('/:id/rate', requireRole('gp'), (req, res) => {
  try {
    const { rating, feedback } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be 1-5' });
    }

    const consult = db.get('SELECT * FROM consults WHERE id = ? AND gp_id = ? AND status = ?',
      [req.params.id, req.user.id, 'completed']);

    if (!consult) {
      return res.status(404).json({ error: 'Completed consult not found' });
    }

    db.run(`
      UPDATE consults SET gp_rating = ?, gp_feedback = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [rating, feedback || null, consult.id]);
    db.save();

    res.json({ message: 'Rating submitted', rating });
  } catch (err) {
    console.error('[CONSULTS] Rate error:', err);
    res.status(500).json({ error: 'Rating failed' });
  }
});

// ── POST /api/consults/:id/transcript — Append a transcript chunk (live scribing) ──
router.post('/:id/transcript', (req, res) => {
  try {
    const { speaker, text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'No transcript text' });
    }

    const consult = db.get('SELECT * FROM consults WHERE id = ?', [req.params.id]);
    if (!consult) {
      return res.status(404).json({ error: 'Consult not found' });
    }

    // Only GP or assigned specialist can add transcript
    if (req.user.id !== consult.gp_id && req.user.id !== consult.specialist_id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const speakerLabel = speaker || `${req.user.first_name} ${req.user.last_name}`;
    const line = `${speakerLabel}: ${text.trim()}\n`;
    const newTranscript = (consult.transcript || '') + line;

    db.run('UPDATE consults SET transcript = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [newTranscript, consult.id]);
    db.save();

    res.json({ ok: true });
  } catch (err) {
    console.error('[CONSULTS] Transcript error:', err);
    res.status(500).json({ error: 'Transcript append failed' });
  }
});

module.exports = router;
