const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const billing = require('../services/billing');
const claiming = require('../services/claiming');

const router = express.Router();
router.use(authenticate);

// ── GET /api/billing/history — role-aware list of billed consults ──
router.get('/history', (req, res) => {
  try {
    let where = '1=1';
    const params = [];
    if (req.user.role === 'gp') { where = 'c.gp_id = ?'; params.push(req.user.id); }
    else if (req.user.role === 'specialist') { where = 'c.specialist_id = ?'; params.push(req.user.id); }

    const rows = db.all(`
      SELECT br.*, c.ref_code, c.specialty, c.patient_first_name, c.patient_last_name,
             c.patient_initials, c.created_at as consult_created
      FROM billing_records br
      JOIN consults c ON c.id = br.consult_id
      WHERE ${where}
      ORDER BY br.created_at DESC LIMIT 100
    `, params);

    const items = rows.map(r => ({
      ...r,
      gp_fee: billing.dollars(r.gp_schedule_fee_cents),
      specialist_fee: billing.dollars(r.specialist_schedule_fee_cents),
      platform_fee: billing.dollars(r.platform_fee_cents),
      patient: (r.patient_first_name || r.patient_last_name)
        ? `${r.patient_first_name || ''} ${r.patient_last_name || ''}`.trim()
        : r.patient_initials,
      compliance_flags: JSON.parse(r.compliance_flags || '[]')
    }));
    res.json({ items });
  } catch (err) {
    console.error('[BILLING] History error:', err);
    res.status(500).json({ error: 'History failed' });
  }
});

// ── GET /api/billing/stats — role-aware billing stats ──
router.get('/stats', (req, res) => {
  try {
    let where = '1=1';
    const params = [];
    if (req.user.role === 'gp') { where = 'c.gp_id = ?'; params.push(req.user.id); }
    else if (req.user.role === 'specialist') { where = 'c.specialist_id = ?'; params.push(req.user.id); }

    const rows = db.all(`
      SELECT br.* FROM billing_records br
      JOIN consults c ON c.id = br.consult_id
      WHERE ${where}
    `, params);

    let gpTotal = 0, specTotal = 0, platformTotal = 0, pesCount = 0, flagged = 0;
    const byPathway = {};
    for (const r of rows) {
      gpTotal += r.gp_schedule_fee_cents || 0;
      specTotal += r.specialist_schedule_fee_cents || 0;
      platformTotal += r.platform_fee_cents || 0;
      if (r.billing_pathway === 'PES') pesCount++;
      if (JSON.parse(r.compliance_flags || '[]').length) flagged++;
      byPathway[r.billing_pathway] = (byPathway[r.billing_pathway] || 0) + 1;
    }

    // Specialist payout = their fee minus platform fee
    const specPayout = specTotal - platformTotal;

    res.json({
      count: rows.length,
      pes_count: pesCount,
      flagged_count: flagged,
      gp_billed: billing.dollars(gpTotal),
      gp_billed_cents: gpTotal,
      specialist_billed: billing.dollars(specTotal),
      specialist_billed_cents: specTotal,
      specialist_payout: billing.dollars(specPayout),
      platform_fees: billing.dollars(platformTotal),
      total_mbs: billing.dollars(gpTotal + specTotal),
      by_pathway: byPathway
    });
  } catch (err) {
    console.error('[BILLING] Stats error:', err);
    res.status(500).json({ error: 'Stats failed' });
  }
});

// ── GET /api/billing/:consultId — billing record for a consult ──
router.get('/:consultId', (req, res) => {
  try {
    const rec = db.get('SELECT * FROM billing_records WHERE consult_id = ?', [req.params.consultId]);
    if (!rec) return res.status(404).json({ error: 'No billing record yet' });

    res.json({
      billing: {
        ...rec,
        gp_fee: billing.dollars(rec.gp_schedule_fee_cents),
        specialist_fee: billing.dollars(rec.specialist_schedule_fee_cents),
        platform_fee: billing.dollars(rec.platform_fee_cents),
        compliance_flags: JSON.parse(rec.compliance_flags || '[]')
      }
    });
  } catch (err) {
    console.error('[BILLING] Get error:', err);
    res.status(500).json({ error: 'Failed to load billing' });
  }
});

// ── POST /api/billing/:consultId/confirm — GP or specialist confirms their item ──
router.post('/:consultId/confirm', (req, res) => {
  try {
    const rec = db.get('SELECT * FROM billing_records WHERE consult_id = ?', [req.params.consultId]);
    if (!rec) return res.status(404).json({ error: 'No billing record' });

    const consult = db.get('SELECT * FROM consults WHERE id = ?', [req.params.consultId]);
    if (!consult) return res.status(404).json({ error: 'Consult not found' });

    if (req.user.role === 'gp' && consult.gp_id === req.user.id) {
      db.run("UPDATE billing_records SET gp_item_confirmed = 1, updated_at = datetime('now') WHERE id = ?", [rec.id]);
    } else if (req.user.role === 'specialist' && consult.specialist_id === req.user.id) {
      db.run("UPDATE billing_records SET specialist_item_confirmed = 1, updated_at = datetime('now') WHERE id = ?", [rec.id]);
    } else {
      return res.status(403).json({ error: 'Not authorized to confirm this billing' });
    }

    // If both confirmed, mark submitted
    const updated = db.get('SELECT * FROM billing_records WHERE id = ?', [rec.id]);
    if (updated.gp_item_confirmed && updated.specialist_item_confirmed) {
      db.run("UPDATE billing_records SET billing_status = 'confirmed' WHERE id = ?", [rec.id]);
    }
    db.save();

    db.run(`INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id, metadata)
            VALUES (?, ?, ?, ?, ?, ?)`,
      ['BILLING_CONFIRMED', req.user.id, 'user', 'consult', consult.ref_code,
       JSON.stringify({ role: req.user.role })]);

    res.json({ message: 'Billing item confirmed' });
  } catch (err) {
    console.error('[BILLING] Confirm error:', err);
    res.status(500).json({ error: 'Confirm failed' });
  }
});

// ── POST /api/billing/:consultId/recompute — re-run engine with new location/initial ──
router.post('/:consultId/recompute', (req, res) => {
  try {
    const rec = db.get('SELECT * FROM billing_records WHERE consult_id = ?', [req.params.consultId]);
    if (!rec) return res.status(404).json({ error: 'No billing record' });

    const { location_type = rec.location_type, is_initial_attendance } = req.body;
    const init = is_initial_attendance !== undefined ? is_initial_attendance : !!rec.is_initial_attendance;

    const result = billing.recommend({
      patient_present: !!rec.patient_present,
      gp_in_room: !!rec.gp_in_room,
      specialist_billing_mbs: !!rec.specialist_billing_mbs,
      consult_mode: rec.consult_mode,
      location_type,
      duration_patient_face_seconds: rec.duration_patient_face_seconds,
      is_initial_attendance: init
    });

    db.run(`UPDATE billing_records SET billing_pathway = ?, gp_mbs_item = ?,
            gp_schedule_fee_cents = ?, specialist_mbs_item = ?, specialist_schedule_fee_cents = ?,
            location_type = ?, is_initial_attendance = ?, decision_rule_applied = ?,
            compliance_flags = ?, updated_at = datetime('now') WHERE id = ?`,
      [result.pathway, result.gp_mbs_item, result.gp_schedule_fee_cents,
       result.specialist_mbs_item, result.specialist_schedule_fee_cents,
       location_type, init ? 1 : 0, result.decision_rule,
       JSON.stringify(result.compliance_flags), rec.id]);
    db.save();

    res.json({ message: 'Recomputed', billing: result });
  } catch (err) {
    console.error('[BILLING] Recompute error:', err);
    res.status(500).json({ error: 'Recompute failed' });
  }
});

// ── POST /api/billing/:consultId/submit — submit MBS claims to the channel ──
// Builds TWO claims (GP PES + specialist video), one per provider, per Tyro's model.
router.post('/:consultId/submit', async (req, res) => {
  try {
    const rec = db.get('SELECT * FROM billing_records WHERE consult_id = ?', [req.params.consultId]);
    if (!rec) return res.status(404).json({ error: 'No billing record' });
    if (rec.billing_pathway !== 'PES') {
      return res.status(400).json({ error: `Only PES claims are auto-submittable here (pathway is ${rec.billing_pathway}).` });
    }

    const consult = db.get('SELECT * FROM consults WHERE id = ?', [req.params.consultId]);
    const gp = db.get('SELECT * FROM users WHERE id = ?', [consult.gp_id]);
    const spec = consult.specialist_id ? db.get('SELECT * FROM users WHERE id = ?', [consult.specialist_id]) : null;

    // Only GP, assigned specialist or admin can submit
    if (!(req.user.role === 'admin' || req.user.id === consult.gp_id || req.user.id === consult.specialist_id)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const bulkBill = req.body.bulk_bill !== false; // default bulk-bill
    const claimType = bulkBill ? 'bulk-bill' : 'patient';
    const dos = (consult.ended_at || new Date().toISOString()).slice(0, 10);
    const patient = {
      firstName: consult.patient_first_name, lastName: consult.patient_last_name,
      dob: consult.patient_dob, medicare: consult.patient_medicare, irn: consult.patient_irn
    };

    const results = {};
    const flags = [];

    // GP PES claim
    if (rec.gp_mbs_item && gp?.provider_number) {
      const r = await claiming.submitClaim({
        claimType, reference: consult.ref_code, providerNumber: gp.provider_number, patient,
        items: [{ itemNumber: rec.gp_mbs_item, dateOfService: dos, feeCents: rec.gp_schedule_fee_cents }]
      });
      db.run('UPDATE billing_records SET gp_claim_id = ?, gp_claim_status = ? WHERE id = ?',
        [r.claimId, r.status, rec.id]);
      results.gp = r;
    } else if (!gp?.provider_number) flags.push('GP has no provider number on file');

    // Specialist video claim
    if (rec.specialist_mbs_item && spec?.provider_number) {
      const r = await claiming.submitClaim({
        claimType, reference: consult.ref_code, providerNumber: spec.provider_number, patient,
        items: [{ itemNumber: rec.specialist_mbs_item, dateOfService: dos, feeCents: rec.specialist_schedule_fee_cents }]
      });
      db.run('UPDATE billing_records SET specialist_claim_id = ?, specialist_claim_status = ? WHERE id = ?',
        [r.claimId, r.status, rec.id]);
      results.specialist = r;
    } else if (!spec?.provider_number) flags.push('Specialist has no provider number on file');

    db.run("UPDATE billing_records SET billing_status = 'submitted', claim_submitted_at = datetime('now') WHERE id = ?", [rec.id]);
    db.save();

    db.run(`INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id, metadata)
            VALUES (?, ?, ?, ?, ?, ?)`,
      ['CLAIM_SUBMITTED', req.user.id, 'user', 'consult', consult.ref_code,
       JSON.stringify({ via: claiming.providerName, claimType, results })]);

    res.json({ message: `Submitted via ${claiming.providerName}`, claimType, results, warnings: flags });
  } catch (err) {
    console.error('[BILLING] Submit error:', err);
    res.status(500).json({ error: err.message || 'Submission failed' });
  }
});

// ── POST /api/billing/:consultId/refresh-status — poll claim outcomes ──
router.post('/:consultId/refresh-status', async (req, res) => {
  try {
    const rec = db.get('SELECT * FROM billing_records WHERE consult_id = ?', [req.params.consultId]);
    if (!rec) return res.status(404).json({ error: 'No billing record' });

    const out = {};
    if (rec.gp_claim_id) {
      const s = await claiming.getStatus(rec.gp_claim_id);
      db.run('UPDATE billing_records SET gp_claim_status = ? WHERE id = ?', [s.status, rec.id]);
      out.gp = s.status;
    }
    if (rec.specialist_claim_id) {
      const s = await claiming.getStatus(rec.specialist_claim_id);
      db.run('UPDATE billing_records SET specialist_claim_status = ? WHERE id = ?', [s.status, rec.id]);
      out.specialist = s.status;
    }
    // If both approved/paid, mark record paid
    const fresh = db.get('SELECT * FROM billing_records WHERE id = ?', [rec.id]);
    const done = (st) => ['approved', 'paid'].includes((st || '').toLowerCase());
    if (done(fresh.gp_claim_status) && (!fresh.specialist_claim_id || done(fresh.specialist_claim_status))) {
      db.run("UPDATE billing_records SET billing_status = 'paid' WHERE id = ?", [rec.id]);
    }
    db.save();
    res.json({ statuses: out });
  } catch (err) {
    console.error('[BILLING] Status error:', err);
    res.status(500).json({ error: err.message || 'Status check failed' });
  }
});

module.exports = router;
