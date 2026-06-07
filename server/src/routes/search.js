const express = require('express');
const { getDb, saveDb, rowToObject, rowsToArray, getMessageFull, dbExecBind } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/messages', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const q = (req.query.q || '').toString().trim();
    const chatId = req.query.chat_id ? parseInt(req.query.chat_id) : null;
    const limit = Math.min(parseInt(req.query.limit || 50), 200);

    if (q.length < 2) {
      return res.json({ success: true, data: { messages: [], total: 0 } });
    }

    const like = `%${q.replace(/[%_]/g, m => '\\' + m)}%`;
    const params = [like];
    let where = 'm.is_deleted = 0 AND m.content LIKE ? ESCAPE \'\\\'';
    if (chatId) {
      where += ' AND m.chat_id = ?';
      params.push(chatId);
    }
    where += ' AND m.chat_id IN (SELECT chat_id FROM chat_participants WHERE user_id = ?)';
    params.push(req.user.id);

    const result = dbExecBind(`
      SELECT m.id, m.chat_id, m.sender_id, m.message_type, m.content, m.media_url,
             m.created_at, m.is_deleted, m.reply_to, m.edited_at,
             u.username as sender_username, u.display_name as sender_name,
             c.name as chat_name, c.type as chat_type
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      JOIN chats c ON m.chat_id = c.id
      WHERE ${where}
      ORDER BY m.created_at DESC
      LIMIT ?
    `, [...params, limit]);

    const messages = rowsToArray(result);

    const totalRes = dbExecBind(`
      SELECT COUNT(*) as cnt FROM messages m
      WHERE ${where}
    `, params);
    const total = totalRes.length > 0 ? totalRes[0].values[0][0] : 0;

    return res.json({ success: true, data: { messages, total, query: q } });
  } catch (e) {
    console.error('Search messages error:', e);
    return res.json({ success: false, message: 'Ошибка поиска' });
  }
});

router.get('/chats', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const q = (req.query.q || '').toString().trim();
    if (q.length < 1) {
      return res.json({ success: true, data: { chats: [] } });
    }

    const like = `%${q.replace(/[%_]/g, m => '\\' + m)}%`;

    const memberNamesRes = dbExecBind(`
      SELECT u.id, u.username, u.display_name, u.profile_picture, u.is_online, u.last_seen
      FROM users u
      WHERE (u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')
        AND u.id != ?
        AND u.is_blocked = 0
      LIMIT 25
    `, [like, like, req.user.id]);
    const users = rowsToArray(memberNamesRes);

    const chatNamesRes = dbExecBind(`
      SELECT c.*,
        (SELECT content FROM messages WHERE chat_id = c.id AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE chat_id = c.id AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1) as last_message_time,
        (SELECT message_type FROM messages WHERE chat_id = c.id AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1) as last_message_type,
        (SELECT COUNT(*) FROM chat_participants WHERE chat_id = c.id) as members_count
      FROM chats c
      JOIN chat_participants cp ON c.id = cp.chat_id
      WHERE cp.user_id = ? AND cp.is_archived = 0
        AND (c.name LIKE ? ESCAPE '\\' OR c.id IN (
          SELECT m.chat_id FROM messages m
          WHERE m.is_deleted = 0 AND m.content LIKE ? ESCAPE '\\'
            AND m.chat_id IN (SELECT chat_id FROM chat_participants WHERE user_id = ?)
        ))
      ORDER BY c.is_saved DESC, last_message_time DESC
      LIMIT 25
    `, [req.user.id, like, like, req.user.id]);
    const chats = rowsToArray(chatNamesRes).map(c => {
      c.is_archived = false;
      c.is_saved = c.is_saved == 1;
      c.subscribers_count = c.members_count;
      return c;
    });

    return res.json({ success: true, data: { users, chats, query: q } });
  } catch (e) {
    console.error('Search chats error:', e);
    return res.json({ success: false, message: 'Ошибка поиска' });
  }
});

module.exports = router;
