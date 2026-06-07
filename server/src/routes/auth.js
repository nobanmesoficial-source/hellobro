const express = require('express');
const { getDb, dbExecBind } = require('../db');
const { generateToken } = require('../middleware/auth');

const router = express.Router();

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('8') && cleaned.length === 11) {
      cleaned = '+7' + cleaned.slice(1);
    } else if (cleaned.length === 10) {
      cleaned = '+7' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }
  return cleaned;
}

router.post('/register', async (req, res) => {
  try {
    const { phone, username, display_name } = req.body;
    if (!phone || !username || !display_name) {
      return res.json({ success: false, message: 'Заполните все поля' });
    }

    const cleanedPhone = normalizePhone(phone);
    let cleanUsername = username.trim();
    if (!cleanUsername.startsWith('@')) cleanUsername = '@' + cleanUsername;

    const db = await getDb();

    const existingPhone = dbExecBind('SELECT id FROM users WHERE phone = ?', [cleanedPhone]);
    if (existingPhone.length > 0 && existingPhone[0].values.length > 0) {
      return res.json({ success: false, message: 'Этот номер телефона уже зарегистрирован' });
    }

    const existingUser = dbExecBind('SELECT id FROM users WHERE username = ?', [cleanUsername]);
    if (existingUser.length > 0 && existingUser[0].values.length > 0) {
      return res.json({ success: false, message: 'Этот username уже занят' });
    }

    db.run('INSERT INTO users (phone, username, display_name, is_online, last_seen) VALUES (?, ?, ?, 1, datetime(\'now\',\'localtime\'))',
      [cleanedPhone, cleanUsername, display_name.trim()]);

    const result = db.exec('SELECT last_insert_rowid() as id');
    const userId = result[0].values[0][0];

    const { saveDb } = require('../db');
    saveDb();

    const token = generateToken(userId);

    return res.json({
      success: true,
      data: {
        user_id: userId,
        token,
        phone: cleanedPhone,
        username: cleanUsername,
        display_name: display_name.trim(),
        is_admin: 0,
        is_moderator: 0,
        is_blocked: 0,
        created_at: new Date().toISOString(),
      }
    });
  } catch (e) {
    console.error('Register error:', e);
    return res.json({ success: false, message: 'Ошибка регистрации: ' + e.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.json({ success: false, message: 'Введите номер телефона' });
    }

    const cleanedPhone = normalizePhone(phone);
    const db = await getDb();

    const result = dbExecBind('SELECT * FROM users WHERE phone = ?', [cleanedPhone]);
    if (result.length === 0 || result[0].values.length === 0) {
      return res.json({ success: false, message: 'Пользователь с таким номером не найден' });
    }

    const cols = result[0].columns;
    const vals = result[0].values[0];
    const user = {};
    cols.forEach((col, i) => user[col] = vals[i]);

    if (user.is_blocked) {
      return res.json({ success: false, message: 'Ваш аккаунт заблокирован' });
    }

    if (user.twofa_enabled) {
      return res.json({
        success: true,
        requires_2fa: true,
        data: {
          user_id: user.id,
          requires_2fa: true,
        },
      });
    }

    db.run('UPDATE users SET is_online = 1, last_seen = datetime(\'now\',\'localtime\') WHERE id = ?', [user.id]);
    saveDb();

    const token = generateToken(user.id);

    return res.json({
      success: true,
      data: {
        user_id: user.id,
        token,
        phone: user.phone,
        username: user.username,
        display_name: user.display_name,
        profile_picture: user.profile_picture,
        is_online: 1,
        last_seen: new Date().toISOString(),
        hide_last_seen: !!user.hide_last_seen,
        hide_phone: !!user.hide_phone,
        is_admin: !!user.is_admin,
        is_moderator: !!user.is_moderator,
        is_blocked: !!user.is_blocked,
        twofa_enabled: false,
        created_at: user.created_at,
      }
    });
  } catch (e) {
    console.error('Login error:', e);
    return res.json({ success: false, message: 'Ошибка входа' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const jwt = require('jsonwebtoken');
      const { JWT_SECRET } = require('../middleware/auth');
      const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
      const db = await getDb();
      db.run('UPDATE users SET is_online = 0, last_seen = datetime(\'now\',\'localtime\') WHERE id = ?', [decoded.userId]);
      saveDb();
    }
    return res.json({ success: true, data: { message: 'Выход выполнен' } });
  } catch (e) {
    return res.json({ success: false, message: 'Ошибка выхода' });
  }
});

module.exports = router;
