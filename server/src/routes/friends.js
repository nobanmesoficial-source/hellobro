const express = require('express');
const { getDb, saveDb, dbExecBind } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function rowToObject(result) {
  if (!result || result.length === 0 || result[0].values.length === 0) return null;
  const cols = result[0].columns;
  const vals = result[0].values[0];
  const obj = {};
  cols.forEach((col, i) => obj[col] = vals[i]);
  return obj;
}

function rowsToArray(result) {
  if (!result || result.length === 0) return [];
  const cols = result[0].columns;
  return result[0].values.map(vals => {
    const obj = {};
    cols.forEach((col, i) => obj[col] = vals[i]);
    return obj;
  });
}

router.post('/request', authMiddleware, async (req, res) => {
  const { target_user_id } = req.body;
  if (!target_user_id) return res.json({ success: false, message: 'Укажите пользователя' });

  const db = await getDb();
  const existing = dbExecBind(
    'SELECT * FROM friend_requests WHERE sender_id = ? AND receiver_id = ?',
    [req.user.id, target_user_id]
  );

  if (existing.length > 0 && existing[0].values.length > 0) {
    return res.json({ success: false, message: 'Запрос уже отправлен' });
  }

  db.run('INSERT INTO friend_requests (sender_id, receiver_id) VALUES (?, ?)', [req.user.id, target_user_id]);
  saveDb();
  return res.json({ success: true, data: { message: 'Запрос дружбы отправлен' } });
});

router.post('/accept/:requestId', authMiddleware, async (req, res) => {
  const db = await getDb();
    const requestResult = dbExecBind('SELECT * FROM friend_requests WHERE id = ? AND receiver_id = ?',
      [parseInt(req.params.requestId), req.user.id]);
  const request = rowToObject(requestResult);
  if (!request) return res.json({ success: false, message: 'Запрос не найден' });

  db.run("UPDATE friend_requests SET status = 'accepted' WHERE id = ?", [parseInt(req.params.requestId)]);
  db.run('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)', [request.sender_id, req.user.id]);
  db.run('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)', [req.user.id, request.sender_id]);
  saveDb();
  return res.json({ success: true, data: { message: 'Запрос принят' } });
});

router.post('/decline/:requestId', authMiddleware, async (req, res) => {
  const db = await getDb();
  db.run("UPDATE friend_requests SET status = 'declined' WHERE id = ? AND receiver_id = ?",
    [parseInt(req.params.requestId), req.user.id]);
  saveDb();
  return res.json({ success: true, data: { message: 'Запрос отклонён' } });
});

router.get('/requests', authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = dbExecBind(`
    SELECT fr.*, u.username, u.display_name, u.profile_picture
    FROM friend_requests fr JOIN users u ON fr.sender_id = u.id
    WHERE fr.receiver_id = ? AND fr.status = 'pending'
  `, [req.user.id]);
  return res.json({ success: true, data: rowsToArray(result) });
});

router.get('/', authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = dbExecBind(`
    SELECT u.id, u.username, u.display_name, u.profile_picture, u.is_online, u.last_seen
    FROM friends f JOIN users u ON f.friend_id = u.id
    WHERE f.user_id = ?
  `, [req.user.id]);
  return res.json({ success: true, data: rowsToArray(result) });
});

module.exports = router;
