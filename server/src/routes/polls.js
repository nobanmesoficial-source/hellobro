const express = require('express');
const { getDb, saveDb, rowToObject, rowsToArray, dbExecBind, lastInsertId } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function broadcast(io, chatId, event, data) {
  if (!io) return;
  io.to(`chat:${chatId}`).emit(event, data);
}

function getPollFull(db, pollId) {
  const poll = rowToObject(dbExecBind('SELECT * FROM polls WHERE id = ?', [pollId]));
  if (!poll) return null;
  const options = rowsToArray(dbExecBind('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY id', [pollId]));
  for (const opt of options) {
    opt.votes = dbExecBind('SELECT user_id FROM poll_votes WHERE option_id = ?', [opt.id])
      .reduce((acc, r) => [...acc, ...r.values.map(v => v)], []);
    opt.vote_count = opt.votes.length;
  }
  poll.options = options;
  poll.total_votes = options.reduce((s, o) => s + o.vote_count, 0);
  return poll;
}

// POST /api/v1/polls — создать опрос (прикреплён к сообщению)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const { chat_id, question, options: optionTexts, multiple_choices, reply_to } = req.body;
    if (!chat_id || !question || !Array.isArray(optionTexts) || optionTexts.length < 2) {
      return res.json({ success: false, message: 'Нужен вопрос и минимум 2 варианта' });
    }
    const isParticipant = dbExecBind('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?',
      [parseInt(chat_id), req.user.id]);
    if (isParticipant.length === 0 || isParticipant[0].values.length === 0) {
      return res.json({ success: false, message: 'Вы не участник чата' });
    }
    const chatId = parseInt(chat_id);
    const replyToId = reply_to ? parseInt(reply_to) : null;

    db.run(`INSERT INTO messages (chat_id, sender_id, message_type, content, reply_to)
            VALUES (?, ?, 'poll', ?, ?)`, [chatId, req.user.id, question, replyToId]);
    const messageId = lastInsertId();

    db.run('INSERT INTO polls (message_id, question, multiple_choices) VALUES (?, ?, ?)',
      [messageId, question, multiple_choices ? 1 : 0]);
    const pollId = lastInsertId();

    for (const text of optionTexts) {
      db.run('INSERT INTO poll_options (poll_id, text) VALUES (?, ?)', [pollId, text]);
    }
    saveDb();

    const { getMessageFull } = require('../db');
    const message = getMessageFull(db, messageId);
    if (message) {
      const poll = getPollFull(db, pollId);
      message.poll = poll;
    }

    db.run('INSERT INTO message_status (message_id, user_id, status) VALUES (?, ?, ?)', [messageId, req.user.id, 'sent']);
    const participants = rowsToArray(dbExecBind('SELECT user_id FROM chat_participants WHERE chat_id = ? AND user_id != ?', [chatId, req.user.id]));
    for (const p of participants) {
      db.run('INSERT INTO message_status (message_id, user_id, status) VALUES (?, ?, ?)', [messageId, p.user_id, 'sent']);
    }
    saveDb();

    const io = req.app.get('io');
    if (io) {
      for (const p of participants) {
        io.to(`user:${p.user_id}`).emit('new_message', message);
      }
      io.to(`user:${req.user.id}`).emit('new_message', message);
    }

    return res.json({ success: true, data: message });
  } catch (e) {
    console.error('Create poll error:', e);
    return res.json({ success: false, message: 'Ошибка создания опроса' });
  }
});

// GET /api/v1/polls/:id — получить результаты опроса
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const pollId = parseInt(req.params.id);
    const poll = getPollFull(db, pollId);
    if (!poll) return res.json({ success: false, message: 'Опрос не найден' });
    return res.json({ success: true, data: poll });
  } catch (e) {
    console.error('Get poll error:', e);
    return res.json({ success: false, message: 'Ошибка загрузки опроса' });
  }
});

// POST /api/v1/polls/:id/vote — проголосовать
router.post('/:id/vote', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const pollId = parseInt(req.params.id);
    const { option_id } = req.body;
    if (!option_id) return res.json({ success: false, message: 'Не указан вариант' });

    const poll = rowToObject(dbExecBind('SELECT * FROM polls WHERE id = ?', [pollId]));
    if (!poll) return res.json({ success: false, message: 'Опрос не найден' });

    const opt = rowToObject(dbExecBind('SELECT * FROM poll_options WHERE id = ? AND poll_id = ?', [option_id, pollId]));
    if (!opt) return res.json({ success: false, message: 'Вариант не найден' });

    if (!poll.multiple_choices) {
      const existing = dbExecBind('SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?', [pollId, req.user.id]);
      for (const row of rowsToArray(existing)) {
        db.run('DELETE FROM poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?',
          [pollId, row.option_id, req.user.id]);
      }
    }

    db.run('INSERT OR IGNORE INTO poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)',
      [pollId, option_id, req.user.id]);
    saveDb();

    const updated = getPollFull(db, pollId);
    const msgRes = dbExecBind('SELECT chat_id FROM messages WHERE id = (SELECT message_id FROM polls WHERE id = ?)', [pollId]);
    const msg = rowToObject(msgRes);
    if (msg) {
      const io = req.app.get('io');
      if (io) {
        broadcast(io, msg.chat_id, 'poll_updated', { poll_id: pollId, poll: updated });
      }
    }

    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error('Vote error:', e);
    return res.json({ success: false, message: 'Ошибка голосования' });
  }
});

// DELETE /api/v1/polls/:id/vote — отменить голос
router.delete('/:id/vote', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const pollId = parseInt(req.params.id);
    const option_id = req.body?.option_id ?? req.query?.option_id;
    if (option_id) {
      db.run('DELETE FROM poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?',
        [pollId, option_id, req.user.id]);
    } else {
      db.run('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?', [pollId, req.user.id]);
    }
    saveDb();

    const updated = getPollFull(db, pollId);
    const msgRes = dbExecBind('SELECT chat_id FROM messages WHERE id = (SELECT message_id FROM polls WHERE id = ?)', [pollId]);
    const msg = rowToObject(msgRes);
    if (msg) {
      const io = req.app.get('io');
      if (io) {
        broadcast(io, msg.chat_id, 'poll_updated', { poll_id: pollId, poll: updated });
      }
    }

    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error('Remove vote error:', e);
    return res.json({ success: false, message: 'Ошибка отмены голоса' });
  }
});

module.exports = router;
