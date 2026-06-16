const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('admin'));

// ── GET /api/admin/overview — dashboard stats ──
router.get('/overview', (req, res) => {
  try {
    const gps = db.get("SELECT COUNT(*) c FROM users WHERE role='gp'").c;
    const specialists = db.get("SELECT COUNT(*) c FROM users WHERE role='specialist'").c;
    const totalConsults = db.get('SELECT COUNT(*) c FROM consults').c;
    const activeConsults = db.get(
      "SELECT COUNT(*) c FROM consults WHERE status IN ('broadcasting','accepted','active')").c;
    const completed = db.get("SELECT COUNT(*) c FROM consults WHERE status='completed'").c;
    const availableNow = db.get(
      "SELECT COUNT(*) c FROM users WHERE role='specialist' AND is_available=1 AND is_active=1").c;

    res.json({
      gps, specialists, total_consults: totalConsults,
      active_consults: activeConsults, completed_consults: completed,
      specialists_online: availableNow
    });
  } catch (err) {
    console.error('[ADMIN] Overview error:', err);
    res.status(500).json({ error: 'Overview failed' });
  }
});

// ── GET /api/admin/users?role=gp|specialist — list users ──
router.get('/users', (req, res) => {
  try {
    const { role } = req.query;
    let sql = `SELECT id, uid, role, email, first_name, last_name, phone,
               ahpra_number, specialty, qualifications, practice_name,
               verified, is_active, is_available, created_at, last_login_at
               FROM users WHERE role != 'admin'`;
    const params = [];
    if (role) { sql += ' AND role = ?'; params.push(role); }
    sql += ' ORDER BY role, last_name';
    res.json({ users: db.all(sql, params) });
  } catch (err) {
    console.error('[ADMIN] Users error:', err);
    res.status(500).json({ error: 'Users list failed' });
  }
});

// ── PATCH /api/admin/users/:id/toggle-active — activate/deactivate ──
router.patch('/users/:id/toggle-active', (req, res) => {
  try {
    const user = db.get('SELECT id, is_active, email FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newState = user.is_active ? 0 : 1;
    db.run(`UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?`,
      [newState, user.id]);

    // If deactivating a specialist, also take them offline
    if (newState === 0) {
      db.run('UPDATE users SET is_available = 0 WHERE id = ?', [user.id]);
    }
    db.save();

    db.run(`
      INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [newState ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', req.user.id, 'user',
      'user', user.email, JSON.stringify({ is_active: !!newState })]);

    res.json({ message: newState ? 'Account activated' : 'Account deactivated', is_active: !!newState });
  } catch (err) {
    console.error('[ADMIN] Toggle error:', err);
    res.status(500).json({ error: 'Toggle failed' });
  }
});

// ── PATCH /api/admin/users/:id/verify — verify AHPRA ──
router.patch('/users/:id/verify', (req, res) => {
  try {
    const user = db.get('SELECT id, email FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    db.run(`UPDATE users SET verified = 1, verified_at = datetime('now'),
            verified_by = ? WHERE id = ?`, [req.user.id, user.id]);
    db.save();

    db.run(`INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id)
            VALUES (?, ?, ?, ?, ?)`,
      ['USER_VERIFIED', req.user.id, 'user', 'user', user.email]);

    res.json({ message: 'User verified' });
  } catch (err) {
    console.error('[ADMIN] Verify error:', err);
    res.status(500).json({ error: 'Verify failed' });
  }
});

// ── GET /api/admin/users/:id/consults — a user's consults ──
router.get('/users/:id/consults', (req, res) => {
  try {
    const user = db.get('SELECT id, role FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const col = user.role === 'gp' ? 'gp_id' : 'specialist_id';
    const consults = db.all(
      `SELECT * FROM consults WHERE ${col} = ? ORDER BY created_at DESC`, [user.id]);
    res.json({ consults });
  } catch (err) {
    console.error('[ADMIN] User consults error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// ── GET /api/admin/audit — recent audit log ──
router.get('/audit', (req, res) => {
  try {
    const logs = db.all('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50');
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: 'Audit failed' });
  }
});

module.exports = router;
