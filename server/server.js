require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const initSqlJs = require('sql.js');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
let registerFeatures;
try { registerFeatures = require('./features'); } catch (e) { console.error('Features load error:', e.message); }

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 50 * 1024 * 1024
});

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data.db');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dqjf052cj',
  api_key: process.env.CLOUDINARY_API_KEY || '624172533198457',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'Bc5T72aEKdQACF9DbDm98emSx4M'
});

let db;

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  db.run(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    phone TEXT UNIQUE,
    password TEXT,
    displayName TEXT,
    avatar TEXT,
    avatarColor TEXT DEFAULT '#7c3aed',
    bio TEXT DEFAULT '',
    status TEXT DEFAULT 'offline',
    statusText TEXT DEFAULT '',
    activityStatus TEXT DEFAULT '',
    lastSeen TEXT,
    invisible INTEGER DEFAULT 0,
    doNotDisturb INTEGER DEFAULT 0,
    blockedUsers TEXT DEFAULT '[]',
    theme TEXT DEFAULT 'dark',
    createdAt TEXT DEFAULT (datetime('now'))
  )`);
  try { db.run(`ALTER TABLE users ADD COLUMN phone TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE users ADD COLUMN password TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE users ADD COLUMN sessionToken TEXT`); } catch(e) {}
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    messageId TEXT PRIMARY KEY,
    type TEXT DEFAULT 'text',
    content TEXT,
    senderUsername TEXT DEFAULT 'system',
    senderDisplayName TEXT DEFAULT 'Система',
    senderAvatar TEXT,
    senderAvatarColor TEXT,
    room TEXT,
    sendSound TEXT DEFAULT 'default',
    replyTo TEXT,
    file TEXT,
    duration REAL,
    reactions TEXT DEFAULT '{}',
    readBy TEXT DEFAULT '[]',
    edited INTEGER DEFAULT 0,
    pinned INTEGER DEFAULT 0,
    forwarded INTEGER DEFAULT 0,
    forwardedFrom TEXT,
    expiresAt TEXT,
    pollData TEXT,
    gameData TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS rooms (
    roomId TEXT PRIMARY KEY,
    name TEXT,
    type TEXT DEFAULT 'group',
    members TEXT DEFAULT '[]',
    admin TEXT,
    moderators TEXT DEFAULT '[]',
    banned TEXT DEFAULT '[]',
    muted TEXT DEFAULT '[]',
    description TEXT DEFAULT '',
    avatar TEXT,
    pinnedMessage TEXT,
    inviteCode TEXT,
    isSecret INTEGER DEFAULT 0,
    secretPassword TEXT,
    slowMode INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS polls (
    pollId TEXT PRIMARY KEY,
    question TEXT,
    options TEXT DEFAULT '[]',
    room TEXT,
    creator TEXT,
    multipleChoice INTEGER DEFAULT 0,
    anonymous INTEGER DEFAULT 0,
    closed INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS channels (
    channelId TEXT PRIMARY KEY,
    name TEXT,
    description TEXT DEFAULT '',
    type TEXT DEFAULT 'public',
    admin TEXT,
    moderators TEXT DEFAULT '[]',
    subscribers TEXT DEFAULT '[]',
    banned TEXT DEFAULT '[]',
    avatar TEXT,
    pinnedMessage TEXT,
    slowMode INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS favorites (
    id TEXT PRIMARY KEY,
    username TEXT,
    messageId TEXT,
    type TEXT DEFAULT 'text',
    content TEXT,
    file TEXT,
    room TEXT,
    sender TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
  )`);
  saveDb();
  console.log('SQLite база данных инициализирована');
}

function saveDb() {
  try {
    const data = Buffer.from(db.export());
    fs.writeFileSync(DB_PATH, data);
  } catch (err) {
    console.error('Save DB error:', err);
  }
}

function dbAll(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch (err) {
    console.error('dbAll error:', err, sql, params);
    return [];
  }
}

function dbGet(sql, params = []) {
  const rows = dbAll(sql, params);
  return rows.length ? rows[0] : null;
}

function dbRun(sql, params = []) {
  try {
    db.run(sql, params);
    saveDb();
  } catch (err) {
    console.error('dbRun error:', err, sql, params);
  }
}

function parseJsonField(val, def = null) {
  if (!val) return def;
  try { return JSON.parse(val); } catch (e) { return def; }
}

function formatUserRow(r) {
  return {
    username: r.username,
    phone: r.phone || '',
    displayName: r.displayName,
    avatar: r.avatar,
    avatarColor: r.avatarColor,
    bio: r.bio || '',
    status: r.status || 'offline',
    statusText: r.statusText || '',
    activityStatus: r.activityStatus || '',
    lastSeen: r.lastSeen,
    invisible: !!r.invisible,
    doNotDisturb: !!r.doNotDisturb,
    blockedUsers: parseJsonField(r.blockedUsers, []),
    theme: r.theme || 'dark',
    createdAt: r.createdAt
  };
}

function formatMessageRow(r) {
  return {
    messageId: r.messageId,
    type: r.type || 'text',
    content: r.content,
    sender: {
      username: r.senderUsername,
      displayName: r.senderDisplayName,
      avatar: r.senderAvatar,
      avatarColor: r.senderAvatarColor
    },
    room: r.room,
    sendSound: r.sendSound || 'default',
    replyTo: parseJsonField(r.replyTo),
    file: parseJsonField(r.file),
    duration: r.duration,
    reactions: parseJsonField(r.reactions, {}),
    readBy: parseJsonField(r.readBy, []),
    edited: !!r.edited,
    pinned: !!r.pinned,
    forwarded: !!r.forwarded,
    forwardedFrom: r.forwardedFrom,
    expiresAt: r.expiresAt,
    pollData: parseJsonField(r.pollData),
    gameData: parseJsonField(r.gameData),
    timestamp: r.timestamp
  };
}

function formatRoomRow(r) {
  return {
    id: r.roomId,
    name: r.name,
    type: r.type || 'group',
    members: parseJsonField(r.members, []),
    admin: r.admin,
    moderators: parseJsonField(r.moderators, []),
    banned: parseJsonField(r.banned, []),
    muted: parseJsonField(r.muted, []),
    description: r.description || '',
    avatar: r.avatar,
    pinnedMessage: r.pinnedMessage,
    inviteCode: r.inviteCode,
    isSecret: !!r.isSecret,
    slowMode: r.slowMode || 0
  };
}

function formatPollRow(r) {
  return {
    pollId: r.pollId,
    question: r.question,
    options: parseJsonField(r.options, []),
    room: r.room,
    creator: r.creator,
    multipleChoice: !!r.multipleChoice,
    anonymous: !!r.anonymous,
    closed: !!r.closed,
    createdAt: r.createdAt
  };
}

function memberInArray(arrJson, username) {
  if (!arrJson) return false;
  try {
    const arr = JSON.parse(arrJson);
    return arr.includes(username);
  } catch (e) {
    return false;
  }
}

function addToSet(arrJson, value) {
  let arr = parseJsonField(arrJson, []);
  if (!arr.includes(value)) arr.push(value);
  return JSON.stringify(arr);
}

function pullFromArray(arrJson, value) {
  let arr = parseJsonField(arrJson, []);
  arr = arr.filter(v => v !== value);
  return JSON.stringify(arr);
}

const onlineUsers = new Map();
const unreadCounts = new Map();
const activeGames = new Map();
const lastMessageTime = new Map();

async function init() {
  const general = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, ['general']);
  if (!general) {
    dbRun(`INSERT INTO rooms (roomId, name, type, members, admin, description, inviteCode) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['general', '💬 Общий чат', 'group', '[]', null, 'Общий чат для всех', 'general']);
  }
  setInterval(() => {
    dbRun(`DELETE FROM messages WHERE expiresAt IS NOT NULL AND expiresAt < datetime('now')`);
  }, 60000);
}

initDb().then(() => {
  init();
  if (typeof registerFeatures === 'function') {
    registerFeatures(io, db, {
      dbAll, dbGet, dbRun, saveDb,
      onlineUsers, findSocketByUsername, getOnlineUser,
      saveMessage, formatMessageRow, app
    });
  }
  server.listen(PORT, () => {
    console.log(`  ╔══════════════════════════════════════╗
  ║   🚀 HELLO BRO v2.0 ULTIMATE        ║
  ║   Порт: ${PORT}                        ║
  ╚══════════════════════════════════════╝`);
  });
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  try {
    let resourceType = 'auto';
    if (req.file.mimetype.startsWith('audio/')) resourceType = 'video';
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'pulse-messenger', resource_type: resourceType, public_id: uuidv4() },
        (err, result) => err ? reject(err) : resolve(result)
      );
      stream.end(req.file.buffer);
    });
    res.json({
      id: uuidv4(), originalName: req.file.originalname,
      filename: result.public_id, size: req.file.size,
      mimetype: req.file.mimetype, url: result.secure_url,
      cloudinaryId: result.public_id, uploadedAt: new Date()
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Ошибка загрузки' });
  }
});

app.get('/invite/:code', (req, res) => {
  res.redirect(`/?invite=${req.params.code}`);
});

io.on('connection', (socket) => {
  console.log(`🟢 ${socket.id}`);

  socket.on('user:register', async (data) => {
    try {
      const { phone, username, displayName, password } = data;
      if (!phone || !username || !password) {
        socket.emit('auth:error', { text: 'Заполните все поля' }); return;
      }
      const existing = dbGet(`SELECT * FROM users WHERE phone = ? OR username = ?`, [phone, username]);
      if (existing) {
        socket.emit('auth:error', { text: existing.phone === phone ? 'Номер уже зарегистрирован' : 'Имя пользователя занято' });
        return;
      }
      dbRun(`INSERT INTO users (username, phone, password, displayName, avatarColor, status, lastSeen) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        [username, phone, password, displayName || username, getRandomColor(), 'online']);
      const dbUser = dbGet(`SELECT * FROM users WHERE username = ?`, [username]);
      proceedLogin(socket, dbUser);
    } catch (err) { console.error('Register error:', err); socket.emit('auth:error', { text: 'Ошибка регистрации' }); }
  });

  socket.on('user:join', async (userData) => {
    try {
      const { phone, password } = userData;
      let dbUser = null;
      if (phone && password) {
        dbUser = dbGet(`SELECT * FROM users WHERE phone = ? AND password = ?`, [phone, password]);
        if (!dbUser) { socket.emit('auth:error', { text: 'Неверный номер или пароль' }); return; }
      } else if (userData.username && userData.password) {
        dbUser = dbGet(`SELECT * FROM users WHERE username = ? AND password = ?`, [userData.username, userData.password]);
        if (!dbUser) { socket.emit('auth:error', { text: 'Неверный логин или пароль' }); return; }
      } else {
        socket.emit('auth:error', { text: 'Введите номер и пароль' }); return;
      }
      proceedLogin(socket, dbUser);
    } catch (err) { console.error('Join error:', err); }
  });

  // ==================== SESSION TOKEN RECONNECT ====================
  socket.on('user:reconnect', async (data) => {
    if (!data.sessionToken) return;
    try {
      const dbUser = dbGet(`SELECT * FROM users WHERE sessionToken = ?`, [data.sessionToken]);
      if (!dbUser) { socket.emit('auth:error', { text: 'Сессия недействительна' }); return; }
      const oldUser = [...onlineUsers.entries()].find(([_, u]) => u.username === dbUser.username);
      if (oldUser) {
        const oldSocket = io.sockets.sockets.get(oldUser[0]);
        if (oldSocket) { oldSocket.leave('general'); oldSocket.disconnect(true); }
        onlineUsers.delete(oldUser[0]);
      }
      proceedLogin(socket, dbUser);
    } catch (e) { console.error('Reconnect error:', e); socket.emit('auth:error', { text: 'Ошибка reconnect' }); }
  });

  socket.on('user:logout', async () => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      dbRun(`UPDATE users SET sessionToken = NULL WHERE username = ?`, [user.username]);
      user.sessionToken = null;
    } catch (e) { console.error('Logout error:', e); }
  });

  async function proceedLogin(socket, dbUser) {
    const invisible = !!dbUser.invisible;
    const sessionToken = generateId() + '-' + generateId();
    dbRun(`UPDATE users SET status = ?, lastSeen = datetime('now'), sessionToken = ? WHERE username = ?`,
      [invisible ? 'offline' : 'online', sessionToken, dbUser.username]);
    dbUser = dbGet(`SELECT * FROM users WHERE username = ?`, [dbUser.username]);
    const user = formatUserRow(dbUser);
    user.id = socket.id;
    user.status = user.invisible ? 'offline' : 'online';

    onlineUsers.set(socket.id, user);
    if (!unreadCounts.has(user.username)) unreadCounts.set(user.username, {});

    socket.join('general');

    const generalRoom = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, ['general']);
    if (generalRoom) {
      const newMembers = addToSet(generalRoom.members, user.username);
      dbRun(`UPDATE rooms SET members = ? WHERE roomId = ?`, [newMembers, 'general']);
    }

    const userRooms = dbAll(`SELECT * FROM rooms`);
    const filteredRooms = userRooms.filter(r => {
      const members = parseJsonField(r.members, []);
      const banned = parseJsonField(r.banned, []);
      return members.includes(user.username) || r.roomId === 'general';
    }).filter(r => {
      const banned = parseJsonField(r.banned, []);
      return !banned.includes(user.username);
    });

    filteredRooms.forEach(r => socket.join(r.roomId));

    const generalMsgs = dbAll(`SELECT * FROM messages WHERE room = ? ORDER BY timestamp DESC LIMIT 100`, ['general']);
    const msgRows = generalMsgs.reverse().map(formatMessageRow);

    const userChannels = dbAll(`SELECT * FROM channels`);
    const subscribedChannels = userChannels.filter(c => {
      const subs = parseJsonField(c.subscribers, []);
      return subs.includes(user.username);
    });
    const allDms = dbAll(`SELECT * FROM rooms WHERE type = 'direct'`);
    const userDms = allDms.filter(r => {
      const members = parseJsonField(r.members, []);
      return members.includes(user.username);
    });
    userDms.forEach(r => socket.join(r.roomId));
    subscribedChannels.forEach(c => socket.join('ch-' + c.channelId));

    const favs = dbAll(`SELECT * FROM favorites WHERE username = ? ORDER BY timestamp DESC LIMIT 200`, [user.username]);

    socket.emit('user:joined', {
      user,
      rooms: filteredRooms.map(formatRoomRow),
      dms: userDms.map(formatRoomRow),
      channels: subscribedChannels.map(c => ({
        channelId: c.channelId, name: c.name, description: c.description,
        type: c.type, admin: c.admin,
        subscribers: parseJsonField(c.subscribers, []),
        avatar: c.avatar, createdAt: c.createdAt
      })),
      messages: msgRows,
      favorites: favs.map(f => ({
        id: f.id, messageId: f.messageId,
        type: f.type, content: f.content,
        file: parseJsonField(f.file), room: f.room,
        sender: parseJsonField(f.sender), timestamp: f.timestamp
      })),
      onlineUsers: getOnlineUsersList(),
      unreadCounts: unreadCounts.get(user.username) || {},
      sessionToken
    });

    if (!user.invisible) {
      io.emit('users:update', getOnlineUsersList());
      const sysMsg = saveMessage({
        type: 'system', content: `${user.displayName} присоединился к чату`, room: 'general'
      });
      io.to('general').emit('message:new', sysMsg);
    }
  }

  socket.on('message:send', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      let room = null;
      let channel = null;
      let members = [];
      let banned = [];
      let muted = [];
      let slowMode = 0;
      let admin = null;

      const isChannel = data.room && data.room.startsWith('ch-');
      if (isChannel) {
        const chId = data.room.replace('ch-', '');
        channel = dbGet(`SELECT * FROM channels WHERE channelId = ?`, [chId]);
        if (channel) {
          members = parseJsonField(channel.subscribers, []);
          banned = parseJsonField(channel.banned, []);
          slowMode = channel.slowMode || 0;
          admin = channel.admin;
        }
      } else {
        room = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, [data.room]);
        if (room) {
          members = parseJsonField(room.members, []);
          banned = parseJsonField(room.banned, []);
          muted = parseJsonField(room.muted, []);
          slowMode = room.slowMode || 0;
          admin = room.admin;
        }
      }
      if (!room && !channel) return;

      if (banned.includes(user.username)) {
        socket.emit('error:message', { text: 'Вы заблокированы в этом чате' });
        return;
      }

      if (muted.includes(user.username)) {
        socket.emit('error:message', { text: 'Вы не можете писать в этом чате (мут)' });
        return;
      }

      if (slowMode > 0) {
        const key = `${user.username}:${data.room}`;
        const lastTime = lastMessageTime.get(key);
        if (lastTime && Date.now() - lastTime < slowMode * 1000) {
          const wait = Math.ceil((slowMode * 1000 - (Date.now() - lastTime)) / 1000);
          socket.emit('error:message', { text: `Подождите ${wait} сек. (медленный режим)` });
          return;
        }
        lastMessageTime.set(key, Date.now());
      }

      const msgData = {
        type: data.type || 'text',
        content: data.content, room: data.room,
        sender: { username: user.username, displayName: user.displayName, avatar: user.avatar, avatarColor: user.avatarColor },
        sendSound: data.sendSound || 'default',
        replyTo: data.replyTo, file: data.file,
        duration: data.duration, pollData: data.pollData,
        gameData: data.gameData
      };

      if (data.expiresIn) {
        msgData.expiresAt = new Date(Date.now() + data.expiresIn * 60000).toISOString();
      }

      const message = await saveMessage(msgData);

      members.forEach(m => {
        if (m !== user.username) {
          if (!unreadCounts.has(m)) unreadCounts.set(m, {});
          const c = unreadCounts.get(m);
          c[data.room] = (c[data.room] || 0) + 1;
          const ms = findSocketByUsername(m);
          if (ms) {
            const targetUser = getOnlineUser(m);
            if (!targetUser?.doNotDisturb) {
              ms.emit('unread:update', { room: data.room, count: c[data.room] });
            }
          }
        }
      });

      io.to(data.room).emit('message:new', message);
    } catch (err) { console.error('Send error:', err); }
  });

  socket.on('message:edit', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const msg = dbGet(`SELECT * FROM messages WHERE messageId = ?`, [data.messageId]);
      if (!msg || msg.senderUsername !== user.username) return;
      dbRun(`UPDATE messages SET content = ?, edited = 1 WHERE messageId = ?`, [data.newContent, data.messageId]);
      io.to(msg.room).emit('message:edited', {
        messageId: data.messageId, newContent: data.newContent, room: msg.room
      });
    } catch (err) { console.error('Edit error:', err); }
  });

  socket.on('message:pin', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const msg = dbGet(`SELECT * FROM messages WHERE messageId = ?`, [data.messageId]);
      if (!msg) return;
      const newPinned = msg.pinned ? 0 : 1;
      dbRun(`UPDATE messages SET pinned = ? WHERE messageId = ?`, [newPinned, data.messageId]);
      dbRun(`UPDATE rooms SET pinnedMessage = ? WHERE roomId = ?`, [newPinned ? data.messageId : null, data.room]);
      io.to(data.room).emit('message:pinned', {
        messageId: data.messageId, pinned: !!newPinned, room: data.room,
        content: msg.content, sender: { username: msg.senderUsername, displayName: msg.senderDisplayName }
      });
      const action = newPinned ? 'закрепил' : 'открепил';
      const sysMsg = await saveMessage({ type: 'system', content: `${user.displayName} ${action} сообщение`, room: data.room });
      io.to(data.room).emit('message:new', sysMsg);
    } catch (err) { console.error('Pin error:', err); }
  });

  socket.on('message:forward', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const orig = dbGet(`SELECT * FROM messages WHERE messageId = ?`, [data.messageId]);
      if (!orig) return;
      const fwd = await saveMessage({
        type: orig.type, room: data.targetRoom,
        content: orig.content,
        sender: { username: user.username, displayName: user.displayName, avatar: user.avatar, avatarColor: user.avatarColor },
        sendSound: 'default',
        file: parseJsonField(orig.file),
        forwarded: true, forwardedFrom: orig.senderDisplayName
      });
      io.to(data.targetRoom).emit('message:new', fwd);
    } catch (err) { console.error('Forward error:', err); }
  });

  socket.on('messages:read', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const c = unreadCounts.get(user.username);
    if (c) c[data.room] = 0;

    const msgs = dbAll(`SELECT * FROM messages WHERE room = ? AND senderUsername != ? LIMIT 200`, [data.room, user.username]);
    const username = user.username;
    msgs.forEach(m => {
      const readBy = parseJsonField(m.readBy, []);
      if (!readBy.includes(username)) {
        readBy.push(username);
        dbRun(`UPDATE messages SET readBy = ? WHERE messageId = ?`, [JSON.stringify(readBy), m.messageId]);
      }
    });

    socket.to(data.room).emit('messages:were-read', { room: data.room, readBy: [username] });
  });

  socket.on('message:delete', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const msg = dbGet(`SELECT * FROM messages WHERE messageId = ?`, [data.messageId]);
      if (!msg) return;
      const room = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, [data.room]);
      const canDelete = msg.senderUsername === user.username ||
        room?.admin === user.username ||
        memberInArray(room?.moderators, user.username);
      if (!canDelete) return;
      if (msg.file) {
        const fileData = parseJsonField(msg.file);
        if (fileData?.cloudinaryId) {
          try { await cloudinary.uploader.destroy(fileData.cloudinaryId); } catch (e) {}
        }
      }
      dbRun(`DELETE FROM messages WHERE messageId = ?`, [data.messageId]);
      io.to(data.room).emit('message:deleted', { messageId: data.messageId, room: data.room });
    } catch (err) { console.error('Delete error:', err); }
  });

  socket.on('chat:clear', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const room = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, [data.room]);
      if (!room) return;
      if (room.type === 'group' && room.roomId !== 'general') {
        if (room.admin !== user.username && !memberInArray(room.moderators, user.username)) {
          socket.emit('error:message', { text: 'Нет прав' }); return;
        }
      }
      dbRun(`DELETE FROM messages WHERE room = ?`, [data.room]);
      const sysMsg = await saveMessage({ type: 'system', content: `${user.displayName} очистил чат`, room: data.room });
      io.to(data.room).emit('chat:cleared', { room: data.room });
      io.to(data.room).emit('message:new', sysMsg);
    } catch (err) { console.error('Clear error:', err); }
  });

  socket.on('room:delete', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const room = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, [data.roomId]);
      if (!room || room.roomId === 'general') return;
      if (room.admin !== user.username) {
        socket.emit('error:message', { text: 'Только админ может удалить' }); return;
      }
      io.to(data.roomId).emit('room:deleted', { roomId: data.roomId, roomName: room.name });
      dbRun(`DELETE FROM messages WHERE room = ?`, [data.roomId]);
      dbRun(`DELETE FROM rooms WHERE roomId = ?`, [data.roomId]);
    } catch (err) { console.error('Delete room error:', err); }
  });

  socket.on('message:react', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const msg = dbGet(`SELECT * FROM messages WHERE messageId = ?`, [data.messageId]);
      if (!msg) return;
      let reactions = parseJsonField(msg.reactions, {});
      if (!reactions[data.emoji]) reactions[data.emoji] = [];
      const idx = reactions[data.emoji].indexOf(user.username);
      if (idx > -1) {
        reactions[data.emoji].splice(idx, 1);
        if (!reactions[data.emoji].length) delete reactions[data.emoji];
      } else {
        reactions[data.emoji].push(user.username);
      }
      dbRun(`UPDATE messages SET reactions = ? WHERE messageId = ?`, [JSON.stringify(reactions), data.messageId]);
      io.to(data.room).emit('message:reacted', { messageId: data.messageId, reactions, room: data.room });
    } catch (err) { console.error('React error:', err); }
  });

  socket.on('typing:start', (data) => {
    const user = onlineUsers.get(socket.id);
    if (user) socket.to(data.room).emit('typing:update', { username: user.displayName, room: data.room, isTyping: true });
  });
  socket.on('typing:stop', (data) => {
    const user = onlineUsers.get(socket.id);
    if (user) socket.to(data.room).emit('typing:update', { username: user.displayName, room: data.room, isTyping: false });
  });

  socket.on('messages:search', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const q = data.query.trim();
      if (!q) { socket.emit('messages:search-results', { results: [], query: '' }); return; }
      const rooms = dbAll(`SELECT * FROM rooms`);
      const userRooms = rooms.filter(r => memberInArray(r.members, user.username) || r.roomId === 'general');
      const roomIds = userRooms.map(r => r.roomId);
      if (!roomIds.length) { socket.emit('messages:search-results', { results: [], query: '' }); return; }
      const placeholders = roomIds.map(() => '?').join(',');
      const results = dbAll(`SELECT * FROM messages WHERE room IN (${placeholders}) AND type != 'system' AND content LIKE ? ORDER BY timestamp DESC LIMIT 50`,
        [...roomIds, `%${q}%`]);
      const roomMap = {};
      userRooms.forEach(r => roomMap[r.roomId] = r.name);
      socket.emit('messages:search-results', {
        results: results.map(m => ({ ...formatMessageRow(m), roomName: roomMap[m.room] || 'Чат', roomId: m.room })),
        query: data.query
      });
    } catch (err) { console.error('Search error:', err); }
  });

  socket.on('profile:update', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const sets = [];
      const vals = [];
      if (data.displayName) { sets.push('displayName = ?'); vals.push(data.displayName); user.displayName = data.displayName; }
      if (data.bio !== undefined) { sets.push('bio = ?'); vals.push(data.bio); user.bio = data.bio; }
      if (data.statusText !== undefined) { sets.push('statusText = ?'); vals.push(data.statusText); user.statusText = data.statusText; }
      if (data.avatarColor) { sets.push('avatarColor = ?'); vals.push(data.avatarColor); user.avatarColor = data.avatarColor; }
      if (data.avatar !== undefined) { sets.push('avatar = ?'); vals.push(data.avatar); user.avatar = data.avatar; }
      if (data.activityStatus !== undefined) { sets.push('activityStatus = ?'); vals.push(data.activityStatus); user.activityStatus = data.activityStatus; }
      if (data.invisible !== undefined) {
        sets.push('invisible = ?, status = ?');
        vals.push(data.invisible ? 1 : 0);
        vals.push(data.invisible ? 'offline' : 'online');
        user.invisible = data.invisible;
        user.status = data.invisible ? 'offline' : 'online';
      }
      if (data.doNotDisturb !== undefined) { sets.push('doNotDisturb = ?'); vals.push(data.doNotDisturb ? 1 : 0); user.doNotDisturb = data.doNotDisturb; }
      if (data.theme) { sets.push('theme = ?'); vals.push(data.theme); user.theme = data.theme; }
      if (sets.length) {
        vals.push(user.username);
        dbRun(`UPDATE users SET ${sets.join(', ')} WHERE username = ?`, vals);
      }
      io.emit('users:update', getOnlineUsersList());
      socket.emit('profile:updated', user);
    } catch (err) { console.error('Profile error:', err); }
  });

  socket.on('profile:get', async (data) => {
    try {
      const p = dbGet(`SELECT * FROM users WHERE username = ?`, [data.username]);
      if (p) {
        socket.emit('profile:data', {
          username: p.username, displayName: p.displayName, avatar: p.avatar,
          avatarColor: p.avatarColor, bio: p.bio, status: p.status,
          statusText: p.statusText, activityStatus: p.activityStatus,
          lastSeen: p.lastSeen, joinedAt: p.createdAt
        });
      }
    } catch (err) { console.error('Get profile error:', err); }
  });

  // ==================== MESSAGE PAGINATION ====================
  socket.on('messages:load-older', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user || !data.room || typeof data.offset !== 'number') return;
    try {
      const msgs = dbAll(
        `SELECT * FROM messages WHERE room = ? ORDER BY timestamp DESC LIMIT 50 OFFSET ?`,
        [data.room, data.offset]
      );
      socket.emit('messages:older', {
        room: data.room,
        messages: msgs.reverse().map(formatMessageRow),
        hasMore: msgs.length === 50
      });
    } catch (err) { console.error('Load older msgs error:', err); }
  });

  socket.on('user:block', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const u = dbGet(`SELECT * FROM users WHERE username = ?`, [user.username]);
    const blocked = addToSet(u?.blockedUsers, data.username);
    dbRun(`UPDATE users SET blockedUsers = ? WHERE username = ?`, [blocked, user.username]);
    user.blockedUsers = user.blockedUsers || [];
    user.blockedUsers.push(data.username);
    socket.emit('user:blocked', { username: data.username });
  });

  socket.on('user:unblock', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const u = dbGet(`SELECT * FROM users WHERE username = ?`, [user.username]);
    const blocked = pullFromArray(u?.blockedUsers, data.username);
    dbRun(`UPDATE users SET blockedUsers = ? WHERE username = ?`, [blocked, user.username]);
    user.blockedUsers = (user.blockedUsers || []).filter(v => v !== data.username);
    socket.emit('user:unblocked', { username: data.username });
  });

  socket.on('room:create', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const roomId = uuidv4();
      const inviteCode = generateInviteCode();
      const members = [user.username, ...(data.members || [])];
      dbRun(`INSERT INTO rooms (roomId, name, type, members, admin, moderators, description, inviteCode, isSecret, secretPassword) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [roomId, data.name, data.type || 'group', JSON.stringify(members), user.username, '[]', data.description || '', inviteCode, data.isSecret ? 1 : 0, data.secretPassword || null]);
      const room = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, [roomId]);
      const rd = formatRoomRow(room);
      members.forEach(m => {
        const ms = findSocketByUsername(m);
        if (ms) { ms.join(roomId); ms.emit('room:created', rd); }
      });
      const sysMsg = await saveMessage({ type: 'system', content: `${user.displayName} создал группу "${data.name}"`, room: roomId });
      io.to(roomId).emit('message:new', sysMsg);
    } catch (err) { console.error('Create room error:', err); }
  });

  socket.on('room:join', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      socket.join(data.roomId);
      let room = null;
      // Check if this is a channel room
      if (data.roomId && data.roomId.startsWith('ch-')) {
        const channelId = data.roomId.replace('ch-', '');
        const ch = dbGet(`SELECT * FROM channels WHERE channelId = ?`, [channelId]);
        if (ch) {
          room = { id: data.roomId, name: ch.name, type: 'channel', description: ch.description, avatar: ch.avatar, members: parseJsonField(ch.subscribers, []) };
        }
      } else {
        room = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, [data.roomId]);
        if (room) {
          const newMembers = addToSet(room.members, user.username);
          dbRun(`UPDATE rooms SET members = ? WHERE roomId = ?`, [newMembers, data.roomId]);
        }
      }
      const msgs = dbAll(`SELECT * FROM messages WHERE room = ? ORDER BY timestamp DESC LIMIT 100`, [data.roomId]);
      socket.emit('room:joined', { room, messages: msgs.reverse().map(formatMessageRow) });
    } catch (err) { console.error('Join room error:', err); }
  });

  socket.on('room:join-invite', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const room = dbGet(`SELECT * FROM rooms WHERE inviteCode = ?`, [data.inviteCode]);
      if (!room) { socket.emit('error:message', { text: 'Приглашение не найдено' }); return; }
      if (memberInArray(room.banned, user.username)) { socket.emit('error:message', { text: 'Вы заблокированы' }); return; }
      if (room.isSecret && data.password !== room.secretPassword) {
        socket.emit('error:message', { text: 'Неверный пароль' }); return;
      }
      const newMembers = addToSet(room.members, user.username);
      dbRun(`UPDATE rooms SET members = ? WHERE roomId = ?`, [newMembers, room.roomId]);
      socket.join(room.roomId);
      const msgs = dbAll(`SELECT * FROM messages WHERE room = ? ORDER BY timestamp DESC LIMIT 100`, [room.roomId]);
      socket.emit('room:joined', { room: formatRoomRow(room), messages: msgs.reverse().map(formatMessageRow) });
      socket.emit('room:created', formatRoomRow(room));
      const sysMsg = await saveMessage({ type: 'system', content: `${user.displayName} присоединился по приглашению`, room: room.roomId });
      io.to(room.roomId).emit('message:new', sysMsg);
    } catch (err) { console.error('Join invite error:', err); }
  });

  socket.on('room:update', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const room = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, [data.roomId]);
      if (!room) return;
      if (room.admin !== user.username && !memberInArray(room.moderators, user.username)) return;
      const sets = [];
      const vals = [];
      if (data.name) { sets.push('name = ?'); vals.push(data.name); }
      if (data.description !== undefined) { sets.push('description = ?'); vals.push(data.description); }
      if (data.slowMode !== undefined) { sets.push('slowMode = ?'); vals.push(data.slowMode); }
      if (data.avatar) { sets.push('avatar = ?'); vals.push(data.avatar); }
      if (sets.length) {
        vals.push(data.roomId);
        dbRun(`UPDATE rooms SET ${sets.join(', ')} WHERE roomId = ?`, vals);
      }
      const updated = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, [data.roomId]);
      io.to(data.roomId).emit('room:updated', formatRoomRow(updated));
    } catch (err) { console.error('Update room error:', err); }
  });

  socket.on('room:set-role', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const room = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, [data.roomId]);
      if (!room || room.admin !== user.username) return;
      if (data.role === 'moderator') {
        const mods = addToSet(room.moderators, data.username);
        dbRun(`UPDATE rooms SET moderators = ? WHERE roomId = ?`, [mods, data.roomId]);
      } else if (data.role === 'member') {
        const mods = pullFromArray(room.moderators, data.username);
        dbRun(`UPDATE rooms SET moderators = ? WHERE roomId = ?`, [mods, data.roomId]);
      }
      const sysMsg = await saveMessage({ type: 'system', content: `${user.displayName} изменил роль ${data.username}: ${data.role}`, room: data.roomId });
      io.to(data.roomId).emit('message:new', sysMsg);
      const updated = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, [data.roomId]);
      io.to(data.roomId).emit('room:updated', formatRoomRow(updated));
    } catch (err) { console.error('Set role error:', err); }
  });

  socket.on('room:ban', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const room = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, [data.roomId]);
      if (!room) return;
      if (room.admin !== user.username && !memberInArray(room.moderators, user.username)) return;
      if (data.username === room.admin) return;
      const banned = addToSet(room.banned, data.username);
      const members = pullFromArray(room.members, data.username);
      const moderators = pullFromArray(room.moderators, data.username);
      dbRun(`UPDATE rooms SET banned = ?, members = ?, moderators = ? WHERE roomId = ?`, [banned, members, moderators, data.roomId]);
      const targetSocket = findSocketByUsername(data.username);
      if (targetSocket) {
        targetSocket.leave(data.roomId);
        targetSocket.emit('room:deleted', { roomId: data.roomId, roomName: room.name + ' (забанены)' });
      }
      const sysMsg = await saveMessage({ type: 'system', content: `${user.displayName} заблокировал ${data.username}`, room: data.roomId });
      io.to(data.roomId).emit('message:new', sysMsg);
    } catch (err) { console.error('Ban error:', err); }
  });

  socket.on('room:mute', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const room = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, [data.roomId]);
      if (!room) return;
      if (room.admin !== user.username && !memberInArray(room.moderators, user.username)) return;
      const muted = data.muted ? addToSet(room.muted, data.username) : pullFromArray(room.muted, data.username);
      dbRun(`UPDATE rooms SET muted = ? WHERE roomId = ?`, [muted, data.roomId]);
      const action = data.muted ? 'замутил' : 'размутил';
      const sysMsg = await saveMessage({ type: 'system', content: `${user.displayName} ${action} ${data.username}`, room: data.roomId });
      io.to(data.roomId).emit('message:new', sysMsg);
    } catch (err) { console.error('Mute error:', err); }
  });

  socket.on('dm:start', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const targetUser = dbGet(`SELECT * FROM users WHERE username = ?`, [data.username]);
      if (targetUser && memberInArray(targetUser.blockedUsers, user.username)) {
        socket.emit('error:message', { text: 'Пользователь вас заблокировал' }); return;
      }
      const rooms = dbAll(`SELECT * FROM rooms WHERE type = 'direct'`);
      let existing = rooms.find(r => {
        const members = parseJsonField(r.members, []);
        return members.includes(user.username) && members.includes(data.username);
      });
      if (existing) {
        socket.join(existing.roomId);
        const msgs = dbAll(`SELECT * FROM messages WHERE room = ? ORDER BY timestamp DESC LIMIT 100`, [existing.roomId]);
        socket.emit('dm:opened', { room: formatRoomRow(existing), messages: msgs.reverse().map(formatMessageRow) });
        return;
      }
      const roomId = uuidv4();
      const displayName = targetUser?.displayName || data.username;
      dbRun(`INSERT INTO rooms (roomId, name, type, members) VALUES (?, ?, ?, ?)`,
        [roomId, `${user.displayName} & ${displayName}`, 'direct', JSON.stringify([user.username, data.username])]);
      socket.join(roomId);
      const ts = findSocketByUsername(data.username);
      const newRoom = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, [roomId]);
      if (ts) { ts.join(roomId); ts.emit('room:created', formatRoomRow(newRoom)); }
      socket.emit('dm:opened', { room: formatRoomRow(newRoom), messages: [] });
    } catch (err) { console.error('DM error:', err); }
  });

  // ==================== CHANNELS ====================
  socket.on('channels:list', async () => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const publicChannels = dbAll(`SELECT * FROM channels WHERE type = 'public' ORDER BY createdAt DESC`);
      socket.emit('channels:list', publicChannels.map(c => ({
        channelId: c.channelId, name: c.name, description: c.description,
        type: c.type, admin: c.admin,
        subscribers: parseJsonField(c.subscribers, []).length,
        avatar: c.avatar, createdAt: c.createdAt
      })));
    } catch (e) { console.error('Channels list error:', e); }
  });

  socket.on('channels:list-subscribed', async () => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const all = dbAll(`SELECT * FROM channels`);
      const subscribed = all.filter(c => {
        const subs = parseJsonField(c.subscribers, []);
        return subs.includes(user.username);
      });
      socket.emit('channels:list-subscribed', subscribed.map(c => ({
        channelId: c.channelId, name: c.name, description: c.description,
        type: c.type, admin: c.admin,
        subscribers: parseJsonField(c.subscribers, []).length,
        avatar: c.avatar, createdAt: c.createdAt
      })));
    } catch (e) { console.error('Channels list user error:', e); }
  });

  socket.on('channel:create', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const channelId = 'channel-' + uuidv4();
      const subscribers = JSON.stringify([user.username]);
      dbRun(`INSERT INTO channels (channelId, name, description, type, admin, subscribers) VALUES (?, ?, ?, ?, ?, ?)`,
        [channelId, data.name, data.description || '', data.type || 'public', user.username, subscribers]);
      socket.join('ch-' + channelId);
      const channel = dbGet(`SELECT * FROM channels WHERE channelId = ?`, [channelId]);
      const sysMsg = await saveMessage({ type: 'system', content: `Канал "${data.name}" создан`, room: 'ch-' + channelId });
      io.to('ch-' + channelId).emit('message:new', sysMsg);
      socket.emit('channel:created', {
        channelId: channel.channelId, name: channel.name, description: channel.description,
        type: channel.type, admin: channel.admin,
        subscribers: parseJsonField(channel.subscribers, []),
        avatar: channel.avatar, createdAt: channel.createdAt
      });
    } catch (e) { console.error('Channel create error:', e); }
  });

  socket.on('channel:subscribe', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const channel = dbGet(`SELECT * FROM channels WHERE channelId = ?`, [data.channelId]);
      if (!channel) return;
      const subs = addToSet(channel.subscribers, user.username);
      dbRun(`UPDATE channels SET subscribers = ? WHERE channelId = ?`, [subs, data.channelId]);
      socket.join('ch-' + data.channelId);
      socket.emit('channel:subscribed', { channelId: data.channelId });
      const sysMsg = await saveMessage({ type: 'system', content: `${user.displayName} подписался на канал`, room: 'ch-' + data.channelId });
      io.to('ch-' + data.channelId).emit('message:new', sysMsg);
    } catch (e) { console.error('Channel subscribe error:', e); }
  });

  socket.on('channel:unsubscribe', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const channel = dbGet(`SELECT * FROM channels WHERE channelId = ?`, [data.channelId]);
      if (!channel || channel.admin === user.username) return;
      const subs = pullFromArray(channel.subscribers, user.username);
      dbRun(`UPDATE channels SET subscribers = ? WHERE channelId = ?`, [subs, data.channelId]);
      socket.leave('ch-' + data.channelId);
      socket.emit('channel:unsubscribed', { channelId: data.channelId });
    } catch (e) { console.error('Channel unsubscribe error:', e); }
  });

  // ==================== FAVORITES ====================
  socket.on('favorites:add', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const msg = dbGet(`SELECT * FROM messages WHERE messageId = ?`, [data.messageId]);
      if (!msg) return;
      const id = uuidv4();
      dbRun(`INSERT INTO favorites (id, username, messageId, type, content, file, room, sender, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, user.username, msg.messageId, msg.type, msg.content, msg.file, msg.room, JSON.stringify({
          username: msg.senderUsername, displayName: msg.senderDisplayName,
          avatar: msg.senderAvatar, avatarColor: msg.senderAvatarColor
        }), msg.timestamp]);
      socket.emit('favorites:added', { id });
    } catch (e) { console.error('Favorites add error:', e); }
  });

  socket.on('favorites:remove', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    dbRun(`DELETE FROM favorites WHERE id = ? AND username = ?`, [data.id, user.username]);
    socket.emit('favorites:removed', { id: data.id });
  });

  socket.on('favorites:list', async () => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const favs = dbAll(`SELECT * FROM favorites WHERE username = ? ORDER BY timestamp DESC LIMIT 200`, [user.username]);
      socket.emit('favorites:list', favs.map(f => ({
        id: f.id, messageId: f.messageId,
        type: f.type, content: f.content,
        file: parseJsonField(f.file), room: f.room,
        sender: parseJsonField(f.sender),
        timestamp: f.timestamp
      })));
    } catch (e) { console.error('Favorites list error:', e); }
  });

  // ==================== CONTACTS ====================
  socket.on('contacts:list', async () => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const dms = dbAll(`SELECT * FROM rooms WHERE type = 'direct'`);
      const contactNames = new Set();
      dms.forEach(r => {
        const members = parseJsonField(r.members, []);
        if (members.includes(user.username)) {
          members.forEach(m => { if (m !== user.username) contactNames.add(m); });
        }
      });
      const contacts = [];
      contactNames.forEach(name => {
        const u = dbGet(`SELECT * FROM users WHERE username = ?`, [name]);
        if (u) contacts.push({
          username: u.username, displayName: u.displayName,
          avatar: u.avatar, avatarColor: u.avatarColor,
          status: u.status, lastSeen: u.lastSeen
        });
      });
      socket.emit('contacts:list', contacts);
    } catch (e) { console.error('Contacts list error:', e); }
  });

  // ==================== FULL SYNC ====================
  socket.on('user:sync-all', async () => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const dms = dbAll(`SELECT * FROM rooms WHERE type = 'direct'`);
      const userDms = dms.filter(r => {
        const members = parseJsonField(r.members, []);
        return members.includes(user.username);
      });
      const allMessages = [];
      userDms.forEach(r => {
        const msgs = dbAll(`SELECT * FROM messages WHERE room = ? ORDER BY timestamp ASC`, [r.roomId]);
        allMessages.push(...msgs.map(formatMessageRow));
      });
      const channels = dbAll(`SELECT * FROM channels`);
      const userChannels = channels.filter(c => {
        const subs = parseJsonField(c.subscribers, []);
        return subs.includes(user.username);
      });
      userChannels.forEach(c => {
        const msgs = dbAll(`SELECT * FROM messages WHERE room = ? ORDER BY timestamp ASC`, ['ch-' + c.channelId]);
        allMessages.push(...msgs.map(formatMessageRow));
      });
      const favs = dbAll(`SELECT * FROM favorites WHERE username = ? ORDER BY timestamp DESC LIMIT 200`, [user.username]);
      const contacts = [];
      const contactNames = new Set();
      userDms.forEach(r => {
        const members = parseJsonField(r.members, []);
        members.forEach(m => { if (m !== user.username) contactNames.add(m); });
      });
      contactNames.forEach(name => {
        const u = dbGet(`SELECT * FROM users WHERE username = ?`, [name]);
        if (u) contacts.push({
          username: u.username, displayName: u.displayName,
          avatar: u.avatar, avatarColor: u.avatarColor,
          status: u.status, lastSeen: u.lastSeen
        });
      });
      socket.emit('user:synced', {
        dms: userDms.map(formatRoomRow),
        channels: userChannels.map(c => ({
          channelId: c.channelId, name: c.name, description: c.description,
          type: c.type, admin: c.admin,
          subscribers: parseJsonField(c.subscribers, []),
          avatar: c.avatar, createdAt: c.createdAt
        })),
        messages: allMessages,
        favorites: favs.map(f => ({
          id: f.id, messageId: f.messageId,
          type: f.type, content: f.content,
          file: parseJsonField(f.file), room: f.room,
          sender: parseJsonField(f.sender), timestamp: f.timestamp
        })),
        contacts
      });
    } catch (e) { console.error('Sync all error:', e); }
  });

  socket.on('poll:create', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const pollId = uuidv4();
      const options = data.options.map(o => ({ text: o, votes: [] }));
      dbRun(`INSERT INTO polls (pollId, question, options, room, creator, multipleChoice, anonymous) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [pollId, data.question, JSON.stringify(options), data.room, user.username, data.multipleChoice ? 1 : 0, data.anonymous ? 1 : 0]);
      const msg = await saveMessage({
        type: 'poll', content: `📊 ${data.question}`,
        room: data.room, sender: { username: user.username, displayName: user.displayName, avatar: user.avatar, avatarColor: user.avatarColor },
        pollData: { pollId, question: data.question, options, multipleChoice: data.multipleChoice, anonymous: data.anonymous, creator: user.username }
      });
      io.to(data.room).emit('message:new', msg);
    } catch (err) { console.error('Poll create error:', err); }
  });

  socket.on('poll:vote', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const poll = dbGet(`SELECT * FROM polls WHERE pollId = ?`, [data.pollId]);
      if (!poll || poll.closed) return;
      let options = parseJsonField(poll.options, []);
      if (!poll.multipleChoice) {
        options.forEach(o => {
          o.votes = o.votes.filter(v => v !== user.username);
        });
      }
      const option = options[data.optionIndex];
      if (!option) return;
      const voteIdx = option.votes.indexOf(user.username);
      if (voteIdx > -1) option.votes.splice(voteIdx, 1);
      else option.votes.push(user.username);
      dbRun(`UPDATE polls SET options = ? WHERE pollId = ?`, [JSON.stringify(options), data.pollId]);
      io.to(poll.room).emit('poll:updated', {
        pollId: data.pollId, options, room: poll.room
      });
    } catch (err) { console.error('Poll vote error:', err); }
  });

  socket.on('game:tictactoe:start', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const gameId = uuidv4();
    const game = {
      id: gameId, type: 'tictactoe',
      board: Array(9).fill(null),
      players: { X: user.username, O: data.opponent },
      currentTurn: 'X', winner: null, room: data.room
    };
    activeGames.set(gameId, game);
    const msg = await saveMessage({
      type: 'game', content: `🎮 ${user.displayName} приглашает в крестики-нолики!`,
      room: data.room, sender: { username: user.username, displayName: user.displayName, avatar: user.avatar, avatarColor: user.avatarColor },
      gameData: game
    });
    io.to(data.room).emit('message:new', msg);
  });

  socket.on('game:tictactoe:move', (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const game = activeGames.get(data.gameId);
    if (!game) return;
    const symbol = game.players.X === user.username ? 'X' : 'O';
    if (game.currentTurn !== symbol || game.winner) return;
    if (game.board[data.position] !== null) return;
    game.board[data.position] = symbol;
    game.winner = checkTicTacToeWinner(game.board);
    game.currentTurn = symbol === 'X' ? 'O' : 'X';
    if (!game.board.includes(null) && !game.winner) game.winner = 'draw';
    io.to(game.room).emit('game:tictactoe:updated', game);
  });

  socket.on('game:rps:start', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const gameId = uuidv4();
    const game = {
      id: gameId, type: 'rps',
      players: { [user.username]: null, [data.opponent]: null },
      playerNames: { [user.username]: user.displayName },
      winner: null, room: data.room
    };
    activeGames.set(gameId, game);
    const msg = await saveMessage({
      type: 'game', content: `🎮 ${user.displayName} приглашает в Камень-Ножницы-Бумага!`,
      room: data.room, sender: { username: user.username, displayName: user.displayName, avatar: user.avatar, avatarColor: user.avatarColor },
      gameData: { gameId, type: 'rps', players: Object.keys(game.players) }
    });
    io.to(data.room).emit('message:new', msg);
  });

  socket.on('game:rps:choose', (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const game = activeGames.get(data.gameId);
    if (!game || game.winner) return;
    if (!(user.username in game.players)) return;
    game.players[user.username] = data.choice;
    game.playerNames[user.username] = user.displayName;
    const choices = Object.values(game.players);
    if (choices.every(c => c !== null)) {
      const players = Object.keys(game.players);
      game.winner = getRPSWinner(game.players[players[0]], game.players[players[1]], players[0], players[1]);
      io.to(game.room).emit('game:rps:result', game);
    } else {
      socket.emit('game:rps:waiting', { gameId: data.gameId });
    }
  });

  socket.on('game:dice', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const result = Math.floor(Math.random() * 6) + 1;
    const diceEmojis = ['⚀','⚁','⚂','⚃','⚄','⚅'];
    const msg = await saveMessage({
      type: 'text', content: `🎲 ${user.displayName} бросил кубик: ${diceEmojis[result-1]} ${result}!`,
      room: data.room, sender: { username: user.username, displayName: user.displayName, avatar: user.avatar, avatarColor: user.avatarColor },
      sendSound: 'default'
    });
    io.to(data.room).emit('message:new', msg);
  });

  socket.on('stats:get', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    try {
      const countResult = dbGet(`SELECT COUNT(*) as cnt FROM messages WHERE room = ? AND type != 'system'`, [data.room]);
      const totalMsgs = countResult?.cnt || 0;
      const topRows = dbAll(`SELECT senderDisplayName, COUNT(*) as cnt FROM messages WHERE room = ? AND type != 'system' GROUP BY senderDisplayName ORDER BY cnt DESC LIMIT 10`, [data.room]);
      const room = dbGet(`SELECT * FROM rooms WHERE roomId = ?`, [data.room]);
      const members = parseJsonField(room?.members, []);
      socket.emit('stats:data', {
        totalMessages: totalMsgs,
        totalMembers: members.length,
        topSenders: topRows.map(s => ({ name: s.senderDisplayName, count: s.cnt })),
        room: data.room
      });
    } catch (err) { console.error('Stats error:', err); }
  });

  socket.on('activity:set', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    user.activityStatus = data.activity;
    dbRun(`UPDATE users SET activityStatus = ? WHERE username = ?`, [data.activity, user.username]);
    io.emit('users:update', getOnlineUsersList());
  });

  socket.on('disconnect', async () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      dbRun(`UPDATE users SET status = ?, lastSeen = datetime('now') WHERE username = ?`, ['offline', user.username]);
      if (!user.invisible) {
        const sysMsg = await saveMessage({ type: 'system', content: `${user.displayName} покинул чат`, room: 'general' });
        io.to('general').emit('message:new', sysMsg);
      }
      onlineUsers.delete(socket.id);
      io.emit('users:update', getOnlineUsersList());
    }
  });
});

async function saveMessage(data) {
  const messageId = uuidv4();
  const sender = data.sender || { username: 'system', displayName: 'Система' };
  const timestamp = new Date().toISOString();
  dbRun(`INSERT INTO messages (messageId, type, content, senderUsername, senderDisplayName, senderAvatar, senderAvatarColor, room, sendSound, replyTo, file, duration, reactions, readBy, edited, pinned, forwarded, forwardedFrom, expiresAt, pollData, gameData, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [messageId, data.type || 'text', data.content || '', sender.username, sender.displayName, sender.avatar || null, sender.avatarColor || null,
    data.room, data.sendSound || 'default', data.replyTo ? JSON.stringify(data.replyTo) : null, data.file ? JSON.stringify(data.file) : null,
    data.duration || null, '{}', '[]', 0, 0, data.forwarded ? 1 : 0, data.forwardedFrom || null,
    data.expiresAt || null, data.pollData ? JSON.stringify(data.pollData) : null, data.gameData ? JSON.stringify(data.gameData) : null, timestamp]);
  return {
    messageId, type: data.type || 'text', content: data.content || '',
    sender,
    room: data.room, sendSound: data.sendSound || 'default',
    replyTo: data.replyTo || null, file: data.file || null,
    duration: data.duration || null, reactions: {}, readBy: [],
    edited: false, pinned: false,
    forwarded: data.forwarded || false,
    forwardedFrom: data.forwardedFrom || null,
    expiresAt: data.expiresAt || null,
    pollData: data.pollData || null, gameData: data.gameData || null,
    timestamp
  };
}

function getOnlineUsersList() {
  return Array.from(onlineUsers.values())
    .filter(u => !u.invisible)
    .map(u => ({
      username: u.username, displayName: u.displayName,
      avatar: u.avatar, avatarColor: u.avatarColor,
      bio: u.bio, status: u.status,
      statusText: u.statusText, activityStatus: u.activityStatus,
      lastSeen: u.lastSeen, doNotDisturb: u.doNotDisturb
    }));
}

function getOnlineUser(username) {
  for (const [, u] of onlineUsers) {
    if (u.username === username) return u;
  }
  return null;
}

function findSocketByUsername(username) {
  for (const [sid, u] of onlineUsers) {
    if (u.username === username) return io.sockets.sockets.get(sid);
  }
  return null;
}

function getRandomColor() {
  const colors = ['#7c3aed','#3b82f6','#a78bfa','#6d28d9','#2563eb','#60a5fa','#c084fc','#93c5fd','#ddd6fe','#4c1d95','#1d4ed8','#1e1b4b'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function checkTicTacToeWinner(board) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

function getRPSWinner(c1, c2, p1, p2) {
  if (c1 === c2) return 'draw';
  const wins = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
  return wins[c1] === c2 ? p1 : p2;
}
