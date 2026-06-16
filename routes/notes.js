const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// ── POST /api/notes/:consultId — add a note ──
router.post('/:consultId', (req, res) => {
  try {
    const { content, note_type } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Note content required' });
    }
    const consult = db.get('SELECT * FROM consults WHERE id = ?', [req.params.consultId]);
    if (!consult) return res.status(404).json({ error: 'Consult not found' });

    // GP owner, assigned specialist, or admin may add
    const ok = req.user.role === 'admin' ||
      consult.gp_id === req.user.id || consult.specialist_id === req.user.id;
    if (!ok) return res.status(403).json({ error: 'Not authorized' });

    const type = ['clinical', 'internal', 'follow_up', 'admin'].includes(note_type)
      ? note_type : 'clinical';

    db.run(`INSERT INTO notes (consult_id, author_id, content, note_type)
            VALUES (?, ?, ?, ?)`,
      [consult.id, req.user.id, content.trim(), type]);
    db.save();

    res.status(201).json({ message: 'Note added' });
  } catch (err) {
    console.error('[NOTES] Add error:', err);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// ── GET /api/notes/:consultId — list notes ──
router.get('/:consultId', (req, res) => {
  try {
    const notes = db.all(`
      SELECT n.*, u.first_name, u.last_name, u.role
      FROM notes n JOIN users u ON u.id = n.author_id
      WHERE n.consult_id = ? ORDER BY n.created_at DESC`, [req.params.consultId]);
    res.json({ notes });
  } catch (err) {
    console.error('[NOTES] List error:', err);
    res.status(500).json({ error: 'Failed to list notes' });
  }
});

module.exports = router;
