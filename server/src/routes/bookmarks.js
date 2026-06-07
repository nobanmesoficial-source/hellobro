const express = require('express');
const { getDb, saveDb, rowToObject, rowsToArray, getMessageFull, dbExecBind } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const limit = Math.min(parseInt(req.query.limit || 100), 500);
    const offset = parseInt(req.query.offset || 0);

    const result = dbExecBind(`
      SELECT b.id as bookmark_id, b.created_at as bookmarked_at,
             m.*,
             u.username as sender_username, u.display_name as sender_name,
             c.name as chat_name, c.type as chat_type
      FROM bookmarks b
      JOIN messages m ON b.message_id = m.id
      JOIN users u ON m.sender_id = u.id
      JOIN chats c ON m.chat_id = c.id
      WHERE b.user_id = ? AND m.is_deleted = 0
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `, [req.user.id, limit, offset]);

    const totalRes = dbExecBind(
      'SELECT COUNT(*) as cnt FROM bookmarks b JOIN messages m ON b.message_id = m.id WHERE b.user_id = ? AND m.is_deleted = 0',
      [req.user.id]
    );
    const total = totalRes.length > 0 ? totalRes[0].values[0][0] : 0;

    return res.json({
      success: true,
      data: {
        bookmarks: rowsToArray(result),
        total,
        has_more: offset + rowsToArray(result).length < total,
      },
    });
  } catch (e) {
    console.error('List bookmarks error:', e);
    return res.json({ success: false, message: 'Ошибка загрузки закладок' });
  }
});

router.post('/messages/:id/bookmark', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const messageId = parseInt(req.params.id);
    const msgRes = dbExecBind('SELECT chat_id, is_deleted FROM messages WHERE id = ?', [messageId]);
    const msg = rowToObject(msgRes);
    if (!msg) return res.json({ success: false, message: 'Сообщение не найдено' });
    if (msg.is_deleted) return res.json({ success: false, message: 'Сообщение удалено' });

    const participantRes = dbExecBind('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?',
      [msg.chat_id, req.user.id]);
    if (participantRes.length === 0 || participantRes[0].values.length === 0) {
      return res.json({ success: false, message: 'Нет доступа к сообщению' });
    }

    const existing = dbExecBind('SELECT id FROM bookmarks WHERE user_id = ? AND message_id = ?',
      [req.user.id, messageId]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      return res.json({ success: true, data: { bookmarked: true, already: true } });
    }
    db.run('INSERT INTO bookmarks (user_id, message_id) VALUES (?, ?)', [req.user.id, messageId]);
    saveDb();
    return res.json({ success: true, data: { bookmarked: true } });
  } catch (e) {
    console.error('Bookmark add error:', e);
    return res.json({ success: false, message: 'Ошибка добавления закладки' });
  }
});

router.delete('/messages/:id/bookmark', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const messageId = parseInt(req.params.id);
    db.run('DELETE FROM bookmarks WHERE user_id = ? AND message_id = ?', [req.user.id, messageId]);
    saveDb();
    return res.json({ success: true, data: { bookmarked: false } });
  } catch (e) {
    console.error('Bookmark remove error:', e);
    return res.json({ success: false, message: 'Ошибка удаления закладки' });
  }
});

router.get('/messages/:id/is-bookmarked', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const messageId = parseInt(req.params.id);
    const result = dbExecBind('SELECT 1 FROM bookmarks WHERE user_id = ? AND message_id = ?',
      [req.user.id, messageId]);
    return res.json({ success: true, data: { bookmarked: result.length > 0 && result[0].values.length > 0 } });
  } catch (e) {
    return res.json({ success: false, message: 'Ошибка' });
  }
});

module.exports = router;
