const express = require('express');
const { getDb, saveDb, rowToObject, rowsToArray, getChatFull, isUserChatAdmin, isUserChatOwner, isUserChatParticipant, generateInviteToken, dbExecBind } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function broadcast(io, chatId, event, data) {
  if (!io) return;
  io.to(`chat:${chatId}`).emit(event, data);
}

router.get('/', authMiddleware, async (req, res) => {
  const db = await getDb();
  const includeArchived = req.query.archived === '1' || req.query.archived === 'true';
  const onlyArchived = req.query.only_archived === '1' || req.query.only_archived === 'true';

  const whereExtra = onlyArchived
    ? ' AND cp.is_archived = 1'
    : (includeArchived ? '' : ' AND cp.is_archived = 0');

  const result = dbExecBind(`
    SELECT c.*,
      (SELECT content FROM messages WHERE chat_id = c.id AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT created_at FROM messages WHERE chat_id = c.id AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1) as last_message_time,
      (SELECT message_type FROM messages WHERE chat_id = c.id AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1) as last_message_type,
      (SELECT COUNT(*) FROM chat_participants WHERE chat_id = c.id) as members_count,
      cp.is_archived, cp.is_muted
    FROM chats c
    JOIN chat_participants cp ON c.id = cp.chat_id
    WHERE cp.user_id = ?${whereExtra}
    ORDER BY (c.is_saved = 1) DESC, last_message_time DESC
  `, [req.user.id]);

  const chats = rowsToArray(result).map(c => {
    const adminRes = dbExecBind(
      "SELECT user_id FROM chat_participants WHERE chat_id = ? AND role IN ('owner','admin')",
      [c.id]
    );
    c.admin_ids = rowsToArray(adminRes).map(r => r.user_id);
    c.subscribers_count = c.members_count;
    c.is_archived = c.is_archived == 1;
    c.is_muted = c.is_muted == 1;
    c.is_saved = c.is_saved == 1;
    return c;
  });

  return res.json({ success: true, data: { chats } });
});

router.get('/:id', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);
  const participant = dbExecBind('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?',
    [chatId, req.user.id]);
  if (participant.length === 0 || participant[0].values.length === 0) {
    return res.json({ success: false, message: 'Чат не найден' });
  }

  const chat = getChatFull(db, chatId, req.user.id);
  if (!chat) return res.json({ success: false, message: 'Чат не найден' });
  return res.json({ success: true, data: chat });
});

router.post('/', authMiddleware, async (req, res) => {
  const { type, name, description, target_username } = req.body;
  const db = await getDb();

  if (type === 'private') {
    if (!target_username) return res.json({ success: false, message: 'Укажите username' });
    const targetResult = dbExecBind('SELECT id FROM users WHERE username = ?', [target_username]);
    const target = rowToObject(targetResult);
    if (!target) return res.json({ success: false, message: 'Пользователь не найден' });
    if (target.id === req.user.id) return res.json({ success: false, message: 'Нельзя создать чат с собой' });

    const existingResult = dbExecBind(`
      SELECT c.id FROM chats c
      JOIN chat_participants cp1 ON c.id = cp1.chat_id AND cp1.user_id = ?
      JOIN chat_participants cp2 ON c.id = cp2.chat_id AND cp2.user_id = ?
      WHERE c.type = 'private'
    `, [req.user.id, target.id]);

    const existing = rowToObject(existingResult);
    if (existing) return res.json({ success: true, data: { chat_id: existing.id, type: 'private' } });

    db.run("INSERT INTO chats (type) VALUES ('private')");
    const idResult = db.exec('SELECT last_insert_rowid() as id');
    const chatId = idResult[0].values[0][0];
    db.run('INSERT INTO chat_participants (chat_id, user_id, role) VALUES (?, ?, ?)', [chatId, req.user.id, 'owner']);
    db.run('INSERT INTO chat_participants (chat_id, user_id, role) VALUES (?, ?, ?)', [chatId, target.id, 'member']);
    saveDb();

    return res.json({ success: true, data: { chat_id: chatId, type: 'private' } });
  }

  if (type === 'group' || type === 'channel') {
    if (!name) return res.json({ success: false, message: 'Укажите название' });
    db.run('INSERT INTO chats (type, name, description, created_by) VALUES (?, ?, ?, ?)',
      [type, name, description || null, req.user.id]);
    const idResult = db.exec('SELECT last_insert_rowid() as id');
    const chatId = idResult[0].values[0][0];
    db.run("INSERT INTO chat_participants (chat_id, user_id, role, can_add_members) VALUES (?, ?, 'owner', 1)", [chatId, req.user.id]);
    saveDb();
    return res.json({ success: true, data: { chat_id: chatId, type, name } });
  }

  return res.json({ success: false, message: 'Неверный тип чата' });
});

router.put('/:id', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);
  const { name, description, avatar } = req.body;

  const chatRes = dbExecBind('SELECT * FROM chats WHERE id = ?', [chatId]);
  const chat = rowToObject(chatRes);
  if (!chat) return res.json({ success: false, message: 'Чат не найден' });
  if (chat.type === 'private') return res.json({ success: false, message: 'Нельзя менять настройки личного чата' });

  if (!isUserChatAdmin(db, chatId, req.user.id)) {
    return res.json({ success: false, message: 'Нет прав на изменение' });
  }

  const sets = [];
  const binds = [];
  if (typeof name === 'string' && name.trim().length > 0) {
    sets.push('name = ?');
    binds.push(name.trim());
  }
  if (typeof description === 'string') {
    sets.push('description = ?');
    binds.push(description);
  }
  if (typeof avatar === 'string') {
    sets.push('avatar = ?');
    binds.push(avatar);
  }
  if (sets.length === 0) return res.json({ success: false, message: 'Нечего обновлять' });

  binds.push(chatId);
  db.run(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`, binds);
  saveDb();

  const updated = getChatFull(db, chatId, req.user.id);
  const io = req.app.get('io');
  if (io) {
    broadcast(io, chatId, 'chat_updated', updated);
  }
  return res.json({ success: true, data: updated });
});

router.get('/:id/members', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);
  if (!isUserChatParticipant(db, chatId, req.user.id)) {
    return res.json({ success: false, message: 'Чат не найден' });
  }
  const result = dbExecBind(`
    SELECT u.id, u.username, u.display_name, u.profile_picture, u.is_online, u.last_seen,
      cp.role, cp.joined_at, cp.joined_by, cp.can_send_messages, cp.can_add_members
    FROM chat_participants cp JOIN users u ON cp.user_id = u.id
    WHERE cp.chat_id = ?
    ORDER BY CASE cp.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, cp.joined_at ASC
  `, [chatId]);
  return res.json({ success: true, data: { members: rowsToArray(result) } });
});

router.post('/:id/members', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);
  const { user_id, username } = req.body;
  if (!user_id && !username) return res.json({ success: false, message: 'Укажите user_id или username' });

  const chatRes = dbExecBind('SELECT * FROM chats WHERE id = ?', [chatId]);
  const chat = rowToObject(chatRes);
  if (!chat) return res.json({ success: false, message: 'Чат не найден' });
  if (chat.type === 'private') return res.json({ success: false, message: 'Нельзя добавлять в личный чат' });

  if (!isUserChatAdmin(db, chatId, req.user.id)) {
    return res.json({ success: false, message: 'Нет прав на добавление участников' });
  }

  let target;
  if (user_id) {
    const r = dbExecBind('SELECT id, username, display_name, profile_picture, is_online FROM users WHERE id = ?', [parseInt(user_id)]);
    target = rowToObject(r);
  } else {
    const r = dbExecBind('SELECT id, username, display_name, profile_picture, is_online FROM users WHERE username = ?', [username]);
    target = rowToObject(r);
  }
  if (!target) return res.json({ success: false, message: 'Пользователь не найден' });
  if (isUserChatParticipant(db, chatId, target.id)) {
    return res.json({ success: false, message: 'Пользователь уже в чате' });
  }

  db.run("INSERT INTO chat_participants (chat_id, user_id, role, joined_by) VALUES (?, ?, 'member', ?)",
    [chatId, target.id, req.user.id]);
  saveDb();

  const io = req.app.get('io');
  const member = { ...target, role: 'member', joined_by: req.user.id, can_send_messages: 1, can_add_members: 0 };
  if (io) {
    broadcast(io, chatId, 'member_added', { chat_id: chatId, member });
    io.to(`user:${target.id}`).emit('chat_updated', getChatFull(db, chatId, target.id));
  }
  return res.json({ success: true, data: member });
});

router.delete('/:id/members/:userId', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);
  const targetUserId = parseInt(req.params.userId);

  const chatRes = dbExecBind('SELECT * FROM chats WHERE id = ?', [chatId]);
  const chat = rowToObject(chatRes);
  if (!chat) return res.json({ success: false, message: 'Чат не найден' });

  const isSelf = targetUserId === req.user.id;
  if (!isSelf && !isUserChatAdmin(db, chatId, req.user.id)) {
    return res.json({ success: false, message: 'Нет прав на удаление' });
  }
  if (isUserChatOwner(db, chatId, targetUserId) && !isSelf) {
    return res.json({ success: false, message: 'Нельзя удалить владельца' });
  }
  if (!isUserChatParticipant(db, chatId, targetUserId)) {
    return res.json({ success: false, message: 'Пользователь не в чате' });
  }

  db.run('DELETE FROM chat_participants WHERE chat_id = ? AND user_id = ?', [chatId, targetUserId]);
  saveDb();

  const io = req.app.get('io');
  if (io) {
    broadcast(io, chatId, 'member_removed', { chat_id: chatId, user_id: targetUserId });
    io.to(`user:${targetUserId}`).emit('chat_removed', { chat_id: chatId });
  }
  return res.json({ success: true, data: { message: isSelf ? 'Чат покинут' : 'Удалён' } });
});

router.put('/:id/members/:userId', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);
  const targetUserId = parseInt(req.params.userId);
  const { role, can_send_messages, can_add_members } = req.body;

  const chatRes = dbExecBind('SELECT * FROM chats WHERE id = ?', [chatId]);
  const chat = rowToObject(chatRes);
  if (!chat) return res.json({ success: false, message: 'Чат не найден' });
  if (chat.type === 'private') return res.json({ success: false, message: 'Нельзя менять роли в личном чате' });

  if (!isUserChatAdmin(db, chatId, req.user.id)) {
    return res.json({ success: false, message: 'Нет прав на изменение ролей' });
  }

  if (isUserChatOwner(db, chatId, targetUserId) && role && role !== 'owner') {
    return res.json({ success: false, message: 'Нельзя понизить владельца' });
  }
  if (role === 'owner' && !isUserChatOwner(db, chatId, req.user.id)) {
    return res.json({ success: false, message: 'Только владелец может передать владение' });
  }

  const allowedRoles = ['owner', 'admin', 'member'];
  if (role && !allowedRoles.includes(role)) {
    return res.json({ success: false, message: 'Неверная роль' });
  }

  const sets = [];
  const binds = [];
  if (role) { sets.push('role = ?'); binds.push(role); }
  if (typeof can_send_messages === 'boolean') { sets.push('can_send_messages = ?'); binds.push(can_send_messages ? 1 : 0); }
  if (typeof can_add_members === 'boolean') { sets.push('can_add_members = ?'); binds.push(can_add_members ? 1 : 0); }
  if (sets.length === 0) return res.json({ success: false, message: 'Нечего обновлять' });

  binds.push(chatId, targetUserId);
  db.run(`UPDATE chat_participants SET ${sets.join(', ')} WHERE chat_id = ? AND user_id = ?`, binds);
  saveDb();

  const memberRes = dbExecBind(`
    SELECT u.id, u.username, u.display_name, u.profile_picture, u.is_online, u.last_seen,
      cp.role, cp.joined_at, cp.joined_by, cp.can_send_messages, cp.can_add_members
    FROM chat_participants cp JOIN users u ON cp.user_id = u.id
    WHERE cp.chat_id = ? AND cp.user_id = ?
  `, [chatId, targetUserId]);
  const updated = rowToObject(memberRes);

  const io = req.app.get('io');
  if (io) {
    broadcast(io, chatId, 'member_role_changed', { chat_id: chatId, member: updated });
  }
  return res.json({ success: true, data: updated });
});

router.post('/:id/leave', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);
  if (!isUserChatParticipant(db, chatId, req.user.id)) {
    return res.json({ success: false, message: 'Вы не в чате' });
  }
  if (isUserChatOwner(db, chatId, req.user.id)) {
    return res.json({ success: false, message: 'Владелец не может покинуть чат. Сначала передайте владение.' });
  }
  db.run('DELETE FROM chat_participants WHERE chat_id = ? AND user_id = ?', [chatId, req.user.id]);
  saveDb();
  const io = req.app.get('io');
  if (io) {
    broadcast(io, chatId, 'member_removed', { chat_id: chatId, user_id: req.user.id });
    io.to(`user:${req.user.id}`).emit('chat_removed', { chat_id: chatId });
  }
  return res.json({ success: true, data: { message: 'Чат покинут' } });
});

router.post('/:id/archive', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);
  if (!isUserChatParticipant(db, chatId, req.user.id)) {
    return res.json({ success: false, message: 'Чат не найден' });
  }
  db.run('UPDATE chat_participants SET is_archived = 1 WHERE chat_id = ? AND user_id = ?', [chatId, req.user.id]);
  saveDb();
  return res.json({ success: true, data: { chat_id: chatId, is_archived: true } });
});

router.post('/:id/unarchive', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);
  if (!isUserChatParticipant(db, chatId, req.user.id)) {
    return res.json({ success: false, message: 'Чат не найден' });
  }
  db.run('UPDATE chat_participants SET is_archived = 0 WHERE chat_id = ? AND user_id = ?', [chatId, req.user.id]);
  saveDb();
  return res.json({ success: true, data: { chat_id: chatId, is_archived: false } });
});

router.post('/:id/mute', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);
  if (!isUserChatParticipant(db, chatId, req.user.id)) {
    return res.json({ success: false, message: 'Чат не найден' });
  }
  const muted = req.body && req.body.muted === false ? 0 : 1;
  db.run('UPDATE chat_participants SET is_muted = ? WHERE chat_id = ? AND user_id = ?', [muted, chatId, req.user.id]);
  saveDb();
  return res.json({ success: true, data: { chat_id: chatId, is_muted: muted === 1 } });
});

router.post('/saved', authMiddleware, async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const existing = dbExecBind(
    "SELECT id FROM chats WHERE type = 'private' AND is_saved = 1 AND id IN (SELECT chat_id FROM chat_participants WHERE user_id = ?)",
    [userId]
  );
  let row = existing.length > 0 ? existing[0].values[0] : null;
  let chatId;
  if (row) {
    chatId = row[0];
  } else {
    db.run("INSERT INTO chats (type, name, is_saved, created_by) VALUES ('private', 'Избранное', 1, ?)", [userId]);
    const idRes = db.exec('SELECT last_insert_rowid() as id');
    chatId = idRes[0].values[0][0];
    db.run("INSERT INTO chat_participants (chat_id, user_id, role) VALUES (?, ?, 'owner')", [chatId, userId]);
    saveDb();
  }
  const chat = getChatFull(db, chatId, userId);
  return res.json({ success: true, data: chat });
});

router.post('/:id/invite-link', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);
  const { expires_in_hours } = req.body;

  const chatRes = dbExecBind('SELECT * FROM chats WHERE id = ?', [chatId]);
  const chat = rowToObject(chatRes);
  if (!chat) return res.json({ success: false, message: 'Чат не найден' });
  if (chat.type === 'private') return res.json({ success: false, message: 'Нельзя создать ссылку для личного чата' });

  if (!isUserChatParticipant(db, chatId, req.user.id)) {
    return res.json({ success: false, message: 'Нет доступа' });
  }

  const link = generateInviteToken();
  let expiresAt = null;
  if (expires_in_hours && parseInt(expires_in_hours) > 0) {
    const d = new Date();
    d.setHours(d.getHours() + parseInt(expires_in_hours));
    expiresAt = d.toISOString().replace('T', ' ').split('.')[0];
  }
  db.run('INSERT INTO chat_invite_links (chat_id, link, created_by, expires_at) VALUES (?, ?, ?, ?)',
    [chatId, link, req.user.id, expiresAt]);
  saveDb();

  return res.json({ success: true, data: { link, expires_at: expiresAt, full_url: `hb://join/${link}` } });
});

router.post('/join', authMiddleware, async (req, res) => {
  const db = await getDb();
  const { link } = req.body;
  if (!link) return res.json({ success: false, message: 'Укажите ссылку' });

  const invRes = dbExecBind('SELECT * FROM chat_invite_links WHERE link = ?', [link]);
  const invite = rowToObject(invRes);
  if (!invite) return res.json({ success: false, message: 'Ссылка не найдена' });
  if (invite.expires_at && new Date(invite.expires_at + 'Z') < new Date()) {
    return res.json({ success: false, message: 'Ссылка истекла' });
  }
  const chatId = invite.chat_id;
  if (isUserChatParticipant(db, chatId, req.user.id)) {
    return res.json({ success: false, message: 'Вы уже в чате' });
  }

  db.run("INSERT INTO chat_participants (chat_id, user_id, role, joined_by) VALUES (?, ?, 'member', ?)",
    [chatId, req.user.id, invite.created_by]);
  saveDb();

  const io = req.app.get('io');
  if (io) {
    broadcast(io, chatId, 'member_added', {
      chat_id: chatId,
      member: { id: req.user.id, username: req.user.username, display_name: req.user.display_name, profile_picture: req.user.profile_picture, is_online: 1, role: 'member' },
    });
  }
  const chat = getChatFull(db, chatId, req.user.id);
  return res.json({ success: true, data: { chat_id: chatId, chat } });
});

router.post('/:id/pin', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);
  const { message_id } = req.body;
  if (!message_id) return res.json({ success: false, message: 'Укажите message_id' });

  const chatRes = dbExecBind('SELECT * FROM chats WHERE id = ?', [chatId]);
  const chat = rowToObject(chatRes);
  if (!chat) return res.json({ success: false, message: 'Чат не найден' });
  if (!isUserChatAdmin(db, chatId, req.user.id)) {
    return res.json({ success: false, message: 'Нет прав закреплять сообщения' });
  }

  const msgRes = dbExecBind('SELECT id, is_deleted FROM messages WHERE id = ? AND chat_id = ?',
    [parseInt(message_id), chatId]);
  const msg = rowToObject(msgRes);
  if (!msg) return res.json({ success: false, message: 'Сообщение не найдено' });
  if (msg.is_deleted) return res.json({ success: false, message: 'Нельзя закрепить удалённое сообщение' });

  db.run('UPDATE chats SET pinned_message_id = ? WHERE id = ?', [msg.id, chatId]);
  saveDb();

  const updated = getChatFull(db, chatId, req.user.id);
  const io = req.app.get('io');
  if (io) {
    broadcast(io, chatId, 'message_pinned', { chat_id: chatId, message_id: msg.id, pinned_message: updated.pinned_message });
  }
  return res.json({ success: true, data: { pinned_message_id: msg.id, pinned_message: updated.pinned_message } });
});

router.delete('/:id/pin', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);
  const chatRes = dbExecBind('SELECT * FROM chats WHERE id = ?', [chatId]);
  const chat = rowToObject(chatRes);
  if (!chat) return res.json({ success: false, message: 'Чат не найден' });
  if (!isUserChatAdmin(db, chatId, req.user.id)) {
    return res.json({ success: false, message: 'Нет прав' });
  }
  db.run('UPDATE chats SET pinned_message_id = NULL WHERE id = ?', [chatId]);
  saveDb();
  const io = req.app.get('io');
  if (io) {
    broadcast(io, chatId, 'message_unpinned', { chat_id: chatId });
  }
  return res.json({ success: true, data: { message: 'Откреплено' } });
});

router.post('/:id/read', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);

  const participantRes = dbExecBind('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?',
    [chatId, req.user.id]);
  if (participantRes.length === 0 || participantRes[0].values.length === 0) {
    return res.json({ success: false, message: 'Вы не участник чата' });
  }

  db.run(`
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
});

router.delete('/:id', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);
  const chatRes = dbExecBind('SELECT * FROM chats WHERE id = ?', [chatId]);
  const chat = rowToObject(chatRes);
  if (!chat) return res.json({ success: false, message: 'Чат не найден' });

  if (chat.type === 'private') {
    if (!isUserChatParticipant(db, chatId, req.user.id)) {
      return res.json({ success: false, message: 'Чат не найден' });
    }
    db.run('DELETE FROM chat_participants WHERE chat_id = ?', [chatId]);
  } else {
    if (!isUserChatOwner(db, chatId, req.user.id) && !req.user.is_admin) {
      return res.json({ success: false, message: 'Нет прав на удаление' });
    }
    db.run('DELETE FROM chats WHERE id = ?', [chatId]);
  }
  saveDb();
  return res.json({ success: true, data: { message: 'Чат удалён' } });
});

router.get('/:id/messages', authMiddleware, async (req, res) => {
  const db = await getDb();
  const limit = parseInt(req.query.limit || 50);
  const offset = parseInt(req.query.offset || 0);

  const result = dbExecBind(`
    SELECT m.*, u.username as sender_username, u.display_name as sender_name
    FROM messages m JOIN users u ON m.sender_id = u.id
    WHERE m.chat_id = ?
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `, [parseInt(req.params.id), limit, offset]);

  return res.json({ success: true, data: rowsToArray(result).reverse() });
});

module.exports = router;
