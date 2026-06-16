const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { authenticate, signToken } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/auth/register ──
router.post('/register', async (req, res) => {
  try {
    const {
      email, password, role, first_name, last_name,
      phone, ahpra_number, provider_number,
      practice_name, practice_address, practice_state,
      specialty, qualifications, bio
    } = req.body;

    // Validate required fields
    if (!email || !password || !role || !first_name || !last_name) {
      return res.status(400).json({
        error: 'Missing required fields: email, password, role, first_name, last_name'
      });
    }

    // Validate role
    if (!['gp', 'specialist', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be: gp, specialist, or admin' });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Specialists must provide specialty
    if (role === 'specialist' && !specialty) {
      return res.status(400).json({ error: 'Specialists must provide a specialty' });
    }

    // Check if email already exists
    const existing = db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);
    const uid = uuid();

    // Insert user
    const result = db.run(`
      INSERT INTO users (uid, role, email, password_hash, first_name, last_name,
        phone, ahpra_number, provider_number, practice_name, practice_address,
        practice_state, specialty, qualifications, bio)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      uid, role, email.toLowerCase().trim(), password_hash,
      first_name.trim(), last_name.trim(),
      phone || null, ahpra_number || null, provider_number || null,
      practice_name || null, practice_address || null, practice_state || null,
      specialty || null, qualifications || null, bio || null
    ]);

    // Fetch created user (without password)
    const user = db.get('SELECT * FROM users WHERE uid = ?', [uid]);
    const { password_hash: _, ...safeUser } = user;

    // Generate token
    const token = signToken(user);

    // Audit log
    db.run(`
      INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['USER_REGISTERED', user.id, 'user', 'user', uid, JSON.stringify({ role, email })]);

    db.save();

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: safeUser
    });
  } catch (err) {
    console.error('[AUTH] Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /api/auth/login ──
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Find user
    const user = db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Block deactivated accounts
    if (user.is_active === 0) {
      return res.status(403).json({ error: 'Account deactivated. Contact an administrator.' });
    }

    // Update last login
    db.run('UPDATE users SET last_login_at = datetime(?) WHERE id = ?',
      [new Date().toISOString(), user.id]);
    db.save();

    // Generate token
    const token = signToken(user);
    const { password_hash, ...safeUser } = user;

    // Audit log
    db.run(`
      INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id)
      VALUES (?, ?, ?, ?, ?)
    `, ['USER_LOGIN', user.id, 'user', 'user', user.uid]);

    res.json({
      message: 'Login successful',
      token,
      user: safeUser
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── GET /api/auth/me ──
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// ── PATCH /api/auth/me ──
router.patch('/me', authenticate, (req, res) => {
  try {
    const allowed = [
      'first_name', 'last_name', 'phone', 'practice_name',
      'practice_address', 'practice_state', 'practice_lat', 'practice_lng',
      'bio', 'qualifications', 'avatar_url'
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

    updates.push("updated_at = datetime('now')");
    values.push(req.user.id);

    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    db.save();

    // Re-fetch updated user
    const user = db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const { password_hash, ...safeUser } = user;

    res.json({ message: 'Profile updated', user: safeUser });
  } catch (err) {
    console.error('[AUTH] Update error:', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

// ── PATCH /api/auth/me/email — Change email ──
router.patch('/me/email', authenticate, (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }
    const clean = email.toLowerCase().trim();
    const existing = db.get('SELECT id FROM users WHERE email = ? AND id != ?',
      [clean, req.user.id]);
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    db.run("UPDATE users SET email = ?, updated_at = datetime('now') WHERE id = ?",
      [clean, req.user.id]);
    db.save();

    const user = db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const { password_hash, ...safeUser } = user;
    res.json({ message: 'Email updated', user: safeUser });
  } catch (err) {
    console.error('[AUTH] Email change error:', err);
    res.status(500).json({ error: 'Email change failed' });
  }
});

// ── POST /api/auth/me/password — Change password ──
router.post('/me/password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const user = db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 12);
    db.run("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
      [hash, req.user.id]);
    db.save();

    db.run(`INSERT INTO audit_log (event, actor_id, actor_type, target_type, target_id)
            VALUES (?, ?, ?, ?, ?)`,
      ['PASSWORD_CHANGED', req.user.id, 'user', 'user', req.user.uid]);

    res.json({ message: 'Password updated' });
  } catch (err) {
    console.error('[AUTH] Password change error:', err);
    res.status(500).json({ error: 'Password change failed' });
  }
});

module.exports = router;
