const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const pinoHttp = require('pino-http');
const promClient = require('prom-client');
const NodeCache = require('node-cache');
const { getDb, saveDb } = require('./db');
const { JWT_SECRET } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const chatRoutes = require('./routes/chats');
const messageRoutes = require('./routes/messages');
const callRoutes = require('./routes/calls');
const storyRoutes = require('./routes/stories');
const friendRoutes = require('./routes/friends');
const adminRoutes = require('./routes/admin');
const systemRoutes = require('./routes/system');
const searchRoutes = require('./routes/search');
const bookmarkRoutes = require('./routes/bookmarks');
const scheduledRoutes = require('./routes/scheduled');
const securityRoutes = require('./routes/security');
const stickerRoutes = require('./routes/stickers');
const pollRoutes = require('./routes/polls');
const gifRoutes = require('./routes/gifs');
const moderationRoutes = require('./routes/moderation');
const { startScheduledWorker } = scheduledRoutes;
const { startExpireWorker } = securityRoutes;

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  path: '/ws',
});

const { getMessageFull, rowsToArray, rowToObject, dbExecBind } = require('./db');

// Logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

app.use(pinoHttp({ logger }));

// Cache
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
app.set('cache', cache);

// Metrics
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ register: promClient.register });

const httpRequestDurationMicroseconds = new promClient.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 3000],
});

app.use((req, res, next) => {
  const end = httpRequestDurationMicroseconds.startTimer();
  res.on('finish', () => {
    end({ method: req.method, route: req.route ? req.route.path : req.path, status_code: res.statusCode });
  });
  next();
});

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
  } catch (e) {
    res.status(500).end(e.message);
  }
});

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.set('io', io);

// Rate limiters
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, message: 'Слишком много попыток входа. Попробуйте позже.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, message: 'Слишком много попыток регистрации. Попробуйте позже.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { success: false, message: 'Слишком много запросов. Попробуйте позже.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec('SELECT COUNT(*) as cnt FROM users WHERE is_online = 1');
    const activeUsers = (result.length > 0 && result[0].values.length > 0) ? result[0].values[0][0] : 0;
    res.json({
      status: 'ok',
      active_users: activeUsers,
      server_time: new Date().toISOString(),
      version: '1.0.0',
    });
  } catch (e) {
    res.json({ status: 'error', message: e.message });
  }
});

// Routes
app.use('/api/v1/auth/login', loginLimiter);
app.use('/api/v1/auth/register', registerLimiter);
app.use('/api/v1', apiLimiter);

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/chats', chatRoutes);
app.use('/api/v1', messageRoutes);
app.use('/api/v1/calls', callRoutes);
app.use('/api/v1/stories', storyRoutes);
app.use('/api/v1/friends', friendRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/system', systemRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/bookmarks', bookmarkRoutes);
app.use('/api/v1/scheduled-messages', scheduledRoutes);
app.use('/api/v1/security', securityRoutes.router);
app.use('/api/v1/stickers', stickerRoutes);
app.use('/api/v1/polls', pollRoutes);
app.use('/api/v1/gifs', gifRoutes);
app.use('/api/v1/moderation', moderationRoutes);

// Админ-панель (HTML)
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));
app.get('/admin*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin', 'index.html'));
});

// Panic mode
app.post('/api/v1/panic-mode', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Auth required' });
  }
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    const db = await getDb();
    db.run('UPDATE users SET panic_mode_triggered = 1 WHERE id = ?', [decoded.userId]);
    saveDb();
    return res.json({ success: true, data: { message: 'Панический режим активирован' } });
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
});

// Socket.IO
io.on('connection', (socket) => {
  const token = socket.handshake.query.token;
  if (!token) {
    socket.disconnect();
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    getDb().then(db => {
      db.run('UPDATE users SET is_online = 1, last_seen = datetime(\'now\',\'localtime\') WHERE id = ?', [userId]);
      saveDb();

      socket.join(`user:${userId}`);
      socket.data.userId = userId;

      socket.broadcast.emit('user_online', { user_id: userId });
    });

    // Присоединение к комнате персонала (для уведомлений о нарушениях)
    getDb().then(db => {
      const userRes = dbExecBind('SELECT is_admin, is_moderator, is_operation_manager FROM users WHERE id = ?', [userId]);
      if (userRes.length > 0 && userRes[0].values.length > 0) {
        const u = userRes[0].values[0];
        if (u[0] || u[1] || u[2]) {
          socket.join('staff_room');
        }
      }
    }).catch(() => {});

    socket.on('join_chat', ({ chat_id }) => {
      socket.join(`chat:${chat_id}`);
    });

    socket.on('leave_chat', ({ chat_id }) => {
      socket.leave(`chat:${chat_id}`);
    });

    socket.on('send_message', async (data) => {
      const { chat_id, message_type, content, encrypted_content, session_key, sticker_id, duration, reply_to } = data;
      if (!chat_id) return;

      const db = await getDb();
      const replyToId = reply_to ? parseInt(reply_to) : null;
      db.run(`
        INSERT INTO messages (chat_id, sender_id, message_type, content, encrypted_content, session_key, sticker_id, duration, reply_to)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [chat_id, userId, message_type || 'text', content || null, encrypted_content || null, session_key || null, sticker_id || null, duration || null, replyToId]);

      const idResult = db.exec('SELECT last_insert_rowid() as id');
      const messageId = idResult[0].values[0][0];

      db.run('INSERT INTO message_status (message_id, user_id, status) VALUES (?, ?, ?)', [messageId, userId, 'sent']);
      const others = dbExecBind('SELECT user_id FROM chat_participants WHERE chat_id = ? AND user_id != ?', [chat_id, userId]);
      for (const p of rowsToArray(others)) {
        db.run('INSERT INTO message_status (message_id, user_id, status) VALUES (?, ?, ?)', [messageId, p.user_id, 'sent']);
      }
      saveDb();

      const message = getMessageFull(db, messageId);
      if (message) {
        io.to(`chat:${chat_id}`).emit('new_message', message);
      }
    });

    socket.on('edit_message', async (data) => {
      const { message_id, content } = data;
      if (!message_id || content == null) return;
      const db = await getDb();
      const msgRes = dbExecBind('SELECT * FROM messages WHERE id = ? AND sender_id = ? AND is_deleted = 0', [message_id, userId]);
      const msg = rowToObject(msgRes);
      if (!msg) return;
      db.run("UPDATE messages SET content = ?, edited_at = datetime('now','localtime') WHERE id = ?", [content, message_id]);
      saveDb();
      const updated = getMessageFull(db, message_id);
      io.to(`chat:${msg.chat_id}`).emit('message_edited', updated);
    });

    socket.on('delete_message', async (data) => {
      const { message_id } = data;
      if (!message_id) return;
      const db = await getDb();
      const msgRes = dbExecBind('SELECT * FROM messages WHERE id = ? AND sender_id = ?', [message_id, userId]);
      const msg = rowToObject(msgRes);
      if (!msg) return;
      db.run("UPDATE messages SET is_deleted = 1, content = NULL WHERE id = ?", [message_id]);
      saveDb();
      io.to(`chat:${msg.chat_id}`).emit('message_deleted', { message_id, chat_id: msg.chat_id });
    });

    socket.on('react_message', async (data) => {
      const { message_id, emoji } = data;
      if (!message_id || !emoji) return;
      const db = await getDb();
      const msgRes = dbExecBind('SELECT chat_id, is_deleted FROM messages WHERE id = ?', [message_id]);
      const msg = rowToObject(msgRes);
      if (!msg || msg.is_deleted) return;
      const exists = dbExecBind('SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', [message_id, userId, emoji]);
      let added;
      if (exists.length > 0 && exists[0].values.length > 0) {
        db.run('DELETE FROM message_reactions WHERE id = ?', [exists[0].values[0][0]]);
        added = false;
      } else {
        db.run('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)', [message_id, userId, emoji]);
        added = true;
      }
      saveDb();
      const reactionsRes = dbExecBind('SELECT emoji, user_id FROM message_reactions WHERE message_id = ?', [message_id]);
      const reactions = {};
      for (const r of rowsToArray(reactionsRes)) {
        if (!reactions[r.emoji]) reactions[r.emoji] = [];
        reactions[r.emoji].push(r.user_id);
      }
      io.to(`chat:${msg.chat_id}`).emit('message_reaction', { message_id, chat_id: msg.chat_id, reactions, user_id: userId, emoji, added });
    });

    socket.on('forward_message', async (data) => {
      const { message_ids, target_chat_id } = data;
      if (!Array.isArray(message_ids) || !target_chat_id) return;
      const db = await getDb();
      const targetChatId = parseInt(target_chat_id);
      const participantRes = dbExecBind('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?', [targetChatId, userId]);
      if (participantRes.length === 0 || participantRes[0].values.length === 0) return;

      const placeholders = message_ids.map(() => '?').join(',');
      const sourceRes = dbExecBind(`SELECT m.*, u.display_name as sender_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id IN (${placeholders}) AND m.is_deleted = 0`, message_ids);
      const sources = rowsToArray(sourceRes);
      const created = [];
      for (const src of sources) {
        db.run(`INSERT INTO messages (chat_id, sender_id, message_type, content, encrypted_content, media_url, sticker_id, duration, forwarded_from_chat_id, forwarded_from_user_id, forwarded_from_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [targetChatId, userId, src.message_type, src.content, src.encrypted_content, src.media_url, src.sticker_id, src.duration, src.chat_id, src.sender_id, src.sender_name]);
        const idRes = db.exec('SELECT last_insert_rowid() as id');
        const newId = idRes[0].values[0][0];
        db.run('INSERT INTO message_status (message_id, user_id, status) VALUES (?, ?, ?)', [newId, userId, 'sent']);
        const others = dbExecBind('SELECT user_id FROM chat_participants WHERE chat_id = ? AND user_id != ?', [targetChatId, userId]);
        for (const p of rowsToArray(others)) {
          db.run('INSERT INTO message_status (message_id, user_id, status) VALUES (?, ?, ?)', [newId, p.user_id, 'sent']);
        }
        const m = getMessageFull(db, newId);
        if (m) created.push(m);
      }
      saveDb();
      for (const m of created) {
        io.to(`chat:${targetChatId}`).emit('new_message', m);
      }
    });

    socket.on('mark_read', async (data) => {
      const { chat_id } = data;
      if (!chat_id) return;
      const db = await getDb();
      db.run(`UPDATE message_status SET status = 'read', updated_at = datetime('now','localtime') WHERE user_id = ? AND message_id IN (SELECT id FROM messages WHERE chat_id = ? AND sender_id != ?) AND status != 'read'`,
        [userId, chat_id, userId]);
      saveDb();
      io.to(`chat:${chat_id}`).emit('messages_read', { chat_id, user_id: userId, read_at: new Date().toISOString() });
    });

    socket.on('typing_start', ({ chat_id }) => {
      socket.to(`chat:${chat_id}`).emit('user_typing', { chat_id, user_id: userId });
    });

    socket.on('typing_stop', ({ chat_id }) => {
      socket.to(`chat:${chat_id}`).emit('user_stop_typing', { chat_id, user_id: userId });
    });

    socket.on('call_initiate', async (data) => {
      const { recipient_id, call_type, offer, call_id, call_db_id, chat_id, is_group } = data;
      getDb().then(async db => {
        const userRes = dbExecBind('SELECT username, display_name, profile_picture FROM users WHERE id = ?', [userId]);
        const userInfo = rowToObject(userRes) || {};
        const callerName = userInfo.display_name || userInfo.username || 'Unknown';
        const callerAvatar = userInfo.profile_picture || null;

        const payload = {
          call_id: call_id || `${Date.now()}_${userId}`,
          call_type,
          caller_id: userId,
          caller_name: callerName,
          caller_avatar: callerAvatar,
          chat_id: chat_id || null,
          is_group: !!is_group,
          offer: offer || null,
        };

        if (is_group && chat_id) {
          io.to(`chat:${chat_id}`).emit('incoming_call', payload);
        } else if (recipient_id) {
          io.to(`user:${recipient_id}`).emit('incoming_call', payload);
        }

        const numericCallId = call_db_id ? parseInt(call_db_id) : (call_id && /^\d+$/.test(call_id) ? parseInt(call_id) : null);
        if (numericCallId) {
          socket.join(`call:${numericCallId}`);
        }
      });
    });

    socket.on('call_join', ({ call_id, call_db_id }) => {
      if (call_db_id) socket.join(`call:${call_db_id}`);
    });

    socket.on('call_leave', ({ call_id, call_db_id }) => {
      if (call_db_id) socket.leave(`call:${call_db_id}`);
    });

    socket.on('call_answer', ({ call_id, answer, call_db_id }) => {
      const target = call_db_id ? `call:${call_db_id}` : `call:${call_id}`;
      socket.to(target).emit('call_answered', { call_id, answer, user_id: userId });
    });

    socket.on('call_offer_to_peer', ({ call_id, call_db_id, target_user_id, offer }) => {
      io.to(`user:${target_user_id}`).emit('call_peer_offer', {
        call_id,
        call_db_id,
        from_user_id: userId,
        offer,
      });
    });

    socket.on('call_answer_to_peer', ({ call_id, call_db_id, target_user_id, answer }) => {
      io.to(`user:${target_user_id}`).emit('call_peer_answer', {
        call_id,
        call_db_id,
        from_user_id: userId,
        answer,
      });
    });

    socket.on('call_ice_to_peer', ({ call_id, call_db_id, target_user_id, candidate }) => {
      io.to(`user:${target_user_id}`).emit('call_peer_ice_candidate', {
        call_id,
        call_db_id,
        from_user_id: userId,
        candidate,
      });
    });

    socket.on('call_reject', ({ call_id, call_db_id }) => {
      const target = call_db_id ? `call:${call_db_id}` : `call:${call_id}`;
      socket.to(target).emit('call_rejected', { call_id, user_id: userId });
    });

    socket.on('call_end', ({ call_id, call_db_id, duration }) => {
      const target = call_db_id ? `call:${call_db_id}` : `call:${call_id}`;
      socket.to(target).emit('call_ended', { call_id, duration, user_id: userId });
    });

    socket.on('call_ice_candidate', ({ call_id, call_db_id, candidate }) => {
      const target = call_db_id ? `call:${call_db_id}` : `call:${call_id}`;
      socket.to(target).emit('call_ice_candidate', { call_id, candidate, user_id: userId });
    });

    socket.on('call_participant_joined', ({ call_db_id, user_id, user_name, user_avatar }) => {
      if (!call_db_id) return;
      io.to(`call:${call_db_id}`).emit('call_participant_joined', {
        call_id: call_db_id,
        user_id: user_id || userId,
        user_name,
        user_avatar,
      });
    });

    socket.on('call_participant_left', ({ call_db_id, user_id }) => {
      if (!call_db_id) return;
      io.to(`call:${call_db_id}`).emit('call_participant_left', {
        call_id: call_db_id,
        user_id: user_id || userId,
      });
    });

    socket.on('call_push_to_talk', ({ call_db_id, active }) => {
      if (!call_db_id) return;
      io.to(`call:${call_db_id}`).emit('call_push_to_talk', {
        call_id: call_db_id,
        user_id: userId,
        active: !!active,
      });
    });

    socket.on('disconnect', () => {
      getDb().then(db => {
        db.run('UPDATE users SET is_online = 0, last_seen = datetime(\'now\',\'localtime\') WHERE id = ?', [userId]);
        saveDb();
        socket.broadcast.emit('user_offline', { user_id: userId });
      });
    });

  } catch (e) {
    socket.disconnect();
  }
});

const PORT = process.env.PORT || 8001;
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Hello Bro Server running on port ${PORT}`);
  console.log(`📡 WebSocket: ws://0.0.0.0:${PORT}/ws`);
  console.log(`🌍 Health: http://0.0.0.0:${PORT}/health`);
  startScheduledWorker(io);
  startExpireWorker(io);
  console.log('⏰ Scheduled messages worker started');
  console.log('🗑️ Self-destruct worker started');
});
