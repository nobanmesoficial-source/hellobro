const express = require('express');
const { getDb, saveDb, rowToObject, rowsToArray, dbExecBind } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '..', '..', 'uploads', 'stickers') });

// GET /api/v1/stickers/packs — список стикерпаков
router.get('/packs', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const packs = rowsToArray(dbExecBind(`
      SELECT sp.*, (SELECT COUNT(*) FROM stickers WHERE pack_id = sp.id) as sticker_count
      FROM sticker_packs sp ORDER BY sp.created_at DESC
    `));
    return res.json({ success: true, data: { packs } });
  } catch (e) {
    console.error('Get sticker packs error:', e);
    return res.json({ success: false, message: 'Ошибка загрузки стикерпаков' });
  }
});

// GET /api/v1/stickers/packs/:id — конкретный паак со стикерами
router.get('/packs/:id', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const pack = rowToObject(dbExecBind('SELECT * FROM sticker_packs WHERE id = ?', [parseInt(req.params.id)]));
    if (!pack) return res.json({ success: false, message: 'Паак не найден' });
    pack.stickers = rowsToArray(dbExecBind('SELECT * FROM stickers WHERE pack_id = ? ORDER BY id', [pack.id]));
    return res.json({ success: true, data: pack });
  } catch (e) {
    console.error('Get sticker pack error:', e);
    return res.json({ success: false, message: 'Ошибка загрузки пака' });
  }
});

// POST /api/v1/stickers/packs — создать паак (admin only)
router.post('/packs', authMiddleware, async (req, res) => {
  try {
    if (!req.user.is_admin) return res.json({ success: false, message: 'Только админ' });
    const db = await getDb();
    const { name, is_premium } = req.body;
    db.run('INSERT INTO sticker_packs (name, author_id, is_premium) VALUES (?, ?, ?)',
      [name || 'Unnamed Pack', req.user.id, is_premium ? 1 : 0]);
    saveDb();
    const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
    const pack = rowToObject(dbExecBind('SELECT * FROM sticker_packs WHERE id = ?', [id]));
    return res.json({ success: true, data: pack });
  } catch (e) {
    console.error('Create sticker pack error:', e);
    return res.json({ success: false, message: 'Ошибка создания пака' });
  }
});

// POST /api/v1/stickers/packs/:id/stickers — добавить стикер в паак
router.post('/packs/:id/stickers', authMiddleware, upload.single('sticker_file'), async (req, res) => {
  try {
    const db = await getDb();
    const packId = parseInt(req.params.id);
    const pack = rowToObject(dbExecBind('SELECT * FROM sticker_packs WHERE id = ?', [packId]));
    if (!pack) return res.json({ success: false, message: 'Паак не найден' });
    const fileUrl = req.file ? '/uploads/stickers/' + req.file.filename : null;
    const { emoji } = req.body;
    db.run('INSERT INTO stickers (pack_id, file_url, emoji) VALUES (?, ?, ?)',
      [packId, fileUrl, emoji || '😀']);
    saveDb();
    const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
    const sticker = rowToObject(dbExecBind('SELECT * FROM stickers WHERE id = ?', [id]));
    return res.json({ success: true, data: sticker });
  } catch (e) {
    console.error('Add sticker error:', e);
    return res.json({ success: false, message: 'Ошибка добавления стикера' });
  }
});

module.exports = router;
