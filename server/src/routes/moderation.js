const express = require('express');
const { getDb, saveDb, rowToObject, rowsToArray, dbExecBind, lastInsertId, getMessageFull } = require('../db');
const { authMiddleware, adminOnly, staffOnly } = require('../middleware/auth');

const router = express.Router();

// Запрещённые в РФ категории (ключевые слова для локальной проверки на клиенте)
const BANNED_CATEGORIES = {
  extremism: 'Экстремизм и терроризм',
  terrorism: 'Терроризм',
  drugs: 'Наркотические вещества',
  drug_dealer: 'Распространение наркотиков',
  lgbt_propaganda: 'Пропаганда нетрадиционных отношений',
  sanctions: 'Призывы к санкциям',
  fake_government: 'Дискредитация власти',
  fake_news: 'Недостоверная информация',
  suicide: 'Суицид',
  child_safety: 'Нарушение прав несовершеннолетних',
  state_symbols: 'Оскорбление гос. символов',
  hate_speech: 'Разжигание ненависти',
  nazism: 'Нацизм',
  supremacy: 'Превосходство',
  call_sanctions: 'Призывы к санкциям',
  suicide_methods: 'Способы суицида',
  lgbt_propaganda: 'ЛГБТ пропаганда',
  terror_act: 'Террористический акт',
  explosives: 'Взрывчатые вещества',
  weapons_mass: 'Оружие массового поражения',
  drug_hide: 'Закладки наркотиков',
  drugs_slang: 'Наркотики (сленг)',
};

// POST /scan — клиент отправляет сообщение на проверку
router.post('/scan', authMiddleware, async (req, res) => {
  const { chat_id, message_id, content, message_type } = req.body;
  if (!content && message_type !== 'text') {
    return res.json({ success: true, data: { is_violation: false } });
  }

  const db = await getDb();
  const textToCheck = (content || '').toLowerCase();

  // Загружаем активные правила модерации
  const rules = rowsToArray(db.exec('SELECT * FROM moderation_rules WHERE is_active = 1'));

  const matchedRules = [];
  for (const rule of rules) {
    if (textToCheck.includes(rule.pattern.toLowerCase())) {
      matchedRules.push(rule);
    }
  }

  if (matchedRules.length === 0) {
    return res.json({ success: true, data: { is_violation: false } });
  }

  // Проверка иммунитета у отправителя
  const senderRes = dbExecBind('SELECT is_immune FROM users WHERE id = ?', [req.user.id]);
  const sender = rowToObject(senderRes);
  if (sender && sender.is_immune) {
    return res.json({ success: true, data: { is_violation: false, immune: true } });
  }

  // Создаём нарушение
  const maxSeverity = Math.max(...matchedRules.map(r => r.severity));
  const categories = [...new Set(matchedRules.map(r => r.category))];
  const reason = `Обнаружены совпадения: ${categories.map(c => BANNED_CATEGORIES[c] || c).join(', ')}`;

  db.run(
    'INSERT INTO violations (target_user_id, chat_id, reason, description, source, status) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.id, chat_id || null, reason, `Матчинг по ${matchedRules.length} правилам`, 'keyword', 'open']
  );
  const violationId = lastInsertId();

  // Автоматически расшифровываем последние 20 сообщений в чате
  if (chat_id) {
    autoDecryptChatMessages(db, violationId, req.user.id, chat_id);
  }

  saveDb();

  const io = req.app.get('io');
  if (io) {
    io.to('staff_room').emit('new_violation', {
      violation_id: violationId,
      target_user_id: req.user.id,
      reason,
      created_at: new Date().toISOString(),
    });
  }

  return res.json({
    success: true,
    data: {
      is_violation: true,
      violation_id: violationId,
      reason,
      matched_categories: categories,
    }
  });
});

// POST /report — жалоба пользователя
router.post('/report', authMiddleware, async (req, res) => {
  const { target_user_id, chat_id, message_id, reason, description } = req.body;
  if (!target_user_id || !reason) {
    return res.status(400).json({ success: false, message: 'target_user_id и reason обязательны' });
  }

  const db = await getDb();

  // Существующая таблица violation_reports
  db.run(
    'INSERT INTO violation_reports (reporter_id, target_id, chat_id, message_id, reason, description, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.user.id, target_user_id, chat_id || null, message_id || null, reason, description || null, 'pending']
  );
  saveDb();

  return res.json({ success: true, data: { message: 'Жалоба отправлена' } });
});

// GET /violations — список нарушений (для персонала)
router.get('/violations', authMiddleware, staffOnly, async (req, res) => {
  const db = await getDb();
  const { status, user_id, limit = 50, offset = 0 } = req.query;

  let sql = `
    SELECT v.*, u.username, u.display_name, u.profile_picture,
      (SELECT COUNT(*) FROM violation_messages vm WHERE vm.violation_id = v.id) as messages_count
    FROM violations v
    JOIN users u ON v.target_user_id = u.id
  `;
  const params = [];
  const conditions = [];

  if (status) {
    conditions.push('v.status = ?');
    params.push(status);
  }
  if (user_id) {
    conditions.push('v.target_user_id = ?');
    params.push(parseInt(user_id));
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY v.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const result = dbExecBind(sql, params);
  const violations = rowsToArray(result);

  // Total count
  let countSql = 'SELECT COUNT(*) as cnt FROM violations v';
  const countParams = [];
  const countConditions = [];
  if (status) { countConditions.push('v.status = ?'); countParams.push(status); }
  if (user_id) { countConditions.push('v.target_user_id = ?'); countParams.push(parseInt(user_id)); }
  if (countConditions.length > 0) countSql += ' WHERE ' + countConditions.join(' AND ');
  const total = rowToObject(dbExecBind(countSql, countParams));

  return res.json({
    success: true,
    data: violations,
    total: total ? total.cnt : 0,
  });
});

// GET /violations/:id/messages — получить расшифрованные сообщения
router.get('/violations/:id/messages', authMiddleware, staffOnly, async (req, res) => {
  const db = await getDb();
  const vmRes = dbExecBind(
    'SELECT * FROM violation_messages WHERE violation_id = ? ORDER BY created_at ASC',
    [parseInt(req.params.id)]
  );
  const messages = rowsToArray(vmRes);

  const violRes = dbExecBind('SELECT * FROM violations WHERE id = ?', [parseInt(req.params.id)]);
  const violation = rowToObject(violRes);

  return res.json({ success: true, data: { violation, messages } });
});

// POST /violations/:id/action — действие по нарушению
router.post('/violations/:id/action', authMiddleware, staffOnly, async (req, res) => {
  const { action } = req.body; // ban, warn, immune, delete, resolve
  const violationId = parseInt(req.params.id);

  if (!['ban', 'warn', 'immune', 'delete', 'resolve'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Неверное действие' });
  }

  const db = await getDb();
  const violRes = dbExecBind('SELECT * FROM violations WHERE id = ?', [violationId]);
  const violation = rowToObject(violRes);
  if (!violation) {
    return res.status(404).json({ success: false, message: 'Нарушение не найдено' });
  }

  const targetUserId = violation.target_user_id;

  switch (action) {
    case 'ban':
      db.run('UPDATE users SET is_blocked = 1 WHERE id = ?', [targetUserId]);
      db.run("UPDATE violations SET status = 'banned', resolved_by = ?, resolved_at = datetime('now','localtime') WHERE id = ?", [req.user.id, violationId]);
      // Отключаем сокет пользователя
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${targetUserId}`).emit('force_logout', { reason: 'Ваш аккаунт заблокирован за нарушение правил' });
      }
      break;
    case 'warn':
      db.run("UPDATE violations SET status = 'warned', resolved_by = ?, resolved_at = datetime('now','localtime') WHERE id = ?", [req.user.id, violationId]);
      // Отправляем уведомление
      db.run("INSERT INTO notifications (user_id, title, body, type) VALUES (?, ?, ?, 'warning')",
        [targetUserId, 'Предупреждение о нарушении', 'Ваше сообщение нарушает правила платформы. Пожалуйста, ознакомьтесь с правилами.']);
      const ioWarn = req.app.get('io');
      if (ioWarn) {
        ioWarn.to(`user:${targetUserId}`).emit('warning', { title: 'Предупреждение', body: 'Ваше сообщение нарушает правила платформы.' });
      }
      break;
    case 'immune':
      db.run('UPDATE users SET is_immune = 1 WHERE id = ?', [targetUserId]);
      db.run("UPDATE violations SET status = 'immune', resolved_by = ?, resolved_at = datetime('now','localtime') WHERE id = ?", [req.user.id, violationId]);
      break;
    case 'delete':
      // Удаляем сообщение если указано
      if (violation.message_id) {
        db.run('UPDATE messages SET is_deleted = 1, content = NULL WHERE id = ?', [violation.message_id]);
      }
      if (violation.chat_id) {
        // Удаляем все сообщения нарушителя за последние 24 часа в этом чате
        db.run("UPDATE messages SET is_deleted = 1, content = NULL WHERE sender_id = ? AND chat_id = ? AND created_at > datetime('now', '-1 day')",
          [targetUserId, violation.chat_id]);
      }
      db.run("UPDATE violations SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now','localtime') WHERE id = ?", [req.user.id, violationId]);
      break;
    case 'resolve':
      db.run("UPDATE violations SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now','localtime') WHERE id = ?", [req.user.id, violationId]);
      break;
  }

  // Логируем действие
  db.run(
    'INSERT INTO staff_action_log (staff_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [req.user.id, `violation_${action}`, 'violation', violationId, `Действие над нарушением #${violationId} пользователя #${targetUserId}`]
  );

  saveDb();

  return res.json({ success: true, data: { message: `Действие "${action}" выполнено` } });
});

// POST /auto-decrypt — принудительно расшифровать последние 20 сообщений и создать нарушение
router.post('/auto-decrypt', authMiddleware, staffOnly, async (req, res) => {
  const { chat_id, target_user_id, reason } = req.body;
  if (!chat_id || !target_user_id) {
    return res.status(400).json({ success: false, message: 'chat_id и target_user_id обязательны' });
  }

  const db = await getDb();

  // Создаём нарушение
  db.run(
    'INSERT INTO violations (target_user_id, chat_id, reason, description, source, status) VALUES (?, ?, ?, ?, ?, ?)',
    [target_user_id, chat_id, reason || 'Ручная проверка персоналом', 'Автоматическая расшифровка по запросу персонала', 'auto', 'open']
  );
  const violationId = lastInsertId();

  // Расшифровываем
  const msgs = await autoDecryptChatMessages(db, violationId, target_user_id, chat_id);

  saveDb();

  return res.json({
    success: true,
    data: {
      violation_id: violationId,
      messages_count: msgs.length,
    }
  });
});

// POST /check-text — серверная проверка текста
router.post('/check-text', authMiddleware, async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.json({ success: true, data: { is_violation: false } });
  }

  const db = await getDb();
  const textLower = text.toLowerCase();
  const rules = rowsToArray(db.exec('SELECT * FROM moderation_rules WHERE is_active = 1'));

  const matched = rules.filter(r => textLower.includes(r.pattern.toLowerCase()));
  if (matched.length === 0) {
    return res.json({ success: true, data: { is_violation: false } });
  }

  const categories = [...new Set(matched.map(r => r.category))];
  return res.json({
    success: true,
    data: {
      is_violation: true,
      matched_categories: categories,
      matched_patterns: matched.map(r => ({ pattern: r.pattern, category: r.category, severity: r.severity })),
    }
  });
});

// GET /rules — список правил модерации
router.get('/rules', authMiddleware, staffOnly, async (req, res) => {
  const db = await getDb();
  const rules = rowsToArray(db.exec('SELECT * FROM moderation_rules ORDER BY category, severity'));
  return res.json({ success: true, data: rules });
});

// POST /rules — добавить правило
router.post('/rules', authMiddleware, adminOnly, async (req, res) => {
  const { pattern, category, severity } = req.body;
  if (!pattern) return res.status(400).json({ success: false, message: 'pattern обязателен' });

  const db = await getDb();
  try {
    db.run('INSERT INTO moderation_rules (pattern, category, severity, created_by) VALUES (?, ?, ?, ?)',
      [pattern, category || 'general', severity || 1, req.user.id]);
    saveDb();
    return res.json({ success: true, data: { message: 'Правило добавлено' } });
  } catch (e) {
    return res.status(400).json({ success: false, message: 'Такое правило уже существует' });
  }
});

// DELETE /rules/:id — удалить правило
router.delete('/rules/:id', authMiddleware, adminOnly, async (req, res) => {
  const db = await getDb();
  db.run('DELETE FROM moderation_rules WHERE id = ?', [parseInt(req.params.id)]);
  saveDb();
  return res.json({ success: true, data: { message: 'Правило удалено' } });
});

// PUT /rules/:id — обновить правило
router.put('/rules/:id', authMiddleware, adminOnly, async (req, res) => {
  const { pattern, category, severity, is_active } = req.body;
  const db = await getDb();
  const updates = [];
  const params = [];
  if (pattern !== undefined) { updates.push('pattern = ?'); params.push(pattern); }
  if (category !== undefined) { updates.push('category = ?'); params.push(category); }
  if (severity !== undefined) { updates.push('severity = ?'); params.push(severity); }
  if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }

  if (updates.length === 0) return res.status(400).json({ success: false, message: 'Нет полей для обновления' });

  params.push(parseInt(req.params.id));
  db.run(`UPDATE moderation_rules SET ${updates.join(', ')} WHERE id = ?`, params);
  saveDb();
  return res.json({ success: true, data: { message: 'Правило обновлено' } });
});

// Вспомогательная функция: расшифровать последние 20 сообщений из чата
function autoDecryptChatMessages(db, violationId, targetUserId, chatId) {
  const rawMsgs = dbExecBind(`
    SELECT m.id, m.sender_id, m.content, m.message_type, m.media_url, m.created_at,
      u.display_name as sender_name, u.profile_picture as sender_avatar
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.chat_id = ? AND m.is_deleted = 0
    ORDER BY m.created_at DESC LIMIT 20
  `, [chatId]);

  const messages = rowsToArray(rawMsgs).reverse(); // хронологический порядок

  for (const msg of messages) {
    try {
      db.run(
        'INSERT OR IGNORE INTO violation_messages (violation_id, message_id, sender_id, sender_name, sender_avatar, content, message_type, media_url, created_at, is_from_violator) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          violationId,
          msg.id,
          msg.sender_id,
          msg.sender_name || 'Unknown',
          msg.sender_avatar || null,
          msg.content || null,
          msg.message_type || 'text',
          msg.media_url || null,
          msg.created_at,
          msg.sender_id === targetUserId ? 1 : 0,
        ]
      );
    } catch (e) {
      console.warn(`⚠️ Failed to insert violation message: ${e.message}`);
    }
  }

  // Отмечаем, что расшифровка выполнена
  db.run('UPDATE violations SET auto_decrypted = 1, description = ? WHERE id = ?',
    [`Автоматически расшифровано ${messages.length} сообщений`, violationId]);

  return messages;
}

module.exports = router;
