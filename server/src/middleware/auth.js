const jwt = require('jsonwebtoken');
const { getDb, rowToObject, dbExecBind } = require('../db');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Требуется авторизация' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = getDb();
    if (typeof db.then === 'function') {
      db.then(realDb => {
        const result = dbExecBind('SELECT * FROM users WHERE id = ?', [decoded.userId]);
        const user = rowToObject(result);
        if (!user) {
          return res.status(401).json({ success: false, message: 'Пользователь не найден' });
        }
        if (user.is_blocked) {
          return res.status(403).json({ success: false, message: 'Пользователь заблокирован' });
        }
        req.user = user;
        next();
      }).catch(e => res.status(500).json({ success: false, message: 'DB error' }));
      return;
    }
    const result = dbExecBind('SELECT * FROM users WHERE id = ?', [decoded.userId]);
    const user = rowToObject(result);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Пользователь не найден' });
    }
    if (user.is_blocked) {
      return res.status(403).json({ success: false, message: 'Пользователь заблокирован' });
    }
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Недействительный токен' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user.is_admin) {
    return res.status(403).json({ success: false, message: 'Доступ только для администраторов' });
  }
  next();
}

function adminOrModerator(req, res, next) {
  if (!req.user.is_admin && !req.user.is_moderator) {
    return res.status(403).json({ success: false, message: 'Доступ только для администраторов и модераторов' });
  }
  next();
}

function adminOrOpManager(req, res, next) {
  if (!req.user.is_admin && !req.user.is_operation_manager) {
    return res.status(403).json({ success: false, message: 'Доступ только для администраторов и операционных менеджеров' });
  }
  next();
}

function staffOnly(req, res, next) {
  if (!req.user.is_admin && !req.user.is_moderator && !req.user.is_operation_manager) {
    return res.status(403).json({ success: false, message: 'Доступ только для персонала' });
  }
  next();
}

function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

module.exports = { authMiddleware, adminOnly, adminOrModerator, adminOrOpManager, staffOnly, generateToken, JWT_SECRET };
