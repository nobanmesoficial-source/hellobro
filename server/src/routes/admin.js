const express = require('express');
const { getDb, saveDb, rowToObject, rowsToArray, dbExecBind, lastInsertId } = require('../db');
const { authMiddleware, adminOnly, adminOrModerator, adminOrOpManager, staffOnly } = require('../middleware/auth');
const crypto = require('crypto');

const router = express.Router();

// Обновлённый stats с данными для графиков
router.get('/stats', authMiddleware, staffOnly, async (req, res) => {
  const db = await getDb();
  const totalUsers = rowToObject(db.exec('SELECT COUNT(*) as cnt FROM users'));
  const blockedUsers = rowToObject(db.exec('SELECT COUNT(*) as cnt FROM users WHERE is_blocked = 1'));
  const onlineUsers = rowToObject(db.exec('SELECT COUNT(*) as cnt FROM users WHERE is_online = 1'));
  const totalChats = rowToObject(db.exec('SELECT COUNT(*) as cnt FROM chats'));
  const totalMessages = rowToObject(db.exec('SELECT COUNT(*) as cnt FROM messages'));
  const totalStories = rowToObject(db.exec('SELECT COUNT(*) as cnt FROM stories'));
  const pendingReports = rowToObject(db.exec("SELECT COUNT(*) as cnt FROM violation_reports WHERE status = 'pending'"));
  const openViolations = rowToObject(db.exec("SELECT COUNT(*) as cnt FROM violations WHERE status = 'open'"));
  const totalViolations = rowToObject(db.exec('SELECT COUNT(*) as cnt FROM violations'));

  // Регистрации за последние 7 дней
  const regChart = rowsToArray(db.exec(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM users WHERE created_at > datetime('now', '-7 days')
    GROUP BY DATE(created_at) ORDER BY date
  `));

  // Нарушения за последние 7 дней
  const violChart = rowsToArray(db.exec(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM violations WHERE created_at > datetime('now', '-7 days')
    GROUP BY DATE(created_at) ORDER BY date
  `));

  // Активность (сообщения) за последние 7 дней
  const msgChart = rowsToArray(db.exec(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM messages WHERE created_at > datetime('now', '-7 days')
    GROUP BY DATE(created_at) ORDER BY date
  `));

  // Онлайн пользователи (по часам сегодня)
  const onlineChart = rowsToArray(db.exec(`
    SELECT strftime('%H', datetime('now', 'localtime')) as hour, COUNT(*) as count
    FROM users WHERE is_online = 1
  `));

  return res.json({
    success: true,
    data: {
      total_users: totalUsers ? totalUsers.cnt : 0,
      blocked_users: blockedUsers ? blockedUsers.cnt : 0,
      online_users: onlineUsers ? onlineUsers.cnt : 0,
      total_chats: totalChats ? totalChats.cnt : 0,
      total_messages: totalMessages ? totalMessages.cnt : 0,
      total_stories: totalStories ? totalStories.cnt : 0,
      pending_reports: pendingReports ? pendingReports.cnt : 0,
      open_violations: openViolations ? openViolations.cnt : 0,
      total_violations: totalViolations ? totalViolations.cnt : 0,
      registration_chart: regChart,
      violation_chart: violChart,
      message_chart: msgChart,
      online_chart: onlineChart,
    }
  });
});

// Пользователи с IP сессий (расширенный)
router.get('/users', authMiddleware, staffOnly, async (req, res) => {
  const db = await getDb();
  const { search, limit = 100, offset = 0 } = req.query;

  let sql = 'SELECT id, phone, username, display_name, profile_picture, is_online, last_seen, last_activity, is_admin, is_moderator, is_operation_manager, is_blocked, is_immune, created_at FROM users';
  const params = [];

  if (search) {
    sql += ' WHERE phone LIKE ? OR username LIKE ? OR display_name LIKE ? OR CAST(id AS TEXT) LIKE ?';
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const result = dbExecBind(sql, params);
  const users = rowsToArray(result);

  // Total
  let countSql = 'SELECT COUNT(*) as cnt FROM users';
  if (search) {
    const q = `%${search}%`;
    countSql += ` WHERE phone LIKE '${q}' OR username LIKE '${q}' OR display_name LIKE '${q}'`;
  }
  const total = rowToObject(db.exec(countSql));

  return res.json({ success: true, data: users, total: total ? total.cnt : 0 });
});

// Детальный просмотр пользователя
router.get('/users/:id', authMiddleware, staffOnly, async (req, res) => {
  const db = await getDb();
  const userRes = dbExecBind('SELECT * FROM users WHERE id = ?', [parseInt(req.params.id)]);
  const user = rowToObject(userRes);
  if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

  // Статистика пользователя
  const msgCount = rowToObject(dbExecBind('SELECT COUNT(*) as cnt FROM messages WHERE sender_id = ?', [user.id]));
  const chatCount = rowToObject(dbExecBind('SELECT COUNT(DISTINCT chat_id) as cnt FROM chat_participants WHERE user_id = ?', [user.id]));
  const violCount = rowToObject(dbExecBind('SELECT COUNT(*) as cnt FROM violations WHERE target_user_id = ?', [user.id]));
  const reportCount = rowToObject(dbExecBind('SELECT COUNT(*) as cnt FROM violation_reports WHERE target_id = ?', [user.id]));

  return res.json({
    success: true,
    data: {
      ...user,
      messages_count: msgCount ? msgCount.cnt : 0,
      chats_count: chatCount ? chatCount.cnt : 0,
      violations_count: violCount ? violCount.cnt : 0,
      reports_count: reportCount ? reportCount.cnt : 0,
    }
  });
});

router.post('/users/:id/block', authMiddleware, staffOnly, async (req, res) => {
  const db = await getDb();
  const userId = parseInt(req.params.id);
  db.run('UPDATE users SET is_blocked = 1 WHERE id = ?', [userId]);
  db.run("INSERT INTO staff_action_log (staff_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
    [req.user.id, 'user_block', 'user', userId, `Заблокирован пользователь #${userId}`]);
  saveDb();

  const io = req.app.get('io');
  if (io) {
    io.to(`user:${userId}`).emit('force_logout', { reason: 'Ваш аккаунт заблокирован' });
  }

  return res.json({ success: true, data: { message: 'Пользователь заблокирован' } });
});

router.post('/users/:id/unblock', authMiddleware, staffOnly, async (req, res) => {
  const db = await getDb();
  const userId = parseInt(req.params.id);
  db.run('UPDATE users SET is_blocked = 0 WHERE id = ?', [userId]);
  db.run("INSERT INTO staff_action_log (staff_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
    [req.user.id, 'user_unblock', 'user', userId, `Разблокирован пользователь #${userId}`]);
  saveDb();
  return res.json({ success: true, data: { message: 'Пользователь разблокирован' } });
});

router.delete('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  const db = await getDb();
  const userId = parseInt(req.params.id);
  db.run('DELETE FROM users WHERE id = ?', [userId]);
  db.run("INSERT INTO staff_action_log (staff_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
    [req.user.id, 'user_delete', 'user', userId, `Удалён пользователь #${userId}`]);
  saveDb();
  return res.json({ success: true, data: { message: 'Пользователь удалён' } });
});

// Управление иммунитетом
router.post('/users/:id/immunity', authMiddleware, staffOnly, async (req, res) => {
  const { enabled } = req.body;
  const db = await getDb();
  const userId = parseInt(req.params.id);
  db.run('UPDATE users SET is_immune = ? WHERE id = ?', [enabled ? 1 : 0, userId]);
  db.run("INSERT INTO staff_action_log (staff_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
    [req.user.id, enabled ? 'immune_on' : 'immune_off', 'user', userId,
     enabled ? `Включён иммунитет для #${userId}` : `Выключен иммунитет для #${userId}`]);
  saveDb();
  return res.json({ success: true, data: { message: enabled ? 'Иммунитет включён' : 'Иммунитет выключен' } });
});

// Генерация кода восстановления (8 цифр, 10 минут)
router.post('/users/:id/recovery-code', authMiddleware, adminOnly, async (req, res) => {
  const db = await getDb();
  const userId = parseInt(req.params.id);
  const code = Math.floor(10000000 + Math.random() * 90000000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' ').split('.')[0];

  db.run('UPDATE users SET recovery_code = ?, recovery_code_expires = ? WHERE id = ?', [code, expiresAt, userId]);
  db.run("INSERT INTO staff_action_log (staff_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
    [req.user.id, 'recovery_code', 'user', userId, `Сгенерирован код восстановления для #${userId}`]);
  saveDb();

  return res.json({ success: true, data: { code, expires_at: expiresAt } });
});

// Персонал: CRUD
router.get('/staff', authMiddleware, adminOnly, async (req, res) => {
  const db = await getDb();
  const staff = rowsToArray(db.exec(`
    SELECT id, phone, username, display_name, profile_picture, is_admin, is_moderator, is_operation_manager, is_immune, last_seen, created_at
    FROM users WHERE is_admin = 1 OR is_moderator = 1 OR is_operation_manager = 1
    ORDER BY is_admin DESC, created_at ASC
  `));
  return res.json({ success: true, data: staff });
});

router.post('/staff', authMiddleware, adminOnly, async (req, res) => {
  const { user_id, role } = req.body; // role: admin, moderator, operation_manager
  if (!user_id || !role) return res.status(400).json({ success: false, message: 'user_id и role обязательны' });

  const db = await getDb();
  const updates = { admin: 'is_admin', moderator: 'is_moderator', operation_manager: 'is_operation_manager' };
  const col = updates[role];
  if (!col) return res.status(400).json({ success: false, message: 'Неверная роль' });

  db.run(`UPDATE users SET ${col} = 1 WHERE id = ?`, [parseInt(user_id)]);
  db.run("INSERT INTO staff_action_log (staff_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
    [req.user.id, `staff_add_${role}`, 'user', parseInt(user_id), `Назначена роль ${role} пользователю #${user_id}`]);
  saveDb();
  return res.json({ success: true, data: { message: 'Сотрудник назначен' } });
});

router.delete('/staff/:id', authMiddleware, adminOnly, async (req, res) => {
  const db = await getDb();
  const staffId = parseInt(req.params.id);
  // Не даём снять права самому себе
  if (staffId === req.user.id) return res.status(400).json({ success: false, message: 'Нельзя снять права самому себе' });

  db.run('UPDATE users SET is_admin = 0, is_moderator = 0, is_operation_manager = 0 WHERE id = ?', [staffId]);
  db.run("INSERT INTO staff_action_log (staff_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
    [req.user.id, 'staff_remove', 'user', staffId, `Сняты все роли с пользователя #${staffId}`]);
  saveDb();
  return res.json({ success: true, data: { message: 'Права сотрудника удалены' } });
});

// История действий персонала
router.get('/staff/log', authMiddleware, adminOnly, async (req, res) => {
  const db = await getDb();
  const logs = rowsToArray(db.exec(`
    SELECT sal.*, u.username, u.display_name
    FROM staff_action_log sal
    JOIN users u ON sal.staff_id = u.id
    ORDER BY sal.created_at DESC LIMIT 100
  `));
  return res.json({ success: true, data: logs });
});

// Чаты с доп. информацией
router.get('/chats', authMiddleware, staffOnly, async (req, res) => {
  const db = await getDb();
  const { search, type, limit = 50, offset = 0 } = req.query;

  let sql = `
    SELECT c.*, u.username as creator_username,
      (SELECT COUNT(*) FROM chat_participants cp WHERE cp.chat_id = c.id) as members_count,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) as messages_count
    FROM chats c LEFT JOIN users u ON c.created_by = u.id
  `;
  const params = [];
  const conditions = [];

  if (search) {
    conditions.push('(c.name LIKE ? OR c.id LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (type) {
    conditions.push('c.type = ?');
    params.push(type);
  }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const result = dbExecBind(sql, params);
  return res.json({ success: true, data: rowsToArray(result) });
});

// Информация о конкретном чате
router.get('/chats/:id', authMiddleware, staffOnly, async (req, res) => {
  const db = await getDb();
  const chatRes = dbExecBind('SELECT * FROM chats WHERE id = ?', [parseInt(req.params.id)]);
  const chat = rowToObject(chatRes);
  if (!chat) return res.status(404).json({ success: false, message: 'Чат не найден' });

  const members = rowsToArray(dbExecBind(`
    SELECT u.id, u.username, u.display_name, u.profile_picture, u.is_online, u.last_seen, cp.role, cp.joined_at
    FROM chat_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.chat_id = ?`, [chat.id]));

  const mediaCount = rowToObject(dbExecBind(
    "SELECT COUNT(*) as cnt FROM messages WHERE chat_id = ? AND message_type IN ('photo','video','file') AND is_deleted = 0", [chat.id]));

  return res.json({
    success: true,
    data: { ...chat, members, media_count: mediaCount ? mediaCount.cnt : 0 }
  });
});

router.delete('/chats/:id', authMiddleware, adminOrModerator, async (req, res) => {
  const db = await getDb();
  const chatId = parseInt(req.params.id);
  db.run('DELETE FROM chats WHERE id = ?', [chatId]);
  db.run("INSERT INTO staff_action_log (staff_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
    [req.user.id, 'chat_delete', 'chat', chatId, `Удалён чат #${chatId}`]);
  saveDb();
  return res.json({ success: true, data: { message: 'Чат удалён' } });
});

// Reports
router.get('/reports', authMiddleware, staffOnly, async (req, res) => {
  const db = await getDb();
  const { status } = req.query;
  let sql = `
    SELECT vr.*, reporter.username as reporter_username, reporter.display_name as reporter_display_name,
      target.username as target_username, target.display_name as target_display_name
    FROM violation_reports vr
    JOIN users reporter ON vr.reporter_id = reporter.id
    JOIN users target ON vr.target_id = target.id
  `;
  if (status) sql += ` WHERE vr.status = '${status}'`;
  sql += ' ORDER BY vr.created_at DESC';
  const result = db.exec(sql);
  return res.json({ success: true, data: rowsToArray(result) });
});

router.post('/reports/:id/resolve', authMiddleware, staffOnly, async (req, res) => {
  const db = await getDb();
  const reportId = parseInt(req.params.id);
  db.run("UPDATE violation_reports SET status = 'resolved' WHERE id = ?", [reportId]);
  saveDb();
  return res.json({ success: true, data: { message: 'Жалоба решена' } });
});

// Рассылка всем пользователям
router.post('/broadcast', authMiddleware, adminOrOpManager, async (req, res) => {
  const { title, body } = req.body;
  if (!title) return res.json({ success: false, message: 'Укажите заголовок' });

  const db = await getDb();
  const usersResult = db.exec('SELECT id FROM users');
  const users = rowsToArray(usersResult);

  for (const u of users) {
    db.run("INSERT INTO notifications (user_id, title, body, type) VALUES (?, ?, ?, 'broadcast')", [u.id, title, body || null]);
  }
  saveDb();

  const io = req.app.get('io');
  if (io) {
    for (const u of users) {
      io.to(`user:${u.id}`).emit('broadcast', { title, body });
    }
  }

  db.run("INSERT INTO staff_action_log (staff_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
    [req.user.id, 'broadcast_all', 'broadcast', null, title]);

  return res.json({ success: true, data: { message: 'Уведомление отправлено всем пользователям' } });
});

// Рассылка конкретному пользователю
router.post('/broadcast/user', authMiddleware, adminOrOpManager, async (req, res) => {
  const { user_id, phone, username, title, body } = req.body;
  if (!title) return res.json({ success: false, message: 'Укажите заголовок' });
  if (!user_id && !phone && !username) return res.json({ success: false, message: 'Укажите user_id, phone или username' });

  const db = await getDb();
  let targetUser = null;

  if (user_id) {
    targetUser = rowToObject(dbExecBind('SELECT id, username FROM users WHERE id = ?', [parseInt(user_id)]));
  } else if (phone) {
    targetUser = rowToObject(dbExecBind('SELECT id, username FROM users WHERE phone = ?', [phone]));
  } else if (username) {
    const uname = username.startsWith('@') ? username : '@' + username;
    targetUser = rowToObject(dbExecBind('SELECT id, username FROM users WHERE username = ?', [uname]));
  }

  if (!targetUser) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

  db.run("INSERT INTO notifications (user_id, title, body, type) VALUES (?, ?, ?, 'broadcast')", [targetUser.id, title, body || null]);
  saveDb();

  const io = req.app.get('io');
  if (io) {
    io.to(`user:${targetUser.id}`).emit('broadcast', { title, body });
  }

  db.run("INSERT INTO staff_action_log (staff_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
    [req.user.id, 'broadcast_user', 'user', targetUser.id, title]);

  return res.json({ success: true, data: { message: `Уведомление отправлено пользователю ${targetUser.username}` } });
});

// Шаблоны сообщений
router.get('/broadcast/templates', authMiddleware, adminOrOpManager, async (req, res) => {
  const db = await getDb();
  const templates = rowsToArray(db.exec('SELECT * FROM broadcast_templates ORDER BY name'));
  return res.json({ success: true, data: templates });
});

router.post('/broadcast/templates', authMiddleware, adminOnly, async (req, res) => {
  const { name, title, body } = req.body;
  if (!name || !title) return res.status(400).json({ success: false, message: 'name и title обязательны' });
  const db = await getDb();
  db.run('INSERT INTO broadcast_templates (name, title, body) VALUES (?, ?, ?)', [name, title, body || null]);
  saveDb();
  return res.json({ success: true, data: { message: 'Шаблон создан' } });
});

router.delete('/broadcast/templates/:id', authMiddleware, adminOnly, async (req, res) => {
  const db = await getDb();
  db.run('DELETE FROM broadcast_templates WHERE id = ?', [parseInt(req.params.id)]);
  saveDb();
  return res.json({ success: true, data: { message: 'Шаблон удалён' } });
});

// Настройки системы
router.get('/settings', authMiddleware, adminOnly, async (req, res) => {
  const db = await getDb();
  const rulesCount = rowToObject(db.exec('SELECT COUNT(*) as cnt FROM moderation_rules'));
  const activeRules = rowToObject(db.exec('SELECT COUNT(*) as cnt FROM moderation_rules WHERE is_active = 1'));
  const totalViolations = rowToObject(db.exec('SELECT COUNT(*) as cnt FROM violations'));
  const totalStaff = rowToObject(db.exec('SELECT COUNT(*) as cnt FROM users WHERE is_admin = 1 OR is_moderator = 1 OR is_operation_manager = 1'));

  return res.json({
    success: true,
    data: {
      moderation_rules_total: rulesCount ? rulesCount.cnt : 0,
      moderation_rules_active: activeRules ? activeRules.cnt : 0,
      total_violations: totalViolations ? totalViolations.cnt : 0,
      total_staff: totalStaff ? totalStaff.cnt : 0,
      server_time: new Date().toISOString(),
      version: '1.0.0',
    }
  });
});

// Резервное копирование (экспорт БД)
router.post('/backup', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = await getDb();
    const data = db.export();
    const base64 = Buffer.from(data).toString('base64');
    const fileName = `hello_bro_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.db`;

    db.run("INSERT INTO staff_action_log (staff_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
      [req.user.id, 'backup', 'system', null, 'Создана резервная копия БД']);

    return res.json({
      success: true,
      data: {
        filename: fileName,
        size: data.length,
        backup_data: base64,
        created_at: new Date().toISOString(),
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Ошибка создания резервной копии: ' + e.message });
  }
});

// Проверка пароля для входа в админку (используется админ-панелью)
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Укажите логин и пароль' });

  const { generateToken } = require('../middleware/auth');
  const db = await getDb();

  // Проверяем через bcrypt (если используется хеширование в auth.js)
  const user = rowToObject(dbExecBind(
    'SELECT id, username, display_name, is_admin, is_moderator, is_operation_manager, is_blocked FROM users WHERE username = ? OR phone = ?',
    [username, username]
  ));

  if (!user || user.is_blocked) return res.status(401).json({ success: false, message: 'Неверные учетные данные' });

  // Временно: сравниваем пароли с захардкоженными (для админ-панели)
  // В реальном проекте нужно использовать bcrypt
  const adminPasswords = {
    'admin': '24052025',
    'moderator': '243355447fhj#Gdh4',
    'operation_manager': '355}%6hdgTbx4gdr4kG',
  };

  const expectedPassword = adminPasswords[user.username.replace('@hello_bro_', '')];
  if (!expectedPassword || password !== expectedPassword) {
    return res.status(401).json({ success: false, message: 'Неверные учетные данные' });
  }

  const token = generateToken(user.id);

  return res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        is_admin: !!user.is_admin,
        is_moderator: !!user.is_moderator,
        is_operation_manager: !!user.is_operation_manager,
      }
    }
  });
});

module.exports = router;
