const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// Current date/time in Australia/Sydney as { date:'YYYY-MM-DD', time:'HH:MM' }
function sydneyNow() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// Is a specialist within a scheduled slot right now?
function scheduledNow(specialistId) {
  const { date, time } = sydneyNow();
  const row = db.get(
    `SELECT COUNT(*) c FROM availability_slots
     WHERE specialist_id = ? AND slot_date = ? AND start_time <= ? AND end_time > ?`,
    [specialistId, date, time, time]);
  return row.c > 0;
}

// ── GET /api/specialists/slots — upcoming scheduled slots ──
router.get('/slots', requireRole('specialist'), (req, res) => {
  const { date } = sydneyNow();
  const slots = db.all(
    `SELECT * FROM availability_slots WHERE specialist_id = ? AND slot_date >= ?
     ORDER BY slot_date, start_time`, [req.user.id, date]);
  res.json({ slots });
});

// ── POST /api/specialists/slots — add one slot ──
router.post('/slots', requireRole('specialist'), (req, res) => {
  const { slot_date, start_time, end_time } = req.body;
  if (!slot_date || !start_time || !end_time || start_time >= end_time) {
    return res.status(400).json({ error: 'slot_date, start_time and end_time (start < end) required' });
  }
  db.run(`INSERT INTO availability_slots (specialist_id, slot_date, start_time, end_time)
          VALUES (?, ?, ?, ?)`, [req.user.id, slot_date, start_time, end_time]);
  db.save();
  res.status(201).json({ message: 'Slot added' });
});

// ── POST /api/specialists/slots/range — add a daily slot across a date range ──
router.post('/slots/range', requireRole('specialist'), (req, res) => {
  const { start_date, end_date, start_time, end_time } = req.body;
  if (!start_date || !end_date || !start_time || !end_time || start_time >= end_time) {
    return res.status(400).json({ error: 'start_date, end_date, start_time, end_time (start < end) required' });
  }
  let d = new Date(start_date + 'T00:00:00');
  const end = new Date(end_date + 'T00:00:00');
  if (isNaN(d) || isNaN(end) || d > end) return res.status(400).json({ error: 'Invalid date range' });
  let count = 0;
  while (d <= end && count < 90) {
    const ds = d.toISOString().slice(0, 10);
    db.run(`INSERT INTO availability_slots (specialist_id, slot_date, start_time, end_time)
            VALUES (?, ?, ?, ?)`, [req.user.id, ds, start_time, end_time]);
    d.setDate(d.getDate() + 1); count++;
  }
  db.save();
  res.status(201).json({ message: `Added ${count} day(s) of availability` });
});

// ── DELETE /api/specialists/slots/:id ──
router.delete('/slots/:id', requireRole('specialist'), (req, res) => {
  db.run('DELETE FROM availability_slots WHERE id = ? AND specialist_id = ?', [req.params.id, req.user.id]);
  db.save();
  res.json({ message: 'Slot removed' });
});

// ── GET /api/specialists/me/effective — manual OR scheduled availability ──
router.get('/me/effective', requireRole('specialist'), (req, res) => {
  const me = db.get('SELECT is_available FROM users WHERE id = ?', [req.user.id]);
  const sched = scheduledNow(req.user.id);
  res.json({
    manual_available: !!me.is_available,
    scheduled_now: sched,
    effective: !!me.is_available || sched
  });
});

// ── POST /api/specialists/toggle — Flip availability on/off ──
router.post('/toggle', requireRole('specialist'), (req, res) => {
  try {
    const current = db.get('SELECT is_available FROM users WHERE id = ?', [req.user.id]);
    const newState = current.is_available ? 0 : 1;

    db.run(`
      UPDATE users SET is_available = ?, available_updated_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `, [newState, req.user.id]);
    db.save();

    db.run(`
      INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['SPECIALIST_AVAILABILITY', req.user.id, 'user', 'user', req.user.uid,
      JSON.stringify({ is_available: !!newState })]);

    res.json({ message: 'Availability updated', is_available: !!newState });
  } catch (err) {
    console.error('[SPECIALISTS] Toggle error:', err);
    res.status(500).json({ error: 'Toggle failed' });
  }
});

// ── GET /api/specialists/me/stats — Quick stats for dashboard ──
router.get('/me/stats', requireRole('specialist'), (req, res) => {
  try {
    const total = db.get(
      'SELECT COUNT(*) as c FROM consults WHERE specialist_id = ?', [req.user.id]);
    const completed = db.get(
      'SELECT COUNT(*) as c FROM consults WHERE specialist_id = ? AND status = ?',
      [req.user.id, 'completed']);
    const me = db.get('SELECT is_available FROM users WHERE id = ?', [req.user.id]);

    res.json({
      total_consults: total.c,
      completed_consults: completed.c,
      is_available: !!me.is_available
    });
  } catch (err) {
    console.error('[SPECIALISTS] Stats error:', err);
    res.status(500).json({ error: 'Stats failed' });
  }
});

// ── GET /api/specialists/available — List available specialists (any role can view) ──
router.get('/available', (req, res) => {
  try {
    const { specialty } = req.query;
    let sql = `SELECT id, first_name, last_name, specialty, qualifications,
               practice_name, consult_rate_cents FROM users
               WHERE role = 'specialist' AND is_available = 1`;
    const params = [];
    if (specialty) {
      sql += ' AND specialty = ?';
      params.push(specialty);
    }
    const specialists = db.all(sql, params);
    res.json({ specialists });
  } catch (err) {
    console.error('[SPECIALISTS] Available error:', err);
    res.status(500).json({ error: 'Failed to list specialists' });
  }
});

module.exports = router;
