const express = require('express');
const { getDb, saveDb, lastInsertId, rowToObject, rowsToArray, dbExecBind } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function enrichCall(call, currentUserId) {
  if (!call) return null;
  call.direction = call.caller_id === currentUserId ? 'outgoing' : 'incoming';
  if (call.status === 'missed' && call.direction === 'incoming') {
    call.display_status = 'missed';
  } else if (call.status === 'rejected' && call.direction === 'incoming') {
    call.display_status = 'missed';
  } else if (call.status === 'rejected' && call.direction === 'outgoing') {
    call.display_status = 'rejected';
  } else {
    call.display_status = call.status;
  }
  if (call.is_group_call) {
    call.is_group = true;
    if (call.chat_name) {
      call.display_name = call.chat_name;
    } else {
      call.display_name = 'Групповой звонок';
    }
  } else {
    if (call.direction === 'outgoing') {
      call.display_name = call.callee_display_name || call.callee_username;
      call.display_avatar = call.callee_avatar;
    } else {
      call.display_name = call.caller_display_name || call.caller_username;
      call.display_avatar = call.caller_avatar;
    }
  }
  return call;
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const { type, limit, offset } = req.query;
    const lim = Math.min(parseInt(limit) || 50, 200);
    const off = Math.max(parseInt(offset) || 0, 0);

    let whereExtra = '';
    if (type === 'missed') {
      whereExtra = `AND ((c.caller_id != ? AND c.status IN ('missed','rejected')) OR (c.caller_id = ? AND c.status = 'rejected'))`;
    } else if (type === 'incoming') {
      whereExtra = `AND c.caller_id != ? AND c.status IN ('active','ended')`;
    } else if (type === 'outgoing') {
      whereExtra = `AND c.caller_id = ?`;
    }

    const sql = `
      SELECT c.*,
        caller.username as caller_username, caller.display_name as caller_display_name, caller.profile_picture as caller_avatar,
        callee.username as callee_username, callee.display_name as callee_display_name, callee.profile_picture as callee_avatar,
        ch.name as chat_name
      FROM calls c
      LEFT JOIN users caller ON c.caller_id = caller.id
      LEFT JOIN users callee ON c.callee_id = callee.id
      LEFT JOIN chats ch ON c.chat_id = ch.id
      WHERE (c.caller_id = ? OR c.callee_id = ?)
      ${whereExtra}
      ORDER BY COALESCE(c.ended_at, c.started_at, c.created_at) DESC
      LIMIT ? OFFSET ?
    `;

    const bindParams = type === 'missed' ? [req.user.id, req.user.id, req.user.id, lim, off] : [req.user.id, req.user.id, lim, off];
    const result = dbExecBind(sql, bindParams);
    const calls = rowsToArray(result).map(c => enrichCall(c, req.user.id));

    const countSql = `
      SELECT COUNT(*) as cnt
      FROM calls c
      WHERE (c.caller_id = ? OR c.callee_id = ?)
      ${whereExtra}
    `;
    const countResult = dbExecBind(countSql, bindParams.slice(0, bindParams.length - 2));
    const total = countResult.length > 0 ? countResult[0].values[0][0] : 0;

    return res.json({
      success: true,
      data: {
        calls,
        pagination: { limit: lim, offset: off, total, has_more: off + calls.length < total },
      },
    });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

router.post('/initiate', authMiddleware, async (req, res) => {
  try {
    const { target_user_id, call_type, chat_id } = req.body;
    if (!call_type || (!target_user_id && !chat_id)) {
      return res.json({ success: false, message: 'Не указан получатель или чат' });
    }
    const db = await getDb();

    const isGroup = !!chat_id;
    let callRow;
    if (isGroup) {
      const memberRes = dbExecBind(
        'SELECT user_id FROM chat_participants WHERE chat_id = ? AND user_id = ?',
        [chat_id, req.user.id]
      );
      if (memberRes.length === 0 || memberRes[0].values.length === 0) {
        return res.json({ success: false, message: 'Вы не участник этого чата' });
      }
      db.run(
        `INSERT INTO calls (caller_id, callee_id, call_type, status, chat_id, is_group_call)
         VALUES (?, NULL, ?, 'ringing', ?, 1)`,
        [req.user.id, call_type, chat_id]
      );
    } else {
      if (!target_user_id) {
        return res.json({ success: false, message: 'Не указан target_user_id' });
      }
      db.run(
        `INSERT INTO calls (caller_id, callee_id, call_type, status)
         VALUES (?, ?, ?, 'ringing')`,
        [req.user.id, target_user_id, call_type]
      );
    }

    const callId = lastInsertId();

    db.run(
      'INSERT INTO call_participants (call_id, user_id) VALUES (?, ?)',
      [callId, req.user.id]
    );

    if (isGroup) {
      const membersRes = dbExecBind(
        'SELECT user_id FROM chat_participants WHERE chat_id = ? AND user_id != ?',
        [chat_id, req.user.id]
      );
      if (membersRes.length > 0) {
        for (const row of membersRes[0].values) {
          try {
            db.run(
              'INSERT OR IGNORE INTO call_participants (call_id, user_id) VALUES (?, ?)',
              [callId, row[0]]
            );
          } catch (e) {}
        }
      }
    }

    saveDb();
    return res.json({ success: true, data: { call_id: callId, is_group: isGroup } });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

router.post('/:id/join', authMiddleware, async (req, res) => {
  try {
    const callId = parseInt(req.params.id);
    const db = await getDb();
    const callRes = dbExecBind('SELECT * FROM calls WHERE id = ?', [callId]);
    const call = rowToObject(callRes);
    if (!call) return res.json({ success: false, message: 'Звонок не найден' });
    if (!call.is_group_call) {
      return res.json({ success: false, message: 'Только групповые звонки' });
    }

    const partRes = dbExecBind(
      'SELECT * FROM call_participants WHERE call_id = ? AND user_id = ?',
      [callId, req.user.id]
    );
    if (partRes.length > 0 && partRes[0].values.length > 0) {
      db.run(
        'UPDATE call_participants SET joined_at = datetime(\'now\',\'localtime\'), left_at = NULL WHERE call_id = ? AND user_id = ?',
        [callId, req.user.id]
      );
    } else {
      db.run(
        'INSERT INTO call_participants (call_id, user_id) VALUES (?, ?)',
        [callId, req.user.id]
      );
    }

    if (call.status === 'ringing') {
      db.run(
        "UPDATE calls SET status = 'active', started_at = datetime('now','localtime') WHERE id = ?",
        [callId]
      );
    }
    saveDb();
    return res.json({ success: true, data: { call_id: callId, status: 'active' } });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

router.post('/:id/leave', authMiddleware, async (req, res) => {
  try {
    const callId = parseInt(req.params.id);
    const db = await getDb();
    db.run(
      'UPDATE call_participants SET left_at = datetime(\'now\',\'localtime\') WHERE call_id = ? AND user_id = ?',
      [callId, req.user.id]
    );
    saveDb();
    return res.json({ success: true });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

router.post('/:id/answer', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const callId = parseInt(req.params.id);
    const callResult = dbExecBind('SELECT * FROM calls WHERE id = ?', [callId]);
    const call = rowToObject(callResult);
    if (!call) return res.json({ success: false, message: 'Звонок не найден' });

    if (call.is_group_call) {
      const partRes = dbExecBind(
        'SELECT * FROM call_participants WHERE call_id = ? AND user_id = ?',
        [callId, req.user.id]
      );
      if (partRes.length === 0 || partRes[0].values.length === 0) {
        db.run('INSERT INTO call_participants (call_id, user_id) VALUES (?, ?)', [callId, req.user.id]);
      } else {
        db.run(
          'UPDATE call_participants SET joined_at = datetime(\'now\',\'localtime\'), left_at = NULL, was_missed = 0 WHERE call_id = ? AND user_id = ?',
          [callId, req.user.id]
        );
      }
    } else {
      if (call.callee_id !== req.user.id) {
        return res.json({ success: false, message: 'Вы не получатель этого звонка' });
      }
    }

    db.run(
      "UPDATE calls SET status = 'active', started_at = datetime('now','localtime') WHERE id = ?",
      [callId]
    );
    saveDb();
    return res.json({ success: true, data: { call_id: callId, status: 'active' } });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

router.post('/:id/reject', authMiddleware, async (req, res) => {
  try {
    const callId = parseInt(req.params.id);
    const db = await getDb();
    db.run(
      "UPDATE calls SET status = 'rejected', ended_at = datetime('now','localtime') WHERE id = ?",
      [callId]
    );
    db.run(
      'UPDATE call_participants SET was_missed = 1, left_at = datetime(\'now\',\'localtime\') WHERE call_id = ? AND user_id = ?',
      [callId, req.user.id]
    );
    saveDb();
    return res.json({ success: true });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

router.post('/:id/end', authMiddleware, async (req, res) => {
  try {
    const callId = parseInt(req.params.id);
    const db = await getDb();
    const callRes = dbExecBind('SELECT * FROM calls WHERE id = ?', [callId]);
    const call = rowToObject(callRes);
    if (!call) return res.json({ success: false, message: 'Звонок не найден' });
    if (call.caller_id !== req.user.id && call.callee_id !== req.user.id) {
      const partRes = dbExecBind(
        'SELECT 1 FROM call_participants WHERE call_id = ? AND user_id = ?',
        [callId, req.user.id]
      );
      if (partRes.length === 0 || partRes[0].values.length === 0) {
        return res.json({ success: false, message: 'Нет доступа' });
      }
    }

    const { duration } = req.body || {};
    db.run(
      "UPDATE calls SET status = 'ended', ended_at = datetime('now','localtime'), duration = COALESCE(?, duration) WHERE id = ?",
      [duration || null, callId]
    );
    db.run(
      'UPDATE call_participants SET left_at = COALESCE(left_at, datetime(\'now\',\'localtime\')) WHERE call_id = ? AND left_at IS NULL',
      [callId]
    );
    saveDb();
    return res.json({ success: true });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

router.post('/:id/push-to-talk', authMiddleware, async (req, res) => {
  try {
    const callId = parseInt(req.params.id);
    const { active } = req.body || {};
    const db = await getDb();
    const callRes = dbExecBind('SELECT * FROM calls WHERE id = ?', [callId]);
    const call = rowToObject(callRes);
    if (!call) return res.json({ success: false, message: 'Звонок не найден' });

    const partRes = dbExecBind(
      'SELECT 1 FROM call_participants WHERE call_id = ? AND user_id = ?',
      [callId, req.user.id]
    );
    if (partRes.length === 0 || partRes[0].values.length === 0) {
      return res.json({ success: false, message: 'Вы не участник звонка' });
    }
    db.run('UPDATE calls SET push_to_talk_active = ? WHERE id = ?', [active ? 1 : 0, callId]);
    saveDb();
    return res.json({ success: true, data: { active: !!active } });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const callId = parseInt(req.params.id);
    const db = await getDb();
    const callRes = dbExecBind('SELECT * FROM calls WHERE id = ?', [callId]);
    const call = rowToObject(callRes);
    if (!call) return res.json({ success: false, message: 'Звонок не найден' });
    if (call.caller_id !== req.user.id && call.callee_id !== req.user.id) {
      return res.json({ success: false, message: 'Нет доступа' });
    }
    db.run('DELETE FROM call_participants WHERE call_id = ?', [callId]);
    db.run('DELETE FROM calls WHERE id = ?', [callId]);
    saveDb();
    return res.json({ success: true, data: { message: 'Звонок удалён' } });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

router.get('/:id/status', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const result = dbExecBind(`
      SELECT c.*,
        caller.username as caller_username, caller.display_name as caller_display_name, caller.profile_picture as caller_avatar,
        callee.username as callee_username, callee.display_name as callee_display_name, callee.profile_picture as callee_avatar,
        ch.name as chat_name
      FROM calls c
      LEFT JOIN users caller ON c.caller_id = caller.id
      LEFT JOIN users callee ON c.callee_id = callee.id
      LEFT JOIN chats ch ON c.chat_id = ch.id
      WHERE c.id = ?
    `, [parseInt(req.params.id)]);
    const call = rowToObject(result);
    if (!call) return res.json({ success: false, message: 'Звонок не найден' });

    const partsRes = dbExecBind(`
      SELECT cp.*, u.username, u.display_name, u.profile_picture
      FROM call_participants cp
      JOIN users u ON cp.user_id = u.id
      WHERE cp.call_id = ?
      ORDER BY cp.joined_at ASC
    `, [parseInt(req.params.id)]);
    const participants = rowsToArray(partsRes);
    call.participants = participants;
    return res.json({ success: true, data: enrichCall(call, req.user.id) });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

module.exports = router;
