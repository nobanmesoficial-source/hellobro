const express = require('express');
const { getDb, saveDb, dbExecBind } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '..', '..', 'uploads') });

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

router.get('/me', authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = dbExecBind('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const user = rowToObject(result);
  if (!user) return res.json({ success: false, message: 'Пользователь не найден' });

  return res.json({
    success: true,
    data: {
      user_id: user.id,
      phone: user.phone,
      username: user.username,
      display_name: user.display_name,
      profile_picture: user.profile_picture,
      is_online: !!user.is_online,
      last_seen: user.last_seen,
      hide_last_seen: !!user.hide_last_seen,
      hide_phone: !!user.hide_phone,
      is_admin: !!user.is_admin,
      is_moderator: !!user.is_moderator,
      is_blocked: !!user.is_blocked,
      twofa_enabled: !!user.twofa_enabled,
      created_at: user.created_at,
      notification_settings: JSON.parse(user.notification_settings || '{}'),
      auto_reply_settings: JSON.parse(user.auto_reply_settings || '{}'),
      story_visibility: JSON.parse(user.story_visibility || '{}'),
      panic_mode_triggered: !!user.panic_mode_triggered,
    }
  });
});

router.put('/me', authMiddleware, upload.single('profile_picture'), async (req, res) => {
  try {
    const db = await getDb();
    const { display_name, hide_last_seen, hide_phone } = req.body;
    const updates = [];
    const params = [];

    if (display_name) { updates.push('display_name = ?'); params.push(display_name); }
    if (hide_last_seen !== undefined) { updates.push('hide_last_seen = ?'); params.push(hide_last_seen ? 1 : 0); }
    if (hide_phone !== undefined) { updates.push('hide_phone = ?'); params.push(hide_phone ? 1 : 0); }
    if (req.file) {
      updates.push('profile_picture = ?');
      params.push('/uploads/' + req.file.filename);
    }

    if (updates.length > 0) {
      params.push(req.user.id);
      db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
      saveDb();
    }

    return res.json({ success: true, data: { message: 'Профиль обновлён' } });
  } catch (e) {
    return res.json({ success: false, message: 'Ошибка обновления профиля' });
  }
});

router.get('/search', authMiddleware, async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ success: false, data: [] });

  const db = await getDb();
  const result = dbExecBind(
    'SELECT id, username, display_name, profile_picture, is_online FROM users WHERE username LIKE ? AND id != ? LIMIT 20',
    [`%${username}%`, req.user.id]
  );

  return res.json({ success: true, data: rowsToArray(result) });
});

router.get('/:id', authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = dbExecBind(
    'SELECT id, phone, username, display_name, profile_picture, is_online, last_seen, hide_last_seen, hide_phone, created_at FROM users WHERE id = ?',
    [parseInt(req.params.id)]
  );
  const user = rowToObject(result);
  if (!user) return res.json({ success: false, message: 'Пользователь не найден' });

  if (user.hide_last_seen) user.last_seen = null;
  if (user.hide_phone) user.phone = null;

  return res.json({ success: true, data: user });
});

router.post('/:id/block', authMiddleware, async (req, res) => {
  const db = await getDb();
  const targetId = parseInt(req.params.id);
  if (targetId === req.user.id) return res.json({ success: false, message: 'Нельзя заблокировать себя' });

  db.run('INSERT OR IGNORE INTO blacklist (user_id, blocked_id) VALUES (?, ?)', [req.user.id, targetId]);
  saveDb();
  return res.json({ success: true, data: { message: 'Пользователь заблокирован' } });
});

router.post('/:id/unblock', authMiddleware, async (req, res) => {
  const db = await getDb();
  db.run('DELETE FROM blacklist WHERE user_id = ? AND blocked_id = ?', [req.user.id, parseInt(req.params.id)]);
  saveDb();
  return res.json({ success: true, data: { message: 'Пользователь разблокирован' } });
});

router.delete('/:id', authMiddleware, async (req, res) => {
  if (req.user.is_admin || parseInt(req.params.id) === req.user.id) {
    const db = await getDb();
    db.run('DELETE FROM users WHERE id = ?', [parseInt(req.params.id)]);
    saveDb();
    return res.json({ success: true, data: { message: 'Пользователь удалён' } });
  }
  return res.json({ success: false, message: 'Недостаточно прав' });
});

router.get('/me/stats', authMiddleware, async (req, res) => {
  const db = await getDb();
  const chatsResult = dbExecBind('SELECT COUNT(*) as cnt FROM chat_participants WHERE user_id = ?', [req.user.id]);
  const friendsResult = dbExecBind('SELECT COUNT(*) as cnt FROM friends WHERE user_id = ?', [req.user.id]);
  const chats = rowToObject(chatsResult);
  const friends = rowToObject(friendsResult);
  return res.json({ success: true, data: { chats: chats ? chats.cnt : 0, friends: friends ? friends.cnt : 0 } });
});

router.put('/me/username', authMiddleware, async (req, res) => {
  const { new_username } = req.body;
  if (!new_username) return res.json({ success: false, message: 'Введите username' });

  let clean = new_username.trim();
  if (!clean.startsWith('@')) clean = '@' + clean;

  const db = await getDb();
  const existing = dbExecBind('SELECT id FROM users WHERE username = ? AND id != ?', [clean, req.user.id]);
  if (existing.length > 0 && existing[0].values.length > 0) {
    return res.json({ success: false, message: 'Username уже занят' });
  }

  db.run('UPDATE users SET username = ? WHERE id = ?', [clean, req.user.id]);
  saveDb();
  return res.json({ success: true, data: { username: clean } });
});

router.put('/me/profile', authMiddleware, async (req, res) => {
  const { display_name } = req.body;
  if (!display_name) return res.json({ success: false, message: 'Введите имя' });
  const db = await getDb();
  db.run('UPDATE users SET display_name = ? WHERE id = ?', [display_name.trim(), req.user.id]);
  saveDb();
  return res.json({ success: true, data: { message: 'Имя обновлено' } });
});

router.delete('/me/account', authMiddleware, async (req, res) => {
  const db = await getDb();
  db.run('DELETE FROM users WHERE id = ?', [req.user.id]);
  saveDb();
  return res.json({ success: true, data: { message: 'Аккаунт удалён' } });
});

router.get('/blacklist', authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = dbExecBind(
    'SELECT u.id, u.username, u.display_name, u.profile_picture FROM blacklist b JOIN users u ON b.blocked_id = u.id WHERE b.user_id = ?',
    [req.user.id]
  );
  return res.json({ success: true, data: rowsToArray(result) });
});

router.put('/me/notification-settings', authMiddleware, async (req, res) => {
  const { settings } = req.body;
  if (!settings) return res.json({ success: false, message: 'Нет настроек' });
  const db = await getDb();
  db.run('UPDATE users SET notification_settings = ? WHERE id = ?', [
    typeof settings === 'string' ? settings : JSON.stringify(settings), req.user.id
  ]);
  saveDb();
  return res.json({ success: true, data: { message: 'Настройки уведомлений обновлены' } });
});

router.put('/me/auto-reply', authMiddleware, async (req, res) => {
  const { enabled, message, schedule_start, schedule_end } = req.body;
  const db = await getDb();
  const settings = JSON.stringify({
    enabled: !!enabled, message: message || '',
    schedule_start: schedule_start || '09:00', schedule_end: schedule_end || '18:00'
  });
  db.run('UPDATE users SET auto_reply_settings = ? WHERE id = ?', [settings, req.user.id]);
  saveDb();
  return res.json({ success: true, data: { message: 'Автоответчик обновлён' } });
});

router.put('/me/story-visibility', authMiddleware, async (req, res) => {
  const { settings } = req.body;
  const db = await getDb();
  db.run('UPDATE users SET story_visibility = ? WHERE id = ?', [
    typeof settings === 'string' ? settings : JSON.stringify(settings), req.user.id
  ]);
  saveDb();
  return res.json({ success: true, data: { message: 'Настройки видимости историй обновлены' } });
});

router.get('/me/backup', authMiddleware, async (req, res) => {
  const db = await getDb();
  const userResult = dbExecBind('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const user = rowToObject(userResult);
  const chatsResult = dbExecBind(
    'SELECT c.* FROM chats c JOIN chat_participants cp ON c.id = cp.chat_id WHERE cp.user_id = ?',
    [req.user.id]
  );
  return res.json({ success: true, data: { user, chats: rowsToArray(chatsResult) } });
});

module.exports = router;
