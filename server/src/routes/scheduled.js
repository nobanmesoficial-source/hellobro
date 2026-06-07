const express = require('express');
const { getDb, saveDb, rowToObject, rowsToArray, getMessageFull, dbExecBind } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function broadcast(io, chatId, event, data) {
  if (!io) return;
  io.to(`chat:${chatId}`).emit(event, data);
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const result = dbExecBind(`
      SELECT s.*, c.name as chat_name, c.type as chat_type
      FROM scheduled_messages s
      LEFT JOIN chats c ON s.chat_id = c.id
      WHERE s.sender_id = ? AND s.status = 'pending'
      ORDER BY s.send_at ASC
    `, [req.user.id]);
    return res.json({ success: true, data: { scheduled: rowsToArray(result) } });
  } catch (e) {
    console.error('List scheduled error:', e);
    return res.json({ success: false, message: 'Ошибка загрузки отложенных' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const { chat_id, content, message_type, media_url, reply_to, send_at } = req.body;
    const chatId = parseInt(chat_id);
    if (!chatId) return res.json({ success: false, message: 'Укажите чат' });
    if (!send_at) return res.json({ success: false, message: 'Укажите время отправки' });

    const sendAtDate = new Date(send_at);
    if (isNaN(sendAtDate.getTime())) {
      return res.json({ success: false, message: 'Неверный формат времени' });
    }
    if (sendAtDate.getTime() <= Date.now() + 5 * 1000) {
      return res.json({ success: false, message: 'Время должно быть в будущем' });
    }

    const participantRes = dbExecBind('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?',
      [chatId, req.user.id]);
    if (participantRes.length === 0 || participantRes[0].values.length === 0) {
      return res.json({ success: false, message: 'Вы не участник чата' });
    }

    const sendAtStr = sendAtDate.toISOString().replace('T', ' ').split('.')[0];

    const replyToId = reply_to ? parseInt(reply_to) : null;
    db.run(`
      INSERT INTO scheduled_messages (chat_id, sender_id, message_type, content, media_url, reply_to, send_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [chatId, req.user.id, message_type || 'text', content || null, media_url || null, replyToId, sendAtStr]);
    const idRes = db.exec('SELECT last_insert_rowid() as id');
    const id = idRes[0].values[0][0];

    saveDb();

    const created = rowToObject(dbExecBind('SELECT * FROM scheduled_messages WHERE id = ?', [id]));
    return res.json({ success: true, data: created });
  } catch (e) {
    console.error('Schedule error:', e);
    return res.json({ success: false, message: 'Ошибка создания отложенного сообщения' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const id = parseInt(req.params.id);
    const existing = dbExecBind('SELECT sender_id, status FROM scheduled_messages WHERE id = ?', [id]);
    const row = rowToObject(existing);
    if (!row) return res.json({ success: false, message: 'Не найдено' });
    if (row.sender_id !== req.user.id) {
      return res.json({ success: false, message: 'Нет прав' });
    }
    if (row.status !== 'pending') {
      return res.json({ success: false, message: 'Нельзя отменить уже отправленное' });
    }
    db.run("UPDATE scheduled_messages SET status = 'cancelled' WHERE id = ?", [id]);
    saveDb();
    return res.json({ success: true, data: { id, status: 'cancelled' } });
  } catch (e) {
    console.error('Cancel scheduled error:', e);
    return res.json({ success: false, message: 'Ошибка отмены' });
  }
});

function startScheduledWorker(io) {
  setInterval(async () => {
    try {
      const db = await getDb();
      const now = new Date();
      const nowStr = now.toISOString().replace('T', ' ').split('.')[0];
      const due = dbExecBind(`
        SELECT * FROM scheduled_messages
        WHERE status = 'pending' AND send_at <= ?
        LIMIT 20
      `, [nowStr]);
      const rows = rowsToArray(due);
      if (rows.length === 0) return;

      for (const sched of rows) {
        try {
          db.run(`
            INSERT INTO messages (chat_id, sender_id, message_type, content, media_url, reply_to)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [sched.chat_id, sched.sender_id, sched.message_type, sched.content, sched.media_url, sched.reply_to]);
          const idRes = db.exec('SELECT last_insert_rowid() as id');
          const newMsgId = idRes[0].values[0][0];
          db.run('INSERT INTO message_status (message_id, user_id, status) VALUES (?, ?, ?)', [newMsgId, sched.sender_id, 'sent']);
          const others = dbExecBind('SELECT user_id FROM chat_participants WHERE chat_id = ? AND user_id != ?',
            [sched.chat_id, sched.sender_id]);
          for (const p of rowsToArray(others)) {
            db.run('INSERT INTO message_status (message_id, user_id, status) VALUES (?, ?, ?)', [newMsgId, p.user_id, 'sent']);
          }
          db.run("UPDATE scheduled_messages SET status = 'sent', sent_message_id = ? WHERE id = ?", [newMsgId, sched.id]);
          saveDb();

          const full = getMessageFull(db, newMsgId);
          if (full && io) {
            broadcast(io, sched.chat_id, 'new_message', full);
            io.to(`user:${sched.sender_id}`).emit('scheduled_sent', {
              scheduled_id: sched.id,
              message: full,
            });
          }
        } catch (innerErr) {
          console.error('Scheduled worker item error:', innerErr);
          try {
            db.run("UPDATE scheduled_messages SET status = 'failed' WHERE id = ?", [sched.id]);
            saveDb();
          } catch (_) {}
        }
      }
    } catch (e) {
      console.error('Scheduled worker error:', e);
    }
  }, 30 * 1000);
}

module.exports = router;
module.exports.startScheduledWorker = startScheduledWorker;
