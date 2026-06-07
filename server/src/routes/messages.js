const express = require('express');
const { getDb, saveDb, rowToObject, rowsToArray, getMessageFull, dbExecBind } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '..', '..', 'uploads') });

function broadcast(io, chatId, event, data) {
  if (!io) return;
  io.to(`chat:${chatId}`).emit(event, data);
}

router.post('/:chatId/messages', authMiddleware, upload.single('media_file'), async (req, res) => {
  try {
    const db = await getDb();
    const { chatId } = req.params;
    const { message_type, content, encrypted_content, session_key, sticker_id, duration, reply_to } = req.body;

    const isParticipant = dbExecBind(
      'SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?',
      [parseInt(chatId), req.user.id]
    );
    if (isParticipant.length === 0 || isParticipant[0].values.length === 0) {
      return res.json({ success: false, message: 'Вы не участник чата' });
    }

    const mediaUrl = req.file ? '/uploads/' + req.file.filename : null;
    const replyToId = reply_to ? parseInt(reply_to) : null;

    db.run(`
      INSERT INTO messages (chat_id, sender_id, message_type, content, encrypted_content, session_key, media_url, sticker_id, duration, reply_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [parseInt(chatId), req.user.id, message_type || 'text', content || null, encrypted_content || null, session_key || null, mediaUrl, sticker_id || null, duration || null, replyToId]);

    const idResult = db.exec('SELECT last_insert_rowid() as id');
    const messageId = idResult[0].values[0][0];

    db.run('INSERT INTO message_status (message_id, user_id, status) VALUES (?, ?, ?)', [messageId, req.user.id, 'sent']);

    const participantsResult = dbExecBind(
      'SELECT user_id FROM chat_participants WHERE chat_id = ? AND user_id != ?',
      [parseInt(chatId), req.user.id]
    );
    const participants = rowsToArray(participantsResult);
    for (const p of participants) {
      db.run('INSERT INTO message_status (message_id, user_id, status) VALUES (?, ?, ?)', [messageId, p.user_id, 'sent']);
    }
    saveDb();

    const message = getMessageFull(db, messageId);
    const io = req.app.get('io');
    if (io) {
      for (const p of participants) {
        io.to(`user:${p.user_id}`).emit('new_message', message);
      }
      io.to(`user:${req.user.id}`).emit('new_message', message);
    }

    return res.json({ success: true, data: message });
  } catch (e) {
    console.error('Send message error:', e);
    return res.json({ success: false, message: 'Ошибка отправки сообщения' });
  }
});

router.get('/:chatId/messages', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const limit = parseInt(req.query.limit || 50);
    const offset = parseInt(req.query.offset || 0);

    const result = dbExecBind(`
      SELECT m.id FROM messages m
      WHERE m.chat_id = ?
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `, [parseInt(req.params.chatId), limit, offset]);

    if (result.length === 0 || result[0].values.length === 0) {
      return res.json({ success: true, data: { messages: [], pagination: { has_more: false, offset: 0 } } });
    }

    const ids = result[0].values.map(r => r[0]);
    const placeholders = ids.map(() => '?').join(',');
    const msgsResult = dbExecBind(`
      SELECT m.*, u.username as sender_username, u.display_name as sender_name
      FROM messages m JOIN users u ON m.sender_id = u.id
      WHERE m.id IN (${placeholders})
      ORDER BY m.created_at ASC
    `, ids);

    const messages = rowsToArray(msgsResult).map(m => {
      const reactionsRes = dbExecBind('SELECT emoji, user_id FROM message_reactions WHERE message_id = ?', [m.id]);
      const reactions = {};
      for (const r of rowsToArray(reactionsRes)) {
        if (!reactions[r.emoji]) reactions[r.emoji] = [];
        reactions[r.emoji].push(r.user_id);
      }
      m.reactions = reactions;

      if (m.reply_to) {
        const replyRes = dbExecBind(`
          SELECT m.id, m.sender_id, m.content, m.message_type, m.is_deleted, u.display_name as sender_name
          FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
        `, [m.reply_to]);
        m.reply_to_message = rowToObject(replyRes);
      }
      return m;
    });

    const totalRes = dbExecBind('SELECT COUNT(*) as cnt FROM messages WHERE chat_id = ?', [parseInt(req.params.chatId)]);
    const total = totalRes[0].values[0][0];
    const hasMore = offset + messages.length < total;

    return res.json({
      success: true,
      data: {
        messages,
        pagination: { has_more: hasMore, offset: offset + messages.length, total },
      },
    });
  } catch (e) {
    console.error('Get messages error:', e);
    return res.json({ success: false, message: 'Ошибка загрузки сообщений' });
  }
});

router.put('/messages/:id', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const { content } = req.body;
    const messageId = parseInt(req.params.id);
    const msgResult = dbExecBind('SELECT * FROM messages WHERE id = ? AND sender_id = ?',
      [messageId, req.user.id]);
    const msg = rowToObject(msgResult);
    if (!msg) return res.json({ success: false, message: 'Сообщение не найдено' });
    if (msg.is_deleted) return res.json({ success: false, message: 'Сообщение удалено' });

    db.run("UPDATE messages SET content = ?, edited_at = datetime('now','localtime') WHERE id = ?",
      [content, messageId]);
    saveDb();

    const updated = getMessageFull(db, messageId);
    const io = req.app.get('io');
    if (io) {
      broadcast(io, msg.chat_id, 'message_edited', updated);
    }
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error('Edit message error:', e);
    return res.json({ success: false, message: 'Ошибка редактирования' });
  }
});

router.delete('/messages/:id', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const messageId = parseInt(req.params.id);
    const msgResult = dbExecBind(
      'SELECT * FROM messages WHERE id = ? AND (sender_id = ? OR ? IN (SELECT id FROM users WHERE is_admin = 1))',
      [messageId, req.user.id, req.user.id]
    );
    const msg = rowToObject(msgResult);
    if (!msg) return res.json({ success: false, message: 'Сообщение не найдено' });

    db.run("UPDATE messages SET is_deleted = 1, content = NULL WHERE id = ?", [messageId]);
    saveDb();

    const io = req.app.get('io');
    if (io) {
      broadcast(io, msg.chat_id, 'message_deleted', {
        message_id: messageId,
        chat_id: msg.chat_id,
      });
    }
    return res.json({ success: true, data: { message: 'Сообщение удалено', message_id: messageId, chat_id: msg.chat_id } });
  } catch (e) {
    console.error('Delete message error:', e);
    return res.json({ success: false, message: 'Ошибка удаления' });
  }
});

router.post('/messages/:id/react', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const messageId = parseInt(req.params.id);
    const { emoji } = req.body;
    if (!emoji) return res.json({ success: false, message: 'Не указан emoji' });

    const msgResult = dbExecBind('SELECT chat_id, is_deleted FROM messages WHERE id = ?', [messageId]);
    const msg = rowToObject(msgResult);
    if (!msg) return res.json({ success: false, message: 'Сообщение не найдено' });
    if (msg.is_deleted) return res.json({ success: false, message: 'Сообщение удалено' });

    const participantRes = dbExecBind('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?',
      [msg.chat_id, req.user.id]);
    if (participantRes.length === 0 || participantRes[0].values.length === 0) {
      return res.json({ success: false, message: 'Вы не участник чата' });
    }

    const existing = dbExecBind('SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
      [messageId, req.user.id, emoji]);
    let added;
    if (existing.length > 0 && existing[0].values.length > 0) {
      db.run('DELETE FROM message_reactions WHERE id = ?', [existing[0].values[0][0]]);
      added = false;
    } else {
      db.run('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
        [messageId, req.user.id, emoji]);
      added = true;
    }
    saveDb();

    const reactionsRes = dbExecBind('SELECT emoji, user_id FROM message_reactions WHERE message_id = ?', [messageId]);
    const reactions = {};
    for (const r of rowsToArray(reactionsRes)) {
      if (!reactions[r.emoji]) reactions[r.emoji] = [];
      reactions[r.emoji].push(r.user_id);
    }

    const io = req.app.get('io');
    if (io) {
      broadcast(io, msg.chat_id, 'message_reaction', {
        message_id: messageId,
        chat_id: msg.chat_id,
        reactions,
        user_id: req.user.id,
        emoji,
        added,
      });
    }
    return res.json({ success: true, data: { reactions, added } });
  } catch (e) {
    console.error('React error:', e);
    return res.json({ success: false, message: 'Ошибка реакции' });
  }
});

router.post('/messages/forward', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const { message_ids, target_chat_id } = req.body;
    if (!Array.isArray(message_ids) || message_ids.length === 0) {
      return res.json({ success: false, message: 'Не указаны сообщения' });
    }
    const targetChatId = parseInt(target_chat_id);

    const participantRes = dbExecBind('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?',
      [targetChatId, req.user.id]);
    if (participantRes.length === 0 || participantRes[0].values.length === 0) {
      return res.json({ success: false, message: 'Вы не участник целевого чата' });
    }

    const placeholders = message_ids.map(() => '?').join(',');
    const sourceRes = dbExecBind(`
      SELECT m.*, u.display_name as sender_name FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id IN (${placeholders}) AND m.is_deleted = 0
    `, message_ids);
    const sources = rowsToArray(sourceRes);
    if (sources.length === 0) {
      return res.json({ success: false, message: 'Сообщения не найдены' });
    }

    const createdIds = [];
    for (const src of sources) {
      db.run(`
        INSERT INTO messages (chat_id, sender_id, message_type, content, encrypted_content, media_url, sticker_id, duration,
                              forwarded_from_chat_id, forwarded_from_user_id, forwarded_from_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [targetChatId, req.user.id, src.message_type, src.content, src.encrypted_content, src.media_url, src.sticker_id, src.duration,
          src.chat_id, src.sender_id, src.sender_name]);
      const idRes = db.exec('SELECT last_insert_rowid() as id');
      const newId = idRes[0].values[0][0];
      createdIds.push(newId);
      db.run('INSERT INTO message_status (message_id, user_id, status) VALUES (?, ?, ?)', [newId, req.user.id, 'sent']);

      const otherParticipants = dbExecBind('SELECT user_id FROM chat_participants WHERE chat_id = ? AND user_id != ?',
        [targetChatId, req.user.id]);
      for (const p of rowsToArray(otherParticipants)) {
        db.run('INSERT INTO message_status (message_id, user_id, status) VALUES (?, ?, ?)', [newId, p.user_id, 'sent']);
      }
    }
    saveDb();

    const io = req.app.get('io');
    const fullMessages = [];
    for (const id of createdIds) {
      const m = getMessageFull(db, id);
      fullMessages.push(m);
      if (io) {
        const otherParticipants = dbExecBind('SELECT user_id FROM chat_participants WHERE chat_id = ? AND user_id != ?',
          [targetChatId, req.user.id]);
        for (const p of rowsToArray(otherParticipants)) {
          io.to(`user:${p.user_id}`).emit('new_message', m);
        }
        io.to(`user:${req.user.id}`).emit('new_message', m);
      }
    }

    return res.json({ success: true, data: { messages: fullMessages, count: fullMessages.length } });
  } catch (e) {
    console.error('Forward error:', e);
    return res.json({ success: false, message: 'Ошибка пересылки' });
  }
});

router.post('/chats/:chatId/read', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const chatId = parseInt(req.params.chatId);

    const participantRes = dbExecBind('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?',
      [chatId, req.user.id]);
    if (participantRes.length === 0 || participantRes[0].values.length === 0) {
      return res.json({ success: false, message: 'Вы не участник чата' });
    }

    const updated = db.run(`
      UPDATE message_status SET status = 'read', updated_at = datetime('now','localtime')
      WHERE user_id = ? AND message_id IN (SELECT id FROM messages WHERE chat_id = ? AND sender_id != ?)
        AND status != 'read'
    `, [req.user.id, chatId, req.user.id]);
    saveDb();

    const io = req.app.get('io');
    if (io) {
      broadcast(io, chatId, 'messages_read', {
        chat_id: chatId,
        user_id: req.user.id,
        read_at: new Date().toISOString(),
      });
    }
    return res.json({ success: true, data: { message: 'Прочитано' } });
  } catch (e) {
    console.error('Mark read error:', e);
    return res.json({ success: false, message: 'Ошибка' });
  }
});

module.exports = router;
