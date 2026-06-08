const { v4: uuidv4 } = require('uuid');

module.exports = function registerFeatures(io, db, ctx) {
  const { dbAll, dbGet, dbRun, saveDb, onlineUsers, findSocketByUsername, getOnlineUser, saveMessage, formatMessageRow, app } = ctx;

  db.run(`CREATE TABLE IF NOT EXISTS devices (
    deviceId TEXT PRIMARY KEY,
    username TEXT,
    platform TEXT,
    lastSync TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS call_sessions (
    callId TEXT PRIMARY KEY,
    room TEXT,
    caller TEXT,
    callee TEXT,
    state TEXT DEFAULT 'ringing',
    type TEXT DEFAULT 'audio',
    createdAt TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS qr_sessions (
    sessionId TEXT PRIMARY KEY,
    token TEXT UNIQUE,
    username TEXT,
    state TEXT DEFAULT 'pending',
    webSocketId TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS sync_state (
    username TEXT,
    deviceId TEXT,
    lastMessageId TEXT,
    lastSync TEXT,
    PRIMARY KEY (username, deviceId)
  )`);
  saveDb();

  const activeCalls = new Map();
  const qrSockets = new Map();

  io.on('connection', (socket) => {

    // ==================== QR LOGIN ====================
    socket.on('qr:generate', () => {
      const sessionId = uuidv4();
      const token = uuidv4();
      dbRun(`INSERT INTO qr_sessions (sessionId, token, webSocketId) VALUES (?, ?, ?)`, [sessionId, token, socket.id]);
      qrSockets.set(sessionId, socket.id);
      socket.emit('qr:generated', { token, sessionId });
    });

    socket.on('qr:scan', async (data) => {
      try {
        const session = dbGet(`SELECT * FROM qr_sessions WHERE token = ? AND state = 'pending'`, [data.token]);
        if (!session) {
          socket.emit('qr:error', { text: 'QR-код устарел или недействителен' });
          return;
        }
        dbRun(`UPDATE qr_sessions SET username = ?, state = 'scanned' WHERE sessionId = ?`,
          [data.username, session.sessionId]);
        socket.emit('qr:scanned', { sessionId: session.sessionId, token: data.token });
        const qrSocket = io.sockets.sockets.get(session.webSocketId);
        if (qrSocket) {
          qrSocket.emit('qr:scanned', { username: data.username, sessionId: session.sessionId });
        }
      } catch (err) { console.error('QR scan error:', err); }
    });

    socket.on('qr:confirm', async (data) => {
      try {
        const session = dbGet(`SELECT * FROM qr_sessions WHERE sessionId = ?`, [data.sessionId]);
        if (!session || session.state !== 'scanned') {
          socket.emit('qr:error', { text: 'Сессия недействительна' });
          return;
        }
        dbRun(`UPDATE qr_sessions SET state = 'confirmed' WHERE sessionId = ?`, [data.sessionId]);
        const mobileSocket = findSocketByUsername(session.username);
        if (mobileSocket) {
          mobileSocket.emit('qr:confirmed', { sessionId: data.sessionId });
        }
        socket.emit('qr:done', { username: session.username, sessionId: data.sessionId });
      } catch (err) { console.error('QR confirm error:', err); }
    });

    // ==================== DEVICE SYNC ====================
    socket.on('device:register', (data) => {
      const user = onlineUsers.get(socket.id);
      if (!user) return;
      const deviceId = data.deviceId || uuidv4();
      const existing = dbGet(`SELECT * FROM devices WHERE deviceId = ?`, [deviceId]);
      if (!existing) {
        dbRun(`INSERT INTO devices (deviceId, username, platform) VALUES (?, ?, ?)`,
          [deviceId, user.username, data.platform || 'unknown']);
      } else {
        dbRun(`UPDATE devices SET lastSync = datetime('now') WHERE deviceId = ?`, [deviceId]);
      }
      socket.emit('device:registered', { deviceId });
    });

    socket.on('sync:request', (data) => {
      const user = onlineUsers.get(socket.id);
      if (!user) return;
      try {
        const state = dbGet(`SELECT * FROM sync_state WHERE username = ? AND deviceId = ?`,
          [user.username, data.deviceId]);
        const since = state?.lastSync || data.since || new Date(0).toISOString();
        const msgs = dbAll(`SELECT * FROM messages WHERE timestamp > ? AND (room IN (
          SELECT DISTINCT room FROM messages WHERE senderUsername = ? UNION
          SELECT roomId FROM rooms WHERE members LIKE ?
        )) ORDER BY timestamp ASC LIMIT 1000`,
          [since, user.username, `%"${user.username}"%`]);
        socket.emit('sync:messages', {
          messages: msgs.map(formatMessageRow),
          since
        });
        dbRun(`INSERT OR REPLACE INTO sync_state (username, deviceId, lastMessageId, lastSync) VALUES (?, ?, ?, datetime('now'))`,
          [user.username, data.deviceId, msgs.length ? msgs[msgs.length - 1].messageId : '']);
      } catch (err) { console.error('Sync error:', err); }
    });

    socket.on('sync:update', (data) => {
      const user = onlineUsers.get(socket.id);
      if (!user) return;
      dbRun(`INSERT OR REPLACE INTO sync_state (username, deviceId, lastMessageId, lastSync) VALUES (?, ?, ?, datetime('now'))`,
        [user.username, data.deviceId, data.lastMessageId || '']);
    });

    // ==================== WEBRTC CALLS ====================
    socket.on('call:start', (data) => {
      const user = onlineUsers.get(socket.id);
      if (!user) return;
      try {
        const callId = uuidv4();
        const room = data.room || `call-${callId}`;
        dbRun(`INSERT INTO call_sessions (callId, room, caller, callee, type) VALUES (?, ?, ?, ?, ?)`,
          [callId, room, user.username, data.callee, data.callType || 'audio']);
        activeCalls.set(callId, {
          id: callId, room, caller: user.username, callee: data.callee,
          state: 'ringing', type: data.callType || 'audio'
        });

        const targetSocket = findSocketByUsername(data.callee);
        if (targetSocket) {
          targetSocket.emit('call:incoming', {
            callId, caller: user.username,
            callerDisplayName: user.displayName,
            callerAvatar: user.avatar,
            callerAvatarColor: user.avatarColor,
            type: data.callType || 'audio',
            room
          });
          socket.emit('call:ringing', { callId, callee: data.callee });
        } else {
          socket.emit('call:error', { text: 'Пользователь не в сети' });
          dbRun(`UPDATE call_sessions SET state = 'missed' WHERE callId = ?`, [callId]);
          activeCalls.delete(callId);
        }
      } catch (err) { console.error('Call start error:', err); }
    });

    socket.on('call:accept', (data) => {
      const user = onlineUsers.get(socket.id);
      if (!user) return;
      const call = activeCalls.get(data.callId);
      if (!call) return;
      call.state = 'connected';
      dbRun(`UPDATE call_sessions SET state = 'connected' WHERE callId = ?`, [data.callId]);
      const callerSocket = findSocketByUsername(call.caller);
      if (callerSocket) {
        callerSocket.emit('call:accepted', { callId: data.callId, callee: user.username });
      }
      socket.join(call.room);
      if (callerSocket) callerSocket.join(call.room);
    });

    socket.on('call:reject', (data) => {
      const call = activeCalls.get(data.callId);
      if (!call) return;
      call.state = 'rejected';
      dbRun(`UPDATE call_sessions SET state = 'rejected' WHERE callId = ?`, [data.callId]);
      const callerSocket = findSocketByUsername(call.caller);
      if (callerSocket) callerSocket.emit('call:rejected', { callId: data.callId });
      activeCalls.delete(data.callId);
    });

    socket.on('call:end', (data) => {
      const user = onlineUsers.get(socket.id);
      if (!user) return;
      const call = activeCalls.get(data.callId);
      if (!call) {
        const dbCall = dbGet(`SELECT * FROM call_sessions WHERE callId = ?`, [data.callId]);
        if (dbCall) {
          const other = dbCall.caller === user.username ? dbCall.callee : dbCall.caller;
          const otherSocket = findSocketByUsername(other);
          if (otherSocket) otherSocket.emit('call:ended', { callId: data.callId });
        }
        return;
      }
      call.state = 'ended';
      dbRun(`UPDATE call_sessions SET state = 'ended' WHERE callId = ?`, [data.callId]);
      const other = call.caller === user.username ? call.callee : call.caller;
      const otherSocket = findSocketByUsername(other);
      if (otherSocket) otherSocket.emit('call:ended', { callId: data.callId });
      io.to(call.room).emit('call:ended', { callId: data.callId });
      Array.from(io.sockets.adapter.rooms.get(call.room) || []).forEach(sid => {
        const s = io.sockets.sockets.get(sid);
        if (s) s.leave(call.room);
      });
      activeCalls.delete(data.callId);
    });

    socket.on('call:signal', (data) => {
      const user = onlineUsers.get(socket.id);
      if (!user) return;
      const call = activeCalls.get(data.callId);
      if (!call) return;
      const target = call.caller === user.username ? call.callee : call.caller;
      const targetSocket = findSocketByUsername(target);
      if (targetSocket) {
        targetSocket.emit('call:signal', {
          callId: data.callId,
          signal: data.signal,
          from: user.username
        });
      }
    });

    socket.on('call:mute', (data) => {
      const user = onlineUsers.get(socket.id);
      if (!user) return;
      const call = activeCalls.get(data.callId);
      if (!call) return;
      const target = call.caller === user.username ? call.callee : call.caller;
      const targetSocket = findSocketByUsername(target);
      if (targetSocket) {
        targetSocket.emit('call:muted', { callId: data.callId, muted: data.muted, from: user.username });
      }
    });
  });

  // ==================== CONTACTS HTTP ENDPOINTS ====================
  app.post('/api/contacts/find-by-usernames', (req, res) => {
    try {
      const { usernames } = req.body;
      if (!usernames || !Array.isArray(usernames) || !usernames.length) return res.json({ users: [] });
      const placeholders = usernames.map(() => '?').join(',');
      const users = dbAll(`SELECT username, displayName, avatar, avatarColor, status FROM users WHERE username IN (${placeholders})`, usernames);
      res.json({ users });
    } catch (err) {
      console.error('Contacts find error:', err);
      res.status(500).json({ error: 'Ошибка' });
    }
  });
};


