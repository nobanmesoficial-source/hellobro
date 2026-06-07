const express = require('express');
const crypto = require('crypto');
const { getDb, saveDb, rowToObject, rowsToArray, dbExecBind } = require('../db');
const { authMiddleware, generateToken } = require('../middleware/auth');

const router = express.Router();

function generateTotpSecret() {
  const buf = crypto.randomBytes(20);
  const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += base32[parseInt(bits.substr(i, 5), 2)];
  }
  return out;
}

function base32ToBuffer(str) {
  const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  str = str.replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
  let bits = '';
  for (const ch of str) {
    const idx = base32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character: ' + ch);
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = Math.floor(bits.length / 8);
  const out = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) {
    out[i] = parseInt(bits.substr(i * 8, 8), 2);
  }
  return out;
}

function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    buf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const key = base32ToBuffer(secret);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, '0');
}

function totp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / 30);
  return hotp(secret, counter);
}

function verifyTotp(secret, code) {
  if (!code || typeof code !== 'string') return false;
  const cleaned = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  const t = Date.now();
  for (let delta of [-60, 0, 60]) {
    const expected = totp(secret, t + delta * 1000);
    if (expected === cleaned) return true;
  }
  return false;
}

function publicUser(user) {
  return {
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
  };
}

// TOTP: начать настройку (генерируем секрет, но НЕ включаем)
router.post('/2fa/setup', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const userRes = dbExecBind('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const user = rowToObject(userRes);
    if (!user) return res.json({ success: false, message: 'Пользователь не найден' });

    const secret = generateTotpSecret();
    db.run('UPDATE users SET totp_secret = ?, twofa_enabled = 0 WHERE id = ?', [secret, req.user.id]);
    saveDb();

    const issuer = 'Hello Bro';
    const label = encodeURIComponent(user.username || `user_${user.id}`);
    const otpauth = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}`;

    return res.json({
      success: true,
      data: {
        secret,
        otpauth_url: otpauth,
        // base32 secret to display in UI as text
        manual_entry_key: secret.match(/.{1,4}/g).join(' '),
      },
    });
  } catch (e) {
    console.error('2fa setup error:', e);
    return res.json({ success: false, message: 'Ошибка настройки 2FA' });
  }
});

// TOTP: подтвердить код и включить
router.post('/2fa/enable', authMiddleware, async (req, res) => {
  try {
    const { code } = req.body;
    const db = await getDb();
    const userRes = dbExecBind('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const user = rowToObject(userRes);
    if (!user || !user.totp_secret) {
      return res.json({ success: false, message: 'Сначала запросите /2fa/setup' });
    }
    if (!verifyTotp(user.totp_secret, code)) {
      return res.json({ success: false, message: 'Неверный код' });
    }
    db.run('UPDATE users SET twofa_enabled = 1 WHERE id = ?', [req.user.id]);
    saveDb();
    return res.json({ success: true, data: { message: '2FA включена', twofa_enabled: true } });
  } catch (e) {
    console.error('2fa enable error:', e);
    return res.json({ success: false, message: 'Ошибка' });
  }
});

// TOTP: выключить (требует код)
router.post('/2fa/disable', authMiddleware, async (req, res) => {
  try {
    const { code } = req.body;
    const db = await getDb();
    const userRes = dbExecBind('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const user = rowToObject(userRes);
    if (!user || !user.twofa_enabled) {
      return res.json({ success: false, message: '2FA не включена' });
    }
    if (!verifyTotp(user.totp_secret, code)) {
      return res.json({ success: false, message: 'Неверный код' });
    }
    db.run('UPDATE users SET twofa_enabled = 0, totp_secret = NULL WHERE id = ?', [req.user.id]);
    saveDb();
    return res.json({ success: true, data: { message: '2FA выключена', twofa_enabled: false } });
  } catch (e) {
    return res.json({ success: false, message: 'Ошибка' });
  }
});

// TOTP: логин с 2FA
router.post('/2fa/verify-login', async (req, res) => {
  try {
    const { user_id, code } = req.body;
    if (!user_id || !code) return res.json({ success: false, message: 'Нет данных' });
    const db = await getDb();
    const userRes = dbExecBind('SELECT * FROM users WHERE id = ?', [user_id]);
    const user = rowToObject(userRes);
    if (!user) return res.json({ success: false, message: 'Пользователь не найден' });
    if (!user.twofa_enabled) {
      return res.json({ success: false, message: '2FA не включена для этого аккаунта' });
    }
    if (!verifyTotp(user.totp_secret, code)) {
      return res.json({ success: false, message: 'Неверный код' });
    }
    if (user.is_blocked) {
      return res.json({ success: false, message: 'Ваш аккаунт заблокирован' });
    }
    db.run('UPDATE users SET is_online = 1, last_seen = datetime(\'now\',\'localtime\') WHERE id = ?', [user.id]);
    saveDb();
    const token = generateToken(user.id);
    return res.json({ success: true, data: { ...publicUser(user), token } });
  } catch (e) {
    console.error('2fa verify-login error:', e);
    return res.json({ success: false, message: 'Ошибка' });
  }
});

// Blacklist
router.get('/blacklist', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const result = dbExecBind(
      `SELECT u.id, u.username, u.display_name, u.profile_picture, b.created_at
       FROM blacklist b JOIN users u ON b.blocked_id = u.id
       WHERE b.user_id = ? ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    return res.json({ success: true, data: rowsToArray(result) });
  } catch (e) {
    return res.json({ success: false, message: 'Ошибка' });
  }
});

router.post('/blacklist/:id', authMiddleware, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) return res.json({ success: false, message: 'Нельзя заблокировать себя' });
    const db = await getDb();
    const exists = dbExecBind('SELECT 1 FROM users WHERE id = ?', [targetId]);
    if (exists.length === 0 || exists[0].values.length === 0) {
      return res.json({ success: false, message: 'Пользователь не найден' });
    }
    db.run('INSERT OR IGNORE INTO blacklist (user_id, blocked_id) VALUES (?, ?)', [req.user.id, targetId]);
    saveDb();
    return res.json({ success: true, data: { message: 'Пользователь заблокирован' } });
  } catch (e) {
    return res.json({ success: false, message: 'Ошибка' });
  }
});

router.delete('/blacklist/:id', authMiddleware, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const db = await getDb();
    db.run('DELETE FROM blacklist WHERE user_id = ? AND blocked_id = ?', [req.user.id, targetId]);
    saveDb();
    return res.json({ success: true, data: { message: 'Пользователь разблокирован' } });
  } catch (e) {
    return res.json({ success: false, message: 'Ошибка' });
  }
});

// Privacy: обновление настроек
router.put('/privacy', authMiddleware, async (req, res) => {
  try {
    const { hide_last_seen, hide_phone } = req.body;
    const updates = [];
    const params = [];
    if (hide_last_seen !== undefined) { updates.push('hide_last_seen = ?'); params.push(hide_last_seen ? 1 : 0); }
    if (hide_phone !== undefined) { updates.push('hide_phone = ?'); params.push(hide_phone ? 1 : 0); }
    if (updates.length === 0) return res.json({ success: true, data: { message: 'Нет изменений' } });
    params.push(req.user.id);
    const db = await getDb();
    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    saveDb();
    const updatedRes = dbExecBind('SELECT hide_last_seen, hide_phone FROM users WHERE id = ?', [req.user.id]);
    const updated = rowToObject(updatedRes);
    return res.json({
      success: true,
      data: {
        message: 'Приватность обновлена',
        hide_last_seen: !!updated?.hide_last_seen,
        hide_phone: !!updated?.hide_phone,
      },
    });
  } catch (e) {
    return res.json({ success: false, message: 'Ошибка' });
  }
});

// Self-destruct: установить таймер удаления для сообщения
router.post('/messages/:id/expire', authMiddleware, async (req, res) => {
  try {
    const { seconds } = req.body;
    if (!seconds || seconds < 10) {
      return res.json({ success: false, message: 'Минимум 10 секунд' });
    }
    if (seconds > 30 * 24 * 60 * 60) {
      return res.json({ success: false, message: 'Максимум 30 дней' });
    }
    const db = await getDb();
    const msgRes = dbExecBind(
      'SELECT * FROM messages WHERE id = ? AND sender_id = ? AND is_deleted = 0',
      [parseInt(req.params.id), req.user.id]
    );
    const msg = rowToObject(msgRes);
    if (!msg) return res.json({ success: false, message: 'Сообщение не найдено' });

    const expiresAt = new Date(Date.now() + seconds * 1000).toISOString().replace('T', ' ').split('.')[0];
    db.run("UPDATE messages SET expires_at = ? WHERE id = ?", [expiresAt, parseInt(req.params.id)]);
    saveDb();

    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${msg.chat_id}`).emit('message_updated', {
        message_id: parseInt(req.params.id),
        chat_id: msg.chat_id,
        expires_at: expiresAt,
      });
    }
    return res.json({ success: true, data: { message_id: parseInt(req.params.id), expires_at: expiresAt } });
  } catch (e) {
    console.error('expire error:', e);
    return res.json({ success: false, message: 'Ошибка' });
  }
});

router.delete('/messages/:id/expire', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const msgRes = dbExecBind(
      'SELECT * FROM messages WHERE id = ? AND sender_id = ?',
      [parseInt(req.params.id), req.user.id]
    );
    const msg = rowToObject(msgRes);
    if (!msg) return res.json({ success: false, message: 'Сообщение не найдено' });
    db.run('UPDATE messages SET expires_at = NULL WHERE id = ?', [parseInt(req.params.id)]);
    saveDb();
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${msg.chat_id}`).emit('message_updated', {
        message_id: parseInt(req.params.id),
        chat_id: msg.chat_id,
        expires_at: null,
      });
    }
    return res.json({ success: true, data: { message_id: parseInt(req.params.id) } });
  } catch (e) {
    return res.json({ success: false, message: 'Ошибка' });
  }
});

// Worker: удаляет просроченные сообщения раз в 30 секунд
function startExpireWorker(io) {
  setInterval(() => {
    try {
      const dbPromise = require('../db').getDb();
      dbPromise.then(db => {
        try {
          const res = db.exec(
            "SELECT id, chat_id FROM messages WHERE expires_at IS NOT NULL AND expires_at <= datetime('now','localtime')"
          );
          if (res.length === 0 || res[0].values.length === 0) return;
          const expired = res[0].values.map(r => ({ id: r[0], chat_id: r[1] }));
          for (const m of expired) {
            db.run("UPDATE messages SET is_deleted = 1, content = NULL, expires_at = NULL WHERE id = ?", [m.id]);
            if (io) {
              io.to(`chat:${m.chat_id}`).emit('message_updated', {
                message_id: m.id,
                chat_id: m.chat_id,
                is_deleted: 1,
                content: null,
                reason: 'expired',
              });
              io.to(`chat:${m.chat_id}`).emit('message_deleted', {
                message_id: m.id,
                chat_id: m.chat_id,
                reason: 'expired',
              });
            }
          }
          if (expired.length > 0) {
            saveDb();
            console.log(`🗑️ Expired ${expired.length} messages`);
          }
        } catch (e) {
          console.warn('Expire worker error:', e.message);
        }
      }).catch(e => console.warn('Expire worker db error:', e.message));
    } catch (e) {}
  }, 30 * 1000);
}

module.exports = {
  router,
  startExpireWorker,
  verifyTotp,
};
