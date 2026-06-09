class HelloBro {
  constructor() {
    this.socket = null;
    this.user = null;
    this.currentRoom = 'general';
    this.selectedSound = 'default';
    this.replyingTo = null;
    this.typingTimeout = null;
    this.rooms = new Map();
    this.dms = [];
    this.channels = [];
    this.favorites = [];
    this.contacts = [];
    this.onlineUsers = [];
    this.isJoiningRoom = false;
    this.unreadCounts = {};
    this.isRecording = false;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.recordingTimer = null;
    this.recordingSeconds = 0;
    this.notificationsEnabled = false;
    this.hoverTimeout = null;
    this.chatBackground = localStorage.getItem('pulse-bg') || 'none';
    this.currentTheme = localStorage.getItem('pulse-theme') || 'dark';
    this.messagesCache = new Map();
    this._msgOffsets = new Map();
    this._isLoadingOlder = false;
    this._channelsSubTab = 'subscribed';

    this.soundMap = {
      default: { name: 'Обычный' },
      birthday: { name: 'День рождения' },
      funny: { name: 'Смешной' },
      urgent: { name: 'Срочно!' },
      romantic: { name: 'Романтика' },
      applause: { name: 'Аплодисменты' },
      victory: { name: 'Победа' },
      magic: { name: 'Магия' },
      scary: { name: 'Страшный' },
      none: { name: 'Без звука' }
    };

    this.backgrounds = [
      { id: 'none', name: 'Без фона', css: '' },
      { id: 'cosmos', name: 'Космос', css: 'linear-gradient(135deg, #0a0a2e 0%, #1a1a4e 50%, #0d0d3d 100%)' },
      { id: 'sunset', name: 'Закат', css: 'linear-gradient(135deg, #1a0a2e 0%, #2d1b3d 50%, #1a0a1e 100%)' },
      { id: 'ocean', name: 'Океан', css: 'linear-gradient(135deg, #0a1a2e 0%, #0d2b3d 50%, #0a1a2e 100%)' },
      { id: 'forest', name: 'Лес', css: 'linear-gradient(135deg, #0a1e0a 0%, #1b2d1b 50%, #0a1e0a 100%)' },
      { id: 'fire', name: 'Огонь', css: 'linear-gradient(135deg, #2e0a0a 0%, #3d1b1b 50%, #2e0a0a 100%)' },
      { id: 'aurora', name: 'Сияние', css: 'linear-gradient(180deg, #0a0a2e 0%, #1a3a4e 30%, #0a2a3e 60%, #0a0a2e 100%)' },
      { id: 'midnight', name: 'Полночь', css: 'linear-gradient(135deg, #0d0d1a 0%, #1a1a2e 50%, #0d0d1a 100%)' },
      { id: 'purple', name: 'Фиолет', css: 'linear-gradient(135deg, #1a0a3e 0%, #2d1b4e 50%, #1a0a3e 100%)' },
      { id: 'matrix', name: 'Матрица', css: 'linear-gradient(180deg, #000a00 0%, #001a00 50%, #000a00 100%)' }
    ];

    this.avatarEmojis = [
      '😎','🦊','🐱','🐶','🦁','🐸','🦄','🐼',
      '🐨','🐯','🦇','🦉','🐙','🦋','🐺','🐰',
      '🤖','👾','🎮','⚡','🔥','💎','🌟','🎯',
      '🎸','🎵','🏆','🚀','👑','💜','🌈','🦅'
    ];

    this.emojiCategories = {
      'Смайлы': ['😀','😂','🤣','😊','😍','🥰','😘','😎','🤔','😏','😢','😭','😡','🤯','🥳','🤩','😴','🥶','🥵','😇','🤠','🥸','😈','👹','🤡','💀','👻','👽'],
      'Жесты': ['👍','👎','👋','🤝','💪','🙏','👏','🤞','✌️','🤟','🤘','👌','👊','✊','🤚','🖐️','✋','👆','👇','👈','👉'],
      'Символы': ['❤️','🔥','⭐','🎉','💎','🌟','✅','❌','⚡','💬','🔒','🔔','💯','♻️','⚠️','💜','💙','💚','💛','🧡'],
      'Развлечения': ['🎮','🎸','🎵','🎬','🎨','🎭','🎪','🎯','🎲','🎳','🏆','🥇','🥈','🥉','⚽','🏀','🎾'],
      'Еда': ['🍕','🍔','🍟','🌮','🌯','🍣','🍜','🍰','🍭','☕','🍺','🍷','🥤','🧁','🍩','🍪'],
      'Животные': ['🐱','🐶','🐸','🦊','🦄','🐼','🐨','🐯','🦁','🐙','🦋','🐺','🐰','🦅','🐳','🦈'],
      'Природа': ['🌍','🌈','☀️','🌙','⭐','❄️','🔥','💧','🌊','🌸','🌺','🍀','🌲','🏔️','🌋','🌅']
    };

    this.activityStatuses = [
      { emoji: '💼', text: 'На работе' },
      { emoji: '🎮', text: 'Играю' },
      { emoji: '🎵', text: 'Слушаю музыку' },
      { emoji: '📚', text: 'Учусь' },
      { emoji: '🏋️', text: 'Тренируюсь' },
      { emoji: '😴', text: 'Сплю' },
      { emoji: '🍕', text: 'Ем' },
      { emoji: '🎬', text: 'Смотрю фильм' },
      { emoji: '🚗', text: 'В дороге' },
      { emoji: '🏠', text: 'Дома' }
    ];

    this.profileColors = ['#7c3aed','#3b82f6','#a78bfa','#1d4ed8','#6d28d9','#60a5fa','#c084fc','#2563eb','#4c1d95','#93c5fd','#ddd6fe','#1e1b4b'];

    this.audioContext = null;
    this.init();
  }

  init() {
    this.applyTheme(this.currentTheme);
    this.bindLoginEvents();
    this.bindChatEvents();
    this.bindSoundSelector();
    this.bindEmojiPicker();
    this.bindFileUpload();
    this.bindVoiceRecording();
    this.bindSearch();
    this.bindSidebarTabs();
    this.bindChannelsUI();
    this.buildEmojiGrid();
    this.requestNotificationPermission();
    this.applyChatBackground();
    this.checkInviteLink();
    this.tryReconnect();
    this.startQRLogin();
    this.bindQRLayoutButtons();
    this.initSettingsTabs();
  }

  applyTheme(theme) {
    this.currentTheme = theme;
    localStorage.setItem('pulse-theme', theme);
    document.body.setAttribute('data-theme', theme);
  }

  toggleTheme() {
    const n = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.applyTheme(n);
    if (this.socket) this.socket.emit('profile:update', { theme: n });
  }

  checkInviteLink() {
    const p = new URLSearchParams(window.location.search);
    const i = p.get('invite');
    if (i) this._pendingInvite = i;
  }

  joinByInvite(code, password) {
    if (this.socket) this.socket.emit('room:join-invite', { inviteCode: code, password });
  }

  requestNotificationPermission() {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') this.notificationsEnabled = true;
      else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(p => { this.notificationsEnabled = p === 'granted'; });
      }
    }
  }

  showBrowserNotification(title, body) {
    if (!this.notificationsEnabled || document.hasFocus()) return;
    if (this.user?.doNotDisturb) return;
    try {
      const n = new Notification(title, { body, tag: 'pulse-msg', renotify: true });
      n.onclick = () => { window.focus(); n.close(); };
      setTimeout(() => n.close(), 5000);
    } catch (e) {}
  }

  getAudioContext() {
    if (!this.audioContext) this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    return this.audioContext;
  }

  playSound(type) {
    if (type === 'none') return;
    try {
      const ctx = this.getAudioContext();
      const sounds = {
        default: () => this.playTone(ctx, [800], [0.1]),
        birthday: () => this.playMelody(ctx, [523,523,587,523,698,659], [.2,.2,.4,.4,.4,.8]),
        funny: () => this.playTone(ctx, [300,600,200,800], [.1,.1,.1,.15], 'square'),
        urgent: () => this.playTone(ctx, [880,0,880,0,880], [.15,.05,.15,.05,.3], 'sawtooth'),
        romantic: () => this.playMelody(ctx, [523,659,784,1047], [.3,.3,.3,.6]),
        applause: () => this.playNoise(ctx, 1),
        victory: () => this.playMelody(ctx, [523,659,784,1047,784,1047], [.15,.15,.15,.15,.15,.4]),
        magic: () => this.playMelody(ctx, [1047,988,880,784,880,1047], [.1,.1,.1,.1,.2,.3]),
        scary: () => this.playTone(ctx, [100,90,80,70], [.3,.3,.3,.5], 'sawtooth')
      };
      (sounds[type] || sounds.default)();
    } catch (e) {}
  }

  playTone(ctx, freqs, durs, type = 'sine') {
    let t = ctx.currentTime;
    freqs.forEach((f, i) => {
      if (!f) { t += durs[i]; return; }
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + durs[i]);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + durs[i]); t += durs[i];
    });
  }

  playMelody(ctx, notes, durs) {
    let t = ctx.currentTime;
    notes.forEach((n, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = n;
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + durs[i] * 0.9);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + durs[i]); t += durs[i];
    });
  }

  playNoise(ctx, dur) {
    const sz = ctx.sampleRate * dur, buf = ctx.createBuffer(1, sz, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < sz; i++) d[i] = (Math.random() * 2 - 1) * 0.05;
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buf;
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    s.connect(g); g.connect(ctx.destination); s.start();
  }

  applyChatBackground() {
    const c = document.getElementById('messages-container');
    if (!c) return;
    const bg = this.backgrounds.find(b => b.id === this.chatBackground);
    c.style.background = bg?.css || '';
  }

  setChatBackground(id) {
    this.chatBackground = id;
    localStorage.setItem('pulse-bg', id);
    this.applyChatBackground();
  }

  // ==================== QR-FIRST LOGIN ====================
  startQRLogin() {
    if (this._qrSocket) { this._qrSocket.close(); this._qrSocket = null; }
    this._qrSocket = io(window.location.origin);
    this._qrSocket.on('connect', () => {
      this._qrSocket.emit('qr:generate');
    });
    this._qrSocket.on('qr:generated', (data) => {
      const c = document.getElementById('qr-code-container');
      if (typeof QRCode !== 'undefined') {
        c.innerHTML = '';
        new QRCode(c, { text: JSON.stringify({ token: data.token, t: Date.now() }), width: 200, height: 200 });
      } else {
        c.innerHTML = `<p style="color:var(--text-secondary)">Токен: ${data.token}</p>`;
      }
      document.getElementById('qr-token').value = data.token;
      document.getElementById('qr-status').textContent = 'Отсканируй QR-код приложением на Android';
    });
    this._qrSocket.on('qr:scanned', (data) => {
      document.getElementById('qr-status').textContent = `Сканировано: ${data.username}`;
      document.getElementById('qr-confirm-btn').style.display = 'block';
      document.getElementById('qr-confirm-btn').dataset.sessionId = data.sessionId;
    });
    // Listen for user:joined on the QR socket (it arrives before qr:done)
    this._qrSocket.on('user:joined', (data) => {
      this.socket = this._qrSocket;
      this._qrSocket = null;
      this._bindSocketEvents();
      this._handleJoinedData(data);
    });
    this._qrSocket.on('qr:done', (data) => {
      document.getElementById('qr-status').textContent = `Подтверждено!`;
      document.getElementById('qr-confirm-btn').style.display = 'none';
    });
  }

  bindQRLayoutButtons() {
    document.getElementById('qr-confirm-btn').addEventListener('click', () => {
      const btn = document.getElementById('qr-confirm-btn');
      const sessionId = btn.dataset.sessionId;
      if (this._qrSocket && sessionId) {
        this._qrSocket.emit('qr:confirm', { sessionId });
      }
    });
    document.getElementById('btn-show-login-form').addEventListener('click', () => {
      document.getElementById('qr-login-view').style.display = 'none';
      document.getElementById('login-form-view').style.display = 'block';
      if (this._qrSocket) { this._qrSocket.close(); this._qrSocket = null; }
    });
    document.getElementById('btn-show-qr').addEventListener('click', () => {
      document.getElementById('qr-login-view').style.display = 'block';
      document.getElementById('login-form-view').style.display = 'none';
      this.startQRLogin();
    });
  }

  _handleJoinedData(data) {
    this.user = data.user;
    this.onlineUsers = data.onlineUsers || [];
    this.unreadCounts = data.unreadCounts || {};
    if (data.user.theme) this.applyTheme(data.user.theme);

    data.rooms.forEach(r => this.rooms.set(r.id, r));
    (data.dms || []).forEach(r => {
      this.rooms.set(r.id, r);
      if (!this.dms.find(d => d.id === r.id)) this.dms.push(r);
    });
    this.channels = data.channels || [];
    this.favorites = data.favorites || [];

    this.showMainScreen();
    this.updateMyProfile();
    this.renderChatList();
    this.renderUsersList();
    this.renderContacts();
    this.renderChannels();
    this.renderFavorites();

    data.messages.forEach(m => {
      if (!this.messagesCache.has(m.room)) this.messagesCache.set(m.room, []);
      this.messagesCache.get(m.room).push(m);
      if (m.room === this.currentRoom) this.renderMessage(m);
    });
    this.scrollToBottom();
    this.markAsRead('general');
    this.applyChatBackground();

    this.registerDevice();
    this._bindFeatureSockets();

    if (this._pendingInvite) {
      this.joinByInvite(this._pendingInvite);
      this._pendingInvite = null;
    }
  }

  loginWithToken(token) {
    // QR socket becomes the main socket after confirmation
    this.socket = this._qrSocket;
    this._qrSocket = null;
    this._bindSocketEvents();
  }

  // ==================== SESSION RECONNECT ====================
  tryReconnect() {
    const token = localStorage.getItem('hb-session-token');
    if (!token) return;
    this.socket = io(window.location.origin);
    this.socket.on('connect', () => {
      this.socket.emit('user:reconnect', { sessionToken: token });
    });
    this._bindSocketEvents();
    this.socket.on('auth:error', () => {
      localStorage.removeItem('hb-session-token');
      this.socket = null;
    });
  }

  // ==================== LOGIN / REGISTER ====================
  bindLoginEvents() {
    document.getElementById('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const phone = document.getElementById('login-phone').value.trim();
      const password = document.getElementById('login-password').value.trim();
      document.getElementById('login-error').textContent = '';
      if (!phone || !password) return;
      this.login(phone, password);
    });
    document.getElementById('register-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const phone = document.getElementById('reg-phone').value.trim();
      const name = document.getElementById('reg-name').value.trim();
      const username = document.getElementById('reg-username').value.trim().replace('@','');
      const password = document.getElementById('reg-password').value.trim();
      document.getElementById('reg-error').textContent = '';
      if (!phone || !name || !username || !password) return;
      this.register(phone, name, username, password);
    });
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + '-form').classList.add('active');
        document.getElementById('login-error').textContent = '';
        document.getElementById('reg-error').textContent = '';
      });
    });
  }

  togglePass(btn, id) {
    const inp = document.getElementById(id);
    inp.type = inp.type === 'password' ? 'text' : 'password';
  }

  login(phone, password) {
    this.socket = io(window.location.origin);
    this.socket.on('connect', () => {
      this.socket.emit('user:join', { phone, password });
    });
    this._bindSocketEvents();
  }

  register(phone, displayName, username, password) {
    this.socket = io(window.location.origin);
    this.socket.on('connect', () => {
      this.socket.emit('user:register', { phone, username, displayName, password });
    });
    this._bindSocketEvents();
  }

  // ==================== SOCKET EVENTS ====================
  _bindSocketEvents() {
    this.socket.on('auth:error', (data) => {
      const le = document.getElementById('login-error');
      const re = document.getElementById('reg-error');
      if (le) le.textContent = data.text;
      if (re) re.textContent = data.text;
    });

    this.socket.on('user:joined', (data) => {
      this._handleJoinedData(data);
      if (data.sessionToken) {
        localStorage.setItem('hb-session-token', data.sessionToken);
      }
    });

    this.socket.on('message:new', (msg) => {
      if (!this.messagesCache.has(msg.room)) this.messagesCache.set(msg.room, []);
      this.messagesCache.get(msg.room).push(msg);
      if (msg.room === this.currentRoom) {
        this.renderMessage(msg);
        this.scrollToBottom();
        if (msg.sender.username !== this.user?.username) this.markAsRead(msg.room);
      }
      if (msg.sender.username !== this.user?.username && msg.type !== 'system') {
        if (msg.sendSound && msg.sendSound !== 'default' && msg.sendSound !== 'none') {
          this.playSound(msg.sendSound);
          this.showSoundNotification(msg.sendSound);
        } else if (msg.sendSound !== 'none') {
          this.playSound('default');
        }
        this.showBrowserNotification(msg.sender.displayName, msg.type === 'voice' ? 'Голосовое' : (msg.content || 'Файл'));
      }
      this.renderChatList();
    });

    this.socket.on('unread:update', (data) => {
      if (data.room !== this.currentRoom) {
        this.unreadCounts[data.room] = data.count;
        this.renderChatList();
      }
    });

    this.socket.on('messages:were-read', (data) => {
      if (data.room === this.currentRoom) {
        document.querySelectorAll('.message.own .message-read-status.unread').forEach(el => {
          el.classList.remove('unread'); el.classList.add('read');
          el.textContent = '0_0';
        });
      }
    });

    this.socket.on('message:deleted', (data) => {
      if (data.room === this.currentRoom) {
        const el = document.querySelector(`[data-message-id="${data.messageId}"]`);
        if (el) { el.style.animation = 'fadeOut 0.3s'; setTimeout(() => el.remove(), 300); }
      }
    });

    this.socket.on('message:edited', (data) => {
      if (data.room === this.currentRoom) {
        const el = document.querySelector(`[data-message-id="${data.messageId}"]`);
        if (el) {
          const t = el.querySelector('.message-text');
          if (t) t.innerHTML = this.formatText(data.newContent) + ' <span class="edited-tag">(ред.)</span>';
        }
      }
    });

    this.socket.on('message:pinned', (data) => {
      if (data.room === this.currentRoom) this.showPinnedMessage(data);
    });

    this.socket.on('chat:cleared', (data) => {
      if (data.room === this.currentRoom) {
        document.getElementById('messages-list').innerHTML = '';
        this.hidePinnedMessage();
      }
    });

    this.socket.on('room:deleted', (data) => {
      this.rooms.delete(data.roomId);
      if (this.currentRoom === data.roomId) this.switchRoom('general');
      this.renderChatList();
      this.showNotification(`Группа удалена`);
    });

    this.socket.on('room:created', (room) => {
      this.rooms.set(room.id, room);
      this.renderChatList();
    });

    this.socket.on('room:updated', (room) => {
      this.rooms.set(room.id, room);
      this.renderChatList();
      if (this.currentRoom === room.id) this.updateChatHeader(room);
    });

    this.socket.on('users:update', (users) => {
      this.onlineUsers = users;
      this.renderUsersList();
      this.updateChatSubtitle();
    });

    this.socket.on('typing:update', (data) => {
      if (data.room === this.currentRoom) {
        const ind = document.getElementById('typing-indicator');
        const txt = document.getElementById('typing-text');
        if (data.isTyping) { txt.textContent = `${data.username} печатает...`; ind.style.display = 'flex'; }
        else ind.style.display = 'none';
      }
    });

    this.socket.on('message:reacted', (data) => {
      if (data.room === this.currentRoom) this.updateMessageReactions(data.messageId, data.reactions);
    });

    this.socket.on('messages:older', (data) => {
      this._isLoadingOlder = false;
      if (data.room !== this.currentRoom) return;
      const container = document.getElementById('messages-list');
      const prevScroll = container.scrollHeight;
      data.messages.forEach(m => {
        if (!this.messagesCache.has(data.room)) this.messagesCache.set(data.room, []);
        this.messagesCache.get(data.room).unshift(m);
      });
      container.innerHTML = '';
      this.messagesCache.get(data.room).forEach(m => this.renderMessage(m));
      const newScroll = container.scrollHeight - prevScroll;
      container.scrollTop = newScroll;
      if (!data.hasMore) this._msgOffsets.set(data.room, -1);
    });

    this.socket.on('room:joined', (data) => {
      if (!this.isJoiningRoom) return;
      this.rooms.set(data.room.id, data.room);
      if (!this.messagesCache.has(data.room.id)) this.messagesCache.set(data.room.id, []);
      this._msgOffsets.set(data.room.id, data.messages.length);
      document.getElementById('messages-list').innerHTML = '';
      data.messages.forEach(m => {
        this.messagesCache.get(data.room.id).push(m);
        this.renderMessage(m);
      });
      this.scrollToBottom();
      this.isJoiningRoom = false;
      if (data.room.pinnedMessage) this.loadPinnedMessage(data.room.pinnedMessage);
      else this.hidePinnedMessage();
    });

    this.socket.on('dm:opened', (data) => {
      this.rooms.set(data.room.id, data.room);
      if (!this.dms.find(d => d.id === data.room.id)) this.dms.push(data.room);
      if (!this.messagesCache.has(data.room.id)) this.messagesCache.set(data.room.id, []);
      this._msgOffsets.set(data.room.id, data.messages.length);
      this.currentRoom = data.room.id;
      this.updateChatHeader(data.room);
      document.getElementById('messages-list').innerHTML = '';
      data.messages.forEach(m => {
        this.messagesCache.get(data.room.id).push(m);
        this.renderMessage(m);
      });
      this.scrollToBottom();
      this.renderChatList();
      this.renderContacts();
    });

    // ===== CHANNEL SOCKETS =====
    this.socket.on('channels:list', (channels) => {
      this._publicChannels = channels;
      this.renderChannels();
    });

    this.socket.on('channels:list-subscribed', (channels) => {
      this.channels = channels;
      this.renderChannels();
    });

    this.socket.on('channel:created', (channel) => {
      this.channels.push(channel);
      this.renderChannels();
      this.showNotification(`Канал создан`);
    });

    this.socket.on('channel:subscribed', (data) => {
      const ch = this._publicChannels?.find(c => c.channelId === data.channelId);
      if (ch) {
        ch.subscribers = (ch.subscribers || 0) + 1;
        this.renderChannels();
      }
    });

    this.socket.on('channel:unsubscribed', (data) => {
      this.channels = this.channels.filter(c => c.channelId !== data.channelId);
      this.renderChannels();
    });

    // ===== FAVORITES SOCKETS =====
    this.socket.on('favorites:added', (data) => {
      this.showNotification('Добавлено в избранное');
      if (this.socket) this.socket.emit('favorites:list');
    });

    this.socket.on('favorites:removed', (data) => {
      this.favorites = this.favorites.filter(f => f.id !== data.id);
      this.renderFavorites();
    });

    this.socket.on('favorites:list', (favs) => {
      this.favorites = favs;
      this.renderFavorites();
    });

    // ===== CONTACTS =====
    this.socket.on('contacts:list', (contacts) => {
      this.contacts = contacts;
      this.renderContacts();
    });

    this.socket.on('messages:search-results', (data) => this.renderSearchResults(data.results, data.query));
    this.socket.on('profile:updated', (u) => { this.user = u; this.updateMyProfile(); });
    this.socket.on('profile:data', (p) => this.showProfilePopup(p));
    this.socket.on('error:message', (d) => this.showNotification(d.text));
    this.socket.on('user:blocked', (d) => this.showNotification(`Заблокирован ${d.username}`));
    this.socket.on('user:unblocked', (d) => this.showNotification(`Разблокирован ${d.username}`));
    this.socket.on('stats:data', (d) => this.showStatsModal(d));
    this.socket.on('game:tictactoe:updated', (game) => this.updateTicTacToe(game));
    this.socket.on('game:rps:result', (game) => this.showRPSResult(game));
    this.socket.on('game:rps:waiting', () => this.showNotification('Ожидаем ход соперника...'));
    this.socket.on('poll:updated', (data) => this.updatePoll(data));
    this.socket.on('disconnect', () => console.log('Disconnected'));
  }

  markAsRead(room) {
    if (!this.socket) return;
    this.unreadCounts[room] = 0;
    this.socket.emit('messages:read', { room });
    this.renderChatList();
  }

  showMainScreen() {
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
  }

  updateMyProfile() {
    document.getElementById('my-name').textContent = this.user.displayName;
    document.getElementById('my-status').textContent = this.user.statusText || this.user.activityStatus || 'В сети';
    const av = document.getElementById('my-avatar');
    this.setAvatarElement(av, this.user);
  }

  setAvatarElement(el, user) {
    if (user.avatar && user.avatar.startsWith('http')) {
      el.style.background = `url(${user.avatar}) center/cover`;
      el.innerHTML = '';
    } else if (user.avatar) {
      el.style.background = user.avatarColor || '#6c5ce7';
      el.innerHTML = user.avatar;
    } else {
      el.style.background = user.avatarColor || '#6c5ce7';
      el.innerHTML = (user.displayName || '?').charAt(0).toUpperCase();
    }
  }

  formatText(text) {
    if (!text) return '';
    let html = this.escapeHTML(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    html = html.replace(/__(.+?)__/g, '<u>$1</u>');
    html = html.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="msg-link">$1</a>');
    return html;
  }

  // ==================== PINNED ====================
  showPinnedMessage(data) {
    const bar = document.getElementById('pinned-bar');
    if (!bar) return;
    if (data.pinned) {
      bar.style.display = 'flex';
      document.getElementById('pinned-text').textContent = data.content?.substring(0, 80) || 'Закреплено';
      document.getElementById('pinned-sender').textContent = data.sender?.displayName || '';
    } else this.hidePinnedMessage();
  }

  hidePinnedMessage() {
    const bar = document.getElementById('pinned-bar');
    if (bar) bar.style.display = 'none';
  }

  loadPinnedMessage(msgId) {
    const el = document.querySelector(`[data-message-id="${msgId}"]`);
    if (el) {
      const t = el.querySelector('.message-text')?.textContent || 'Закреплено';
      const s = el.querySelector('.message-sender')?.textContent || '';
      this.showPinnedMessage({ pinned: true, content: t, sender: { displayName: s } });
    }
  }

  // ==================== CHAT EVENTS ====================
  bindChatEvents() {
    const input = document.getElementById('message-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
    });
    document.getElementById('btn-send').addEventListener('click', () => this.sendMessage());
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      this.emitTyping();
    });

    document.getElementById('btn-new-group').addEventListener('click', () => this.showGroupModal());
    document.getElementById('btn-cancel-reply').addEventListener('click', () => this.cancelReply());
    document.getElementById('btn-create-group').addEventListener('click', () => this.createGroup());

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'k') { e.preventDefault(); document.getElementById('search-input').focus(); }
      if (e.key === 'Escape') {
        document.getElementById('emoji-picker').style.display = 'none';
        document.getElementById('sound-dropdown').classList.remove('show');
        this.cancelReply();
        document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
        const sr = document.getElementById('search-results');
        if (sr && sr.style.display !== 'none') {
          sr.style.display = 'none';
          document.getElementById('chat-list').style.display = 'block';
          document.getElementById('search-input').value = '';
        }
      }
    });
  }

  // ==================== SIDEBAR TABS ====================
  bindSidebarTabs() {
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        if (tab.dataset.tab === 'contacts' && this.socket) {
          this.socket.emit('contacts:list');
        }
        if (tab.dataset.tab === 'channels' && this.socket) {
          this.socket.emit('channels:list');
          this.socket.emit('channels:list-subscribed');
        }
        if (tab.dataset.tab === 'favorites' && this.socket) {
          this.socket.emit('favorites:list');
        }
      });
    });
  }

  toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
  }

  // ==================== SEARCH ====================
  bindSearch() {
    const si = document.getElementById('search-input');
    let t;
    si.addEventListener('input', () => {
      clearTimeout(t);
      const q = si.value.trim();
      if (!q) {
        document.getElementById('search-results').style.display = 'none';
        return;
      }
      t = setTimeout(() => this.socket?.emit('messages:search', { query: q }), 300);
    });
    document.getElementById('btn-close-search').addEventListener('click', () => {
      document.getElementById('search-results').style.display = 'none';
      si.value = '';
    });
  }

  renderSearchResults(results, query) {
    const c = document.getElementById('search-results-list');
    const p = document.getElementById('search-results');
    c.innerHTML = '';
    p.style.display = 'block';
    if (!results.length) {
      c.innerHTML = '<div class="search-no-results">Ничего не найдено</div>';
      return;
    }
    results.forEach(msg => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      const time = new Date(msg.timestamp).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      const hl = this.escapeHTML(msg.content).replace(new RegExp(`(${this.escapeRegex(query)})`, 'gi'), '<mark>$1</mark>');
      item.innerHTML = `<div class="search-result-room">${msg.roomName}</div><div class="search-result-sender">${msg.sender.displayName}</div><div class="search-result-text">${hl}</div><div class="search-result-time">${time}</div>`;
      item.addEventListener('click', () => {
        this.switchRoom(msg.roomId);
        p.style.display = 'none';
        document.getElementById('search-input').value = '';
      });
      c.appendChild(item);
    });
  }

  escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // ==================== VOICE RECORDING ====================
  bindVoiceRecording() {
    document.getElementById('btn-voice').addEventListener('click', () => this.startRecording());
    document.getElementById('btn-cancel-voice').addEventListener('click', () => this.cancelRecording());
    document.getElementById('btn-send-voice').addEventListener('click', () => this.stopAndSendRecording());
  }

  async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = []; this.recordingSeconds = 0;
      this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);
      this.mediaRecorder.start();
      this.isRecording = true;
      document.getElementById('voice-recording').style.display = 'flex';
      document.querySelector('.message-input-wrapper').style.display = 'none';
      document.getElementById('btn-voice').style.display = 'none';
      this.recordingTimer = setInterval(() => {
        this.recordingSeconds++;
        const m = Math.floor(this.recordingSeconds / 60), s = this.recordingSeconds % 60;
        document.getElementById('recording-time').textContent = `${m}:${s.toString().padStart(2, '0')}`;
      }, 1000);
    } catch (e) { this.showNotification('Нет доступа к микрофону'); }
  }

  cancelRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    this.isRecording = false; clearInterval(this.recordingTimer);
    document.getElementById('voice-recording').style.display = 'none';
    document.querySelector('.message-input-wrapper').style.display = 'block';
    document.getElementById('btn-voice').style.display = 'flex';
  }

  stopAndSendRecording() {
    if (!this.mediaRecorder || !this.isRecording) return;
    const dur = this.recordingSeconds;
    this.mediaRecorder.onstop = async () => {
      const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
      const fd = new FormData(); fd.append('file', blob, `voice-${Date.now()}.webm`);
      try {
        const r = await fetch('/upload', { method: 'POST', body: fd });
        const fi = await r.json();
        this.socket.emit('message:send', { type: 'voice', content: 'Голосовое', room: this.currentRoom, sendSound: this.selectedSound, file: fi, duration: dur });
      } catch (e) { this.showNotification('Ошибка отправки'); }
    };
    this.mediaRecorder.stop();
    this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
    this.isRecording = false; clearInterval(this.recordingTimer);
    document.getElementById('voice-recording').style.display = 'none';
    document.querySelector('.message-input-wrapper').style.display = 'block';
    document.getElementById('btn-voice').style.display = 'flex';
  }

  // ==================== SEND / EDIT / DELETE ====================
  sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content) return;
    const msgData = {
      type: 'text', content, room: this.currentRoom,
      sendSound: this.selectedSound, replyTo: this.replyingTo
    };
    const expSelect = document.getElementById('expire-select');
    if (expSelect && expSelect.value !== '0') {
      msgData.expiresIn = parseInt(expSelect.value);
    }
    this.socket.emit('message:send', msgData);
    input.value = ''; input.style.height = 'auto';
    this.cancelReply();
    this.socket.emit('typing:stop', { room: this.currentRoom });
  }

  editMessage(messageId) {
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!el) return;
    const t = el.querySelector('.message-text');
    if (!t) return;
    const old = t.textContent.replace(' (ред.)', '');
    const nw = prompt('Редактировать:', old);
    if (nw === null || nw.trim() === '' || nw === old) return;
    this.socket.emit('message:edit', { messageId, newContent: nw.trim() });
  }

  pinMessage(id) { this.socket.emit('message:pin', { messageId: id, room: this.currentRoom }); }

  copyMessage(id) {
    const el = document.querySelector(`[data-message-id="${id}"]`);
    if (!el) return;
    const t = el.querySelector('.message-text')?.textContent || '';
    navigator.clipboard.writeText(t).then(() => this.showNotification('Скопировано'));
  }

  forwardMessage(id) { this.showForwardModal(id); }

  showForwardModal(messageId) {
    let modal = document.getElementById('modal-forward');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-forward'; modal.className = 'modal';
      modal.innerHTML = `<div class="modal-content"><div class="modal-header"><h3>Переслать</h3><button class="btn-icon" onclick="this.closest('.modal').style.display='none'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="modal-body"><div id="forward-rooms-list" class="forward-rooms-list"></div></div></div>`;
      document.body.appendChild(modal);
    }
    const list = document.getElementById('forward-rooms-list');
    list.innerHTML = '';
    this.rooms.forEach(room => {
      if (room.id === this.currentRoom) return;
      const item = document.createElement('div');
      item.className = 'chat-item'; item.style.cursor = 'pointer';
      const ini = room.name.replace(/[^\w\u0400-\u04FF]/g, '').charAt(0).toUpperCase() || '💬';
      item.innerHTML = `<div class="avatar-small">${ini}</div><div class="chat-item-info"><div class="chat-item-name">${room.name}</div></div>`;
      item.addEventListener('click', () => {
        this.socket.emit('message:forward', { messageId, targetRoom: room.id });
        modal.style.display = 'none';
        this.showNotification('Переслано');
      });
      list.appendChild(item);
    });
    modal.style.display = 'flex';
  }

  deleteMessage(id) {
    if (!confirm('Удалить сообщение?')) return;
    this.socket.emit('message:delete', { messageId: id, room: this.currentRoom });
  }

  clearChat() {
    if (!confirm('Очистить историю?')) return;
    this.socket.emit('chat:clear', { room: this.currentRoom });
  }

  deleteRoom() {
    if (this.currentRoom === 'general') { this.showNotification('Нельзя удалить общий чат'); return; }
    if (!confirm('Удалить группу?')) return;
    this.socket.emit('room:delete', { roomId: this.currentRoom });
  }

  // ==================== RENDER MESSAGES ====================
  renderMessage(msg) {
    const container = document.getElementById('messages-list');
    const id = msg.messageId || msg.id;

    if (msg.type === 'system') {
      const d = document.createElement('div');
      d.className = 'system-message'; d.textContent = msg.content;
      container.appendChild(d); return;
    }

    if (msg.type === 'poll') { this.renderPollMessage(msg, container); return; }
    if (msg.type === 'game') { this.renderGameMessage(msg, container); return; }

    const isOwn = msg.sender.username === this.user?.username;
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : ''}`;
    div.dataset.messageId = id;

    const color = msg.sender.avatarColor || '#6c5ce7';
    const avatarContent = msg.sender.avatar?.startsWith('http') ? '' : (msg.sender.avatar || msg.sender.displayName?.charAt(0).toUpperCase() || '?');
    const avatarStyle = msg.sender.avatar?.startsWith('http') ? `background:url(${msg.sender.avatar}) center/cover;` : `background:${color};`;

    const avatarHTML = isOwn ? '' : `
      <div class="avatar-colored" style="width:40px;height:40px;${avatarStyle}font-size:16px;cursor:pointer;"
        onmouseenter="app.onAvatarHover('${msg.sender.username}',event)" onmouseleave="app.onAvatarLeave()"
        onclick="app.startDM('${msg.sender.username}')">${avatarContent}</div>`;

    let soundHTML = '';
    if (msg.sendSound && msg.sendSound !== 'default' && msg.sendSound !== 'none') {
      const s = this.soundMap[msg.sendSound];
      soundHTML = `<div class="message-sound-badge" onclick="app.playSound('${msg.sendSound}')">${s?.name}</div>`;
    }

    let forwardHTML = '';
    if (msg.forwarded) {
      forwardHTML = `<div class="forwarded-tag">Переслано от ${msg.forwardedFrom || 'пользователя'}</div>`;
    }

    let voiceHTML = '';
    if (msg.type === 'voice' && msg.file) {
      const dur = msg.duration || 0;
      const m = Math.floor(dur / 60), s = dur % 60;
      voiceHTML = `<div class="voice-message"><button class="voice-play-btn" onclick="app.playVoice(this,'${msg.file.url}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></button><div class="voice-waveform">${this.generateWaveform()}</div><span class="voice-duration">${m}:${s.toString().padStart(2,'0')}</span></div>`;
    }

    let videoCircleHTML = '';
    if (msg.type === 'video_circle' && msg.file) {
      videoCircleHTML = `<div class="video-circle-msg" onclick="this.querySelector('video').classList.toggle('playing');this.querySelector('video').paused?this.querySelector('video').play():this.querySelector('video').pause()"><video src="${msg.file.url}" loop muted playsinline preload="metadata"></video><div class="play-overlay"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>`;
    }

    let fileHTML = '';
    if (msg.file && msg.type !== 'voice' && msg.type !== 'video_circle') {
      if (msg.file.mimetype?.startsWith('image/')) {
        fileHTML = `<img src="${msg.file.url}" class="message-image" onclick="window.open('${msg.file.url}','_blank')">`;
      } else {
        fileHTML = `<div class="message-file"><div class="message-file-info"><div class="message-file-name">${msg.file.originalName}</div><div class="message-file-size">${this.formatSize(msg.file.size)}</div></div><a href="${msg.file.url}" download class="btn-icon btn-small"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a></div>`;
      }
    }

    let replyHTML = '';
    if (msg.replyTo) {
      replyHTML = `<div class="reply-preview" style="margin-bottom:6px;padding:6px 10px;"><div class="reply-content"><span>${(msg.replyTo.content || '').substring(0, 50)}</span></div></div>`;
    }

    const reactionsHTML = this.renderReactions(id, msg.reactions);
    const time = new Date(msg.timestamp).toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
    const edited = msg.edited ? ' <span class="edited-tag">(ред.)</span>' : '';

    let readHTML = '';
    if (isOwn && msg.type !== 'system') {
      const read = msg.readBy?.length > 0;
      readHTML = `<span class="message-read-status ${read ? 'read' : 'unread'}">${read ? '0_0' : '-_-'}</span>`;
    }

    let actionsHTML;
    if (isOwn) {
      actionsHTML = `
        <button class="btn-msg-action" onclick="app.editMessage('${id}')" title="Ред."><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="btn-msg-action" onclick="app.copyMessage('${id}')" title="Коп."><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
        <button class="btn-msg-action" onclick="app.pinMessage('${id}')" title="Закр."><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></button>
        <button class="btn-msg-action" onclick="app.forwardMessage('${id}')" title="Пер."><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg></button>
        <button class="btn-msg-action btn-delete-msg" onclick="app.deleteMessage('${id}')" title="Уд."><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>`;
    } else {
      actionsHTML = `
        <button class="btn-msg-action" onclick="app.copyMessage('${id}')" title="Коп."><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
        <button class="btn-msg-action" onclick="app.pinMessage('${id}')" title="Закр."><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></button>
        <button class="btn-msg-action" onclick="app.forwardMessage('${id}')" title="Пер."><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg></button>
        <button class="btn-msg-action" onclick="app.setReply('${id}','${this.escapeAttr(msg.content)}')" title="Ответ"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg></button>`;
    }

    const addFavBtn = `<button class="btn-msg-action" onclick="app.addToFavorites('${id}')" title="Избр."><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg></button>`;

    const contentHTML = msg.content && msg.type !== 'voice' ? `<div class="message-text">${this.formatText(msg.content)}${edited}</div>` : '';

    div.innerHTML = `${avatarHTML}
      <div class="message-bubble">
        ${!isOwn ? `<div class="message-sender" style="cursor:pointer" onclick="app.startDM('${msg.sender.username}')">${msg.sender.displayName}</div>` : ''}
        ${forwardHTML}${soundHTML}${replyHTML}${contentHTML}${voiceHTML}${videoCircleHTML}${fileHTML}${reactionsHTML}
        <div class="message-footer"><span class="message-time">${time}</span>${readHTML}</div>
        <div class="message-actions">${addFavBtn}${actionsHTML}</div>
        <div class="reaction-picker">
          <span onclick="app.react('${id}','❤️')">❤️</span><span onclick="app.react('${id}','😂')">😂</span>
          <span onclick="app.react('${id}','👍')">👍</span><span onclick="app.react('${id}','😮')">😮</span>
          <span onclick="app.react('${id}','😢')">😢</span><span onclick="app.react('${id}','🔥')">🔥</span>
          <span onclick="app.react('${id}','💀')">💀</span>
        </div>
      </div>`;
    container.appendChild(div);
  }

  addToFavorites(messageId) {
    if (this.socket) this.socket.emit('favorites:add', { messageId });
  }

  escapeAttr(s) { return (s || '').replace(/'/g, "\\'").replace(/\n/g, ' ').substring(0, 50); }

  generateWaveform() {
    let b = '';
    for (let i = 0; i < 30; i++) b += `<div class="voice-bar" style="height:${Math.random()*20+5}px"></div>`;
    return b;
  }

  playVoice(btn, url) {
    const a = new Audio(url), ic = btn.querySelector('svg');
    if (btn.dataset.playing === 'true') { btn.dataset.playing = 'false'; ic.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>'; if (btn._a) btn._a.pause(); return; }
    btn.dataset.playing = 'true'; ic.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'; btn._a = a; a.play();
    a.onended = () => { btn.dataset.playing = 'false'; ic.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>'; };
  }

  renderReactions(id, reactions) {
    if (!reactions || !Object.keys(reactions).length) return '';
    let h = '<div class="message-reactions">';
    for (const [e, users] of Object.entries(reactions)) {
      const own = users.includes(this.user?.username);
      h += `<div class="reaction ${own?'own':''}" onclick="app.react('${id}','${e}')">${e} <span class="reaction-count">${users.length}</span></div>`;
    }
    return h + '</div>';
  }

  updateMessageReactions(id, reactions) {
    const el = document.querySelector(`[data-message-id="${id}"]`);
    if (!el) return;
    const ex = el.querySelector('.message-reactions');
    const nw = this.renderReactions(id, reactions);
    if (ex) ex.outerHTML = nw;
    else { const f = el.querySelector('.message-footer'); f?.insertAdjacentHTML('beforebegin', nw); }
  }

  react(id, emoji) { this.socket.emit('message:react', { messageId: id, emoji, room: this.currentRoom }); }

  // ==================== POLLS ====================
  showPollModal() {
    let modal = document.getElementById('modal-poll');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-poll'; modal.className = 'modal';
      modal.innerHTML = `<div class="modal-content"><div class="modal-header"><h3>Создать опрос</h3><button class="btn-icon" onclick="this.closest('.modal').style.display='none'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
      <div class="modal-body">
        <div class="input-group"><input type="text" id="poll-question" placeholder="Вопрос"></div>
        <div id="poll-options-list"><div class="input-group"><input type="text" class="poll-option-input" placeholder="Вариант 1"></div><div class="input-group"><input type="text" class="poll-option-input" placeholder="Вариант 2"></div></div>
        <button class="btn-secondary" onclick="app.addPollOption()" style="margin:8px 0;width:100%">+ Добавить вариант</button>
        <label class="checkbox-label"><input type="checkbox" id="poll-multiple"> Несколько ответов</label>
        <label class="checkbox-label"><input type="checkbox" id="poll-anon"> Анонимное</label>
      </div>
      <div class="modal-footer"><button class="btn-secondary" onclick="this.closest('.modal').style.display='none'">Отмена</button><button class="btn-primary" onclick="app.createPoll()">Создать</button></div></div>`;
      document.body.appendChild(modal);
    }
    document.getElementById('poll-question').value = '';
    document.getElementById('poll-options-list').innerHTML = `<div class="input-group"><input type="text" class="poll-option-input" placeholder="Вариант 1"></div><div class="input-group"><input type="text" class="poll-option-input" placeholder="Вариант 2"></div>`;
    modal.style.display = 'flex';
  }

  addPollOption() {
    const list = document.getElementById('poll-options-list');
    const count = list.querySelectorAll('.poll-option-input').length + 1;
    const div = document.createElement('div');
    div.className = 'input-group';
    div.innerHTML = `<input type="text" class="poll-option-input" placeholder="Вариант ${count}">`;
    list.appendChild(div);
  }

  createPoll() {
    const q = document.getElementById('poll-question').value.trim();
    if (!q) { this.showNotification('Введите вопрос'); return; }
    const opts = Array.from(document.querySelectorAll('.poll-option-input')).map(i => i.value.trim()).filter(v => v);
    if (opts.length < 2) { this.showNotification('Минимум 2 варианта'); return; }
    this.socket.emit('poll:create', {
      question: q, options: opts, room: this.currentRoom,
      multipleChoice: document.getElementById('poll-multiple').checked,
      anonymous: document.getElementById('poll-anon').checked
    });
    document.getElementById('modal-poll').style.display = 'none';
  }

  renderPollMessage(msg, container) {
    const div = document.createElement('div');
    div.className = 'message'; div.dataset.messageId = msg.messageId || msg.id;
    const pd = msg.pollData; if (!pd) return;
    let optsHTML = '';
    const totalVotes = pd.options.reduce((sum, o) => sum + (o.votes?.length || 0), 0);
    pd.options.forEach((opt, i) => {
      const votes = opt.votes?.length || 0;
      const pct = totalVotes > 0 ? Math.round(votes / totalVotes * 100) : 0;
      const voted = opt.votes?.includes(this.user?.username);
      optsHTML += `<div class="poll-option ${voted?'voted':''}" onclick="app.votePoll('${pd.pollId}',${i})">
        <div class="poll-option-bar" style="width:${pct}%"></div>
        <span class="poll-option-text">${opt.text}</span>
        <span class="poll-option-pct">${pct}% (${votes})</span></div>`;
    });
    div.innerHTML = `<div class="poll-card" data-poll-id="${pd.pollId}">
      <div class="poll-header">Опрос от ${msg.sender.displayName}</div>
      <div class="poll-question">${pd.question}</div>
      <div class="poll-options">${optsHTML}</div>
      <div class="poll-footer">${totalVotes} голосов</div></div>`;
    container.appendChild(div);
  }

  votePoll(pollId, optionIndex) { this.socket.emit('poll:vote', { pollId, optionIndex }); }

  updatePoll(data) {
    const card = document.querySelector(`[data-poll-id="${data.pollId}"]`);
    if (!card) return;
    const optsContainer = card.querySelector('.poll-options');
    const totalVotes = data.options.reduce((sum, o) => sum + (o.votes?.length || 0), 0);
    let html = '';
    data.options.forEach((opt, i) => {
      const votes = opt.votes?.length || 0;
      const pct = totalVotes > 0 ? Math.round(votes / totalVotes * 100) : 0;
      const voted = opt.votes?.includes(this.user?.username);
      html += `<div class="poll-option ${voted?'voted':''}" onclick="app.votePoll('${data.pollId}',${i})">
        <div class="poll-option-bar" style="width:${pct}%"></div>
        <span class="poll-option-text">${opt.text}</span>
        <span class="poll-option-pct">${pct}% (${votes})</span></div>`;
    });
    optsContainer.innerHTML = html;
    card.querySelector('.poll-footer').textContent = `${totalVotes} голосов`;
  }

  // ==================== GAMES ====================
  showGamesMenu() {
    let modal = document.getElementById('modal-games');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-games'; modal.className = 'modal';
      modal.innerHTML = `<div class="modal-content"><div class="modal-header"><h3>Игры</h3><button class="btn-icon" onclick="this.closest('.modal').style.display='none'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
      <div class="modal-body">
        <div class="games-list">
          <div class="game-card" onclick="app.startTicTacToe()"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg><span>Крестики-нолики</span></div>
          <div class="game-card" onclick="app.startRPS()"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 010-5C7 4 9 8 12 13c3-5 5-9 7.5-9a2.5 2.5 0 010 5H18"/><path d="M4 22h16"/><path d="M12 22V9"/></svg><span>Камень-Ножницы-Бумага</span></div>
          <div class="game-card" onclick="app.rollDice()"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><circle cx="16" cy="8" r="1"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/></svg><span>Бросить кубик</span></div>
        </div>
      </div></div>`;
      document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
  }

  startTicTacToe() {
    document.getElementById('modal-games').style.display = 'none';
    const opponents = this.onlineUsers.filter(u => u.username !== this.user?.username);
    if (!opponents.length) { this.showNotification('Нет игроков онлайн'); return; }
    const name = prompt('Имя соперника:\n' + opponents.map(u => u.displayName + ' (' + u.username + ')').join('\n'));
    if (!name) return;
    const opp = opponents.find(u => u.username === name || u.displayName === name);
    if (!opp) { this.showNotification('Игрок не найден'); return; }
    this.socket.emit('game:tictactoe:start', { opponent: opp.username, room: this.currentRoom });
  }

  renderGameMessage(msg, container) {
    const div = document.createElement('div');
    div.className = 'message'; div.dataset.messageId = msg.messageId || msg.id;
    const gd = msg.gameData;
    if (!gd) { div.innerHTML = `<div class="system-message">${msg.content}</div>`; container.appendChild(div); return; }

    if (gd.type === 'tictactoe') {
      let boardHTML = '<div class="ttt-board">';
      for (let i = 0; i < 9; i++) {
        boardHTML += `<div class="ttt-cell" onclick="app.tttMove('${gd.id}',${i})">${gd.board[i] || ''}</div>`;
      }
      boardHTML += '</div>';
      const status = gd.winner ? (gd.winner === 'draw' ? 'Ничья!' : `Победил ${gd.winner}!`) : `Ход: ${gd.currentTurn}`;
      div.innerHTML = `<div class="game-card-msg" data-game-id="${gd.id}">
        <div class="game-header">Крестики-нолики</div>
        ${boardHTML}<div class="game-status">${status}</div></div>`;
    } else if (gd.type === 'rps') {
      div.innerHTML = `<div class="game-card-msg" data-game-id="${gd.id || gd.gameId}">
        <div class="game-header">Камень-Ножницы-Бумага</div>
        <div class="rps-choices">
          <button class="rps-btn" onclick="app.rpsChoose('${gd.id || gd.gameId}','rock')">🪨</button>
          <button class="rps-btn" onclick="app.rpsChoose('${gd.id || gd.gameId}','scissors')">✂️</button>
          <button class="rps-btn" onclick="app.rpsChoose('${gd.id || gd.gameId}','paper')">📄</button>
        </div>
        <div class="game-status">Выберите!</div></div>`;
    }
    container.appendChild(div);
  }

  tttMove(gameId, pos) { this.socket.emit('game:tictactoe:move', { gameId, position: pos }); }

  updateTicTacToe(game) {
    const card = document.querySelector(`[data-game-id="${game.id}"]`);
    if (!card) return;
    const cells = card.querySelectorAll('.ttt-cell');
    game.board.forEach((v, i) => { cells[i].textContent = v || ''; cells[i].className = `ttt-cell ${v ? 'filled' : ''}`; });
    const status = card.querySelector('.game-status');
    if (game.winner) {
      if (game.winner === 'draw') status.textContent = 'Ничья!';
      else status.textContent = `Победил ${game.winner}!`;
    } else {
      status.textContent = `Ход: ${game.currentTurn}`;
    }
  }

  startRPS() {
    document.getElementById('modal-games').style.display = 'none';
    const opponents = this.onlineUsers.filter(u => u.username !== this.user?.username);
    if (!opponents.length) { this.showNotification('Нет игроков онлайн'); return; }
    const name = prompt('Имя соперника:\n' + opponents.map(u => u.displayName + ' (' + u.username + ')').join('\n'));
    if (!name) return;
    const opp = opponents.find(u => u.username === name || u.displayName === name);
    if (!opp) { this.showNotification('Игрок не найден'); return; }
    this.socket.emit('game:rps:start', { opponent: opp.username, room: this.currentRoom });
  }

  rpsChoose(gameId, choice) { this.socket.emit('game:rps:choose', { gameId, choice }); }

  showRPSResult(game) {
    const players = Object.keys(game.players);
    const choices = { rock: '🪨', scissors: '✂️', paper: '📄' };
    let result;
    if (game.winner === 'draw') result = 'Ничья!';
    else result = `${game.playerNames[game.winner] || game.winner} победил!`;
    this.showNotification(`${choices[game.players[players[0]]]} vs ${choices[game.players[players[1]]} — ${result}`);
  }

  rollDice() {
    document.getElementById('modal-games')?.style.display === 'flex' && (document.getElementById('modal-games').style.display = 'none');
    this.socket.emit('game:dice', { room: this.currentRoom });
  }

  // ==================== HOVER PROFILE ====================
  onAvatarHover(username, e) {
    clearTimeout(this.hoverTimeout);
    this.hoverTimeout = setTimeout(() => {
      this._hoverEvent = e;
      this.socket.emit('profile:get', { username });
    }, 500);
  }

  onAvatarLeave() {
    clearTimeout(this.hoverTimeout);
    setTimeout(() => {
      const p = document.getElementById('profile-hover-popup');
      if (p && !p.matches(':hover')) p.style.display = 'none';
    }, 300);
  }

  showProfilePopup(profile) {
    let p = document.getElementById('profile-hover-popup');
    if (!p) {
      p = document.createElement('div');
      p.id = 'profile-hover-popup'; p.className = 'profile-hover-popup';
      p.addEventListener('mouseleave', () => p.style.display = 'none');
      document.body.appendChild(p);
    }
    const avatarStyle = profile.avatar?.startsWith('http') ? `background:url(${profile.avatar}) center/cover;` : `background:${profile.avatarColor || '#6c5ce7'};`;
    const avatarContent = profile.avatar?.startsWith('http') ? '' : (profile.avatar || profile.displayName.charAt(0).toUpperCase());
    const lastSeen = profile.lastSeen ? new Date(profile.lastSeen).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
    const isOnline = this.onlineUsers.some(u => u.username === profile.username);

    p.innerHTML = `<div class="hover-profile-header">
      <div class="avatar-colored" style="width:50px;height:50px;${avatarStyle}font-size:22px">${avatarContent}</div>
      <div class="hover-profile-info"><div class="hover-profile-name">${profile.displayName}</div>
      <div class="hover-profile-username">@${profile.username}</div></div></div>
      ${profile.activityStatus ? `<div class="hover-profile-activity">${profile.activityStatus}</div>` : ''}
      ${profile.bio ? `<div class="hover-profile-bio">${profile.bio}</div>` : ''}
      ${profile.statusText ? `<div class="hover-profile-status">${profile.statusText}</div>` : ''}
      <div class="hover-profile-online">${isOnline ? 'В сети' : `Был(а) ${lastSeen}`}</div>
      <div class="hover-profile-actions">
        <button class="btn-primary btn-small-full" onclick="app.startDM('${profile.username}');document.getElementById('profile-hover-popup').style.display='none'">
          Написать</button></div>`;

    if (this._hoverEvent) {
      const r = this._hoverEvent.target.getBoundingClientRect();
      p.style.top = Math.min(r.top - 10, window.innerHeight - 280) + 'px';
      p.style.left = (r.right + 10 + 240 > window.innerWidth ? r.left - 240 : r.right + 10) + 'px';
    }
    p.style.display = 'block';
  }

  startDM(username) {
    if (username === this.user?.username) return;
    if (this.user?.blockedUsers?.includes(username)) { this.showNotification('Пользователь заблокирован'); return; }
    this.socket.emit('dm:start', { username });
  }

  // ==================== CHAT LIST ====================
  renderChatList() {
    const c = document.getElementById('chat-list');
    c.innerHTML = '';
    this.rooms.forEach(room => {
      const item = document.createElement('div');
      const unread = this.unreadCounts[room.id] || 0;
      item.className = `chat-item ${room.id === this.currentRoom ? 'active' : ''} ${unread > 0 ? 'has-unread' : ''}`;
      const initial = room.name.replace(/[^\w\u0400-\u04FF]/g, '').charAt(0).toUpperCase() || '💬';
      const online = this.getOnlineCountForRoom(room);
      const badge = unread > 0 ? `<div class="unread-badge">${unread > 99 ? '99+' : unread}</div>` : '';
      item.innerHTML = `<div class="avatar-small">${initial}</div>
        <div class="chat-item-info"><div class="chat-item-name">${room.name}</div>
        <div class="chat-item-last">${room.type === 'direct' ? 'Личные сообщения' : `${online} в сети`}</div></div>${badge}`;
      item.addEventListener('click', () => { if (this.currentRoom !== room.id) this.switchRoom(room.id); });
      c.appendChild(item);
    });
  }

  getOnlineCountForRoom(room) {
    const on = this.onlineUsers.map(u => u.username);
    return room.members?.filter(m => on.includes(m)).length || 0;
  }

  switchRoom(roomId) {
    if (this.isJoiningRoom) return;
    this.currentRoom = roomId; this.isJoiningRoom = true;
    this.updateChatHeader(this.rooms.get(roomId));
    document.getElementById('messages-list').innerHTML = '';
    this.socket.emit('room:join', { roomId });
    this.markAsRead(roomId);
    this.renderChatList();
    setTimeout(() => this.isJoiningRoom = false, 3000);

    // Scroll-to-top pagination
    const msgList = document.getElementById('messages-list');
    if (msgList._scrollHandler) msgList.removeEventListener('scroll', msgList._scrollHandler);
    msgList._scrollHandler = () => {
      if (msgList.scrollTop > 50) return;
      if (this._isLoadingOlder) return;
      const offset = this._msgOffsets.get(this.currentRoom);
      if (offset == null || offset < 0) return;
      this._isLoadingOlder = true;
      this.socket.emit('messages:load-older', { room: this.currentRoom, offset });
      this._msgOffsets.set(this.currentRoom, offset + 50);
    };
    msgList.addEventListener('scroll', msgList._scrollHandler);
  }

  updateChatHeader(room) {
    if (!room) return;
    document.getElementById('chat-name').textContent = room.name;
    const roomType = room.type;
    if (roomType === 'direct') {
      const other = room.members?.find(m => m !== this.user?.username);
      document.getElementById('chat-subtitle').textContent = this.onlineUsers.some(u => u.username === other) ? 'В сети' : 'Не в сети';
    } else if (room.id && room.id.startsWith('ch-')) {
      document.getElementById('chat-subtitle').textContent = 'Канал';
    } else {
      document.getElementById('chat-subtitle').textContent = `${this.getOnlineCountForRoom(room)} из ${room.members?.length || 0} в сети`;
    }
    const av = document.getElementById('chat-avatar');
    if (room.avatar) {
      if (room.avatar.startsWith('http')) { av.style.background = `url(${room.avatar}) center/cover`; av.innerHTML = ''; }
      else { av.style.background = 'linear-gradient(135deg, var(--primary), var(--accent))'; av.innerHTML = room.avatar; }
    } else {
      av.style.background = 'linear-gradient(135deg, var(--primary), var(--accent))';
      av.innerHTML = (room.name?.charAt(0) || '#').toUpperCase();
    }
  }

  updateChatSubtitle() {
    const room = this.rooms.get(this.currentRoom);
    if (!room) return;
    const sub = document.getElementById('chat-subtitle');
    if (room.type === 'direct') {
      const other = room.members?.find(m => m !== this.user?.username);
      sub.textContent = this.onlineUsers.some(u => u.username === other) ? 'В сети' : 'Не в сети';
    } else {
      sub.textContent = `${this.getOnlineCountForRoom(room)} из ${room.members?.length || 0} в сети`;
    }
  }

  // ==================== USERS LIST ====================
  renderUsersList() {
    const c = document.getElementById('users-list');
    c.innerHTML = '';
    document.querySelector('.panel-header h3').textContent = `Участники (${this.onlineUsers.length})`;

    this.onlineUsers.forEach(user => {
      const item = document.createElement('div');
      item.className = 'user-item';
      const isMe = user.username === this.user?.username;
      const color = user.avatarColor || '#6c5ce7';
      const ac = user.avatar?.startsWith('http') ? '' : (user.avatar || user.displayName.charAt(0).toUpperCase());
      const as = user.avatar?.startsWith('http') ? `background:url(${user.avatar}) center/cover;` : `background:${color};`;

      item.innerHTML = `<div class="avatar-colored" style="width:40px;height:40px;${as}font-size:16px;position:relative">${ac}<div class="online-dot"></div></div>
        <div class="user-item-info"><div class="user-item-name">${user.displayName}${isMe?' (вы)':''}</div>
        <div class="user-item-status">${user.activityStatus || user.statusText || 'В сети'}</div>
        ${user.bio ? `<div class="user-item-bio">${user.bio}</div>` : ''}</div>`;

      item.style.cursor = 'pointer';
      item.addEventListener('click', () => { if (isMe) this.showMyProfile(); else this.startDM(user.username); });
      item.addEventListener('mouseenter', (e) => {
        if (!isMe) this.hoverTimeout = setTimeout(() => { this._hoverEvent = e; this.showProfilePopup(user); }, 600);
      });
      item.addEventListener('mouseleave', () => {
        clearTimeout(this.hoverTimeout);
        setTimeout(() => { const pp = document.getElementById('profile-hover-popup'); if (pp && !pp.matches(':hover')) pp.style.display = 'none'; }, 300);
      });
      c.appendChild(item);
    });
  }

  // ==================== CONTACTS TAB ====================
  renderContacts() {
    const c = document.getElementById('contacts-list');
    if (!c) return;
    c.innerHTML = '';
    if (!this.contacts.length) {
      const allUsernames = new Set();
      this.dms.forEach(dm => {
        dm.members?.forEach(m => { if (m !== this.user?.username) allUsernames.add(m); });
      });
      allUsernames.forEach(username => {
        const u = this.onlineUsers.find(o => o.username === username) || { username, displayName: username, avatarColor: '#6c5ce7', status: 'offline' };
        this.contacts.push(u);
      });
    }
    if (!this.contacts.length) {
      c.innerHTML = '<div class="fav-empty">Нет контактов</div>';
      return;
    }
    this.contacts.forEach(contact => {
      const item = document.createElement('div');
      item.className = 'contact-item';
      const isOnline = this.onlineUsers.some(u => u.username === contact.username);
      const color = contact.avatarColor || '#6c5ce7';
      const avatarContent = contact.avatar?.startsWith('http') ? '' : (contact.avatar || contact.displayName.charAt(0).toUpperCase());
      const avatarStyle = contact.avatar?.startsWith('http') ? `background:url(${contact.avatar}) center/cover;` : `background:${color};`;
      item.innerHTML = `<div class="avatar-colored" style="width:40px;height:40px;${avatarStyle}font-size:16px;position:relative">${avatarContent}${isOnline ? '<div class="online-dot"></div>' : ''}</div>
        <div class="contact-info"><div class="contact-name">${contact.displayName}</div>
        <div class="contact-status ${isOnline ? 'contact-online' : 'contact-offline'}">${isOnline ? 'В сети' : 'Не в сети'}</div></div>`;
      item.addEventListener('click', () => this.startDM(contact.username));
      c.appendChild(item);
    });
  }

  // ==================== CHANNELS TAB ====================
  bindChannelsUI() {
    document.getElementById('btn-create-channel').addEventListener('click', () => {
      document.getElementById('modal-create-channel').style.display = 'flex';
    });
    document.getElementById('channel-private').addEventListener('change', (e) => {});
  }

  renderChannels() {
    const c = document.getElementById('channels-list');
    if (!c) return;
    c.innerHTML = '';
    const subTab = document.querySelector('.channel-tab.active')?.dataset.subtab || 'subscribed';

    if (subTab === 'subscribed') {
      if (!this.channels.length) {
        c.innerHTML = '<div class="fav-empty">Нет подписок</div>';
        return;
      }
      this.channels.forEach(ch => {
        const card = document.createElement('div');
        card.className = 'channel-card';
        card.innerHTML = `<div class="channel-card-header">
          <div class="avatar-small">${(ch.name?.charAt(0) || '#').toUpperCase()}</div>
          <div class="channel-card-name">${ch.name}</div></div>
          <div class="channel-card-desc">${ch.description || 'Нет описания'}</div>
          <div class="channel-card-meta">
            <span>Подписчиков: ${typeof ch.subscribers === 'number' ? ch.subscribers : (ch.subscribers?.length || 0)}</span>
            <span>${ch.type === 'private' ? 'Приватный' : 'Публичный'}</span>
          </div>
          <div class="channel-card-actions">
            <button class="unsubscribe-btn" onclick="app.unsubscribeChannel('${ch.channelId}')">Отписаться</button>
            <button class="subscribe-btn" onclick="app.openChannel('${ch.channelId}')">Открыть</button>
          </div>`;
        c.appendChild(card);
      });
    } else {
      if (this._publicChannels) {
        this._publicChannels.forEach(ch => {
          const card = document.createElement('div');
          card.className = 'channel-card';
          const isSubscribed = this.channels.some(s => s.channelId === ch.channelId);
          card.innerHTML = `<div class="channel-card-header">
            <div class="avatar-small">${(ch.name?.charAt(0) || '#').toUpperCase()}</div>
            <div class="channel-card-name">${ch.name}</div></div>
            <div class="channel-card-desc">${ch.description || 'Нет описания'}</div>
            <div class="channel-card-meta">
              <span>Подписчиков: ${ch.subscribers || 0}</span>
              <span>${ch.type === 'private' ? 'Приватный' : 'Публичный'}</span>
            </div>
            <div class="channel-card-actions">
              ${isSubscribed
                ? `<button class="unsubscribe-btn" onclick="app.unsubscribeChannel('${ch.channelId}')">Отписаться</button>
                   <button class="subscribe-btn" onclick="app.openChannel('${ch.channelId}')">Открыть</button>`
                : `<button class="subscribe-btn" onclick="app.subscribeChannel('${ch.channelId}')">Подписаться</button>`}
            </div>`;
          c.appendChild(card);
        });
      } else {
        c.innerHTML = '<div class="fav-empty">Загрузка...</div>';
        if (this.socket) this.socket.emit('channels:list');
      }
    }

    const chTabsContainer = document.querySelector('.channel-tabs');
    if (chTabsContainer && !chTabsContainer.dataset.bound) {
      chTabsContainer.dataset.bound = '1';
      chTabsContainer.addEventListener('click', (e) => {
        const tab = e.target.closest('.channel-tab');
        if (!tab) return;
        document.querySelectorAll('.channel-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._channelsSubTab = tab.dataset.subtab;
        if (tab.dataset.subtab === 'public' && this.socket) {
          this.socket.emit('channels:list');
        }
        this.renderChannels();
      });
    }
  }

  subscribeChannel(channelId) {
    if (this.socket) this.socket.emit('channel:subscribe', { channelId });
  }

  unsubscribeChannel(channelId) {
    if (this.socket) this.socket.emit('channel:unsubscribe', { channelId });
  }

  openChannel(channelId) {
    const roomId = 'ch-' + channelId;
    if (this.currentRoom !== roomId) this.switchRoom(roomId);
  }

  createChannel() {
    const name = document.getElementById('channel-name-input').value.trim();
    if (!name) { this.showNotification('Введите название'); return; }
    const type = document.getElementById('channel-private').checked ? 'private' : 'public';
    const description = document.getElementById('channel-desc-input').value.trim();
    this.socket.emit('channel:create', { name, type, description });
    document.getElementById('modal-create-channel').style.display = 'none';
    document.getElementById('channel-name-input').value = '';
    document.getElementById('channel-desc-input').value = '';
    document.getElementById('channel-private').checked = false;
  }

  // ==================== FAVORITES TAB ====================
  renderFavorites() {
    const c = document.getElementById('favorites-list');
    if (!c) return;
    c.innerHTML = '';
    if (!this.favorites.length) {
      c.innerHTML = '<div class="fav-empty">Нет избранных сообщений</div>';
      return;
    }
    this.favorites.forEach(fav => {
      const card = document.createElement('div');
      card.className = 'fav-card';
      const time = fav.timestamp ? new Date(fav.timestamp).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
      const senderName = fav.sender?.displayName || 'Неизвестно';
      card.innerHTML = `<div class="fav-card-header">
        <span class="fav-card-sender">${senderName}</span>
        <span class="fav-card-room">${fav.room || ''}</span>
      </div>
      <div class="fav-card-content">${fav.content || 'Файл'}</div>
      <div class="fav-card-time">${time}</div>
      <button class="fav-card-remove" onclick="app.removeFavorite('${fav.id}')">Удалить</button>`;
      card.addEventListener('click', (e) => {
        if (e.target.closest('.fav-card-remove')) return;
        if (fav.room) this.switchRoom(fav.room);
      });
      c.appendChild(card);
    });
  }

  removeFavorite(id) {
    if (this.socket) this.socket.emit('favorites:remove', { id });
  }

  // ==================== MY PROFILE ====================
  showMyProfile() {
    const modal = document.getElementById('modal-profile');

    // populate profile pane
    document.getElementById('profile-displayname').value = this.user.displayName || '';
    document.getElementById('profile-bio').value = this.user.bio || '';
    document.getElementById('profile-username').value = this.user.username || '';
    document.getElementById('profile-phone-display-input').value = this.user.phone || '';
    document.getElementById('profile-name-display').textContent = this.user.displayName || this.user.username;
    document.getElementById('profile-phone-display').textContent = this.user.phone ? '+'+this.user.phone : '';
    const av = document.getElementById('profile-avatar-large');
    this.setAvatarElement(av, this.user);
    this.buildAvatarEmojiGrid();
    this.buildBackgroundPicker();
    this.buildColorPicker();

    // privacy pane
    document.getElementById('profile-invisible').checked = !!this.user.invisible;
    document.getElementById('profile-dnd').checked = !!this.user.doNotDisturb;

    // account pane
    const createdAt = document.getElementById('profile-created-at');
    if (this.user.createdAt) {
      const d = new Date(this.user.createdAt);
      createdAt.textContent = d.toLocaleDateString('ru-RU', { day:'numeric', month:'long', year:'numeric' });
    } else {
      createdAt.textContent = '—';
    }

    // theme picker
    document.querySelectorAll('.theme-option').forEach(el => {
      el.classList.toggle('active', el.dataset.theme === (this.currentTheme || 'dark'));
    });

    // sound selector inline
    this.buildSoundSelectorInline();

    // reset to first tab
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
    document.querySelector('.settings-tab[data-stab="profile"]')?.classList.add('active');
    document.getElementById('stab-profile')?.classList.add('active');

    modal.style.display = 'flex';
  }

  applyThemeFromPicker(theme) {
    this.applyTheme(theme);
    document.querySelectorAll('.theme-option').forEach(el => {
      el.classList.toggle('active', el.dataset.theme === theme);
    });
  }

  buildSoundSelectorInline() {
    const c = document.getElementById('sound-selector-inline');
    if (!c) return;
    c.innerHTML = '';
    Object.keys(this.soundMap).forEach(key => {
      const btn = document.createElement('button');
      btn.className = `sound-chip${this.selectedSound === key ? ' active' : ''}`;
      btn.textContent = this.soundMap[key].name;
      btn.addEventListener('click', () => {
        this.selectedSound = key;
        c.querySelectorAll('.sound-chip').forEach(ch => ch.classList.remove('active'));
        btn.classList.add('active');
      });
      c.appendChild(btn);
    });
  }

  initSettingsTabs() {
    document.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const pane = document.getElementById('stab-' + tab.dataset.stab);
        if (pane) pane.classList.add('active');
      });
    });

    // theme picker
    document.querySelectorAll('.theme-option').forEach(el => {
      el.addEventListener('click', () => this.applyThemeFromPicker(el.dataset.theme));
    });

    // avatar file input
    const avatarInput = document.getElementById('avatar-file-input');
    if (avatarInput) {
      avatarInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) this.uploadAvatar(file);
      });
    }
  }

  buildColorPicker() {
    const c = document.getElementById('profile-color-picker');
    if (!c) return;
    c.innerHTML = '';
    this.profileColors.forEach(color => {
      const d = document.createElement('span');
      d.className = `color-dot ${this.user.avatarColor === color ? 'active' : ''}`;
      d.style.background = color;
      d.addEventListener('click', () => this.setAvatarColor(color));
      c.appendChild(d);
    });
  }

  setAvatarColor(color) {
    this.user.avatarColor = color;
    const av = document.getElementById('profile-avatar-large');
    if (!this.user.avatar?.startsWith('http')) av.style.background = color;
    document.querySelectorAll('.color-dot').forEach(d => d.classList.toggle('active', d.style.backgroundColor === color));
  }

  buildAvatarEmojiGrid() {
    const g = document.getElementById('avatar-emoji-grid'); if (!g) return;
    g.innerHTML = '';
    this.avatarEmojis.forEach(e => {
      const s = document.createElement('span');
      s.className = `avatar-emoji-option ${this.user.avatar === e ? 'active' : ''}`;
      s.textContent = e;
      s.addEventListener('click', () => {
        this.user.avatar = e;
        const av = document.getElementById('profile-avatar-large');
        av.textContent = e; av.style.background = this.user.avatarColor || '#6c5ce7';
        document.querySelectorAll('.avatar-emoji-option').forEach(o => o.classList.remove('active'));
        s.classList.add('active');
      });
      g.appendChild(s);
    });
    const up = document.createElement('span');
    up.className = 'avatar-emoji-option avatar-upload-btn'; up.textContent = '📷'; up.title = 'Загрузить фото';
    up.addEventListener('click', () => document.getElementById('avatar-file-input').click());
    g.appendChild(up);
    const reset = document.createElement('span');
    reset.className = 'avatar-emoji-option'; reset.textContent = '❌'; reset.title = 'Сбросить';
    reset.addEventListener('click', () => {
      this.user.avatar = null;
      const av = document.getElementById('profile-avatar-large');
      av.textContent = this.user.displayName.charAt(0).toUpperCase();
      av.style.background = this.user.avatarColor || '#6c5ce7';
      document.querySelectorAll('.avatar-emoji-option').forEach(o => o.classList.remove('active'));
    });
    g.appendChild(reset);
  }

  buildBackgroundPicker() {
    const c = document.getElementById('bg-picker-grid'); if (!c) return;
    c.innerHTML = '';
    this.backgrounds.forEach(bg => {
      const d = document.createElement('div');
      d.className = `bg-option ${this.chatBackground === bg.id ? 'active' : ''}`;
      d.style.background = bg.css || 'var(--bg-chat)';
      d.title = bg.name;
      d.addEventListener('click', () => {
        this.setChatBackground(bg.id);
        document.querySelectorAll('.bg-option').forEach(o => o.classList.remove('active'));
        d.classList.add('active');
      });
      c.appendChild(d);
    });
  }

  async uploadAvatar(file) {
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await fetch('/upload', { method: 'POST', body: fd });
      const fi = await r.json();
      this.user.avatar = fi.url;
      const av = document.getElementById('profile-avatar-large');
      av.style.background = `url(${fi.url}) center/cover`; av.textContent = '';
    } catch (e) { this.showNotification('Ошибка загрузки'); }
  }

  saveProfile() {
    const displayName = document.getElementById('profile-displayname').value.trim() || this.user.username;
    this.user.displayName = displayName;
    this.socket.emit('profile:update', {
      displayName,
      bio: document.getElementById('profile-bio').value.trim(),
      avatarColor: this.user.avatarColor,
      avatar: this.user.avatar,
      activityStatus: this.user.activityStatus || '',
      invisible: document.getElementById('profile-invisible')?.checked || false,
      doNotDisturb: document.getElementById('profile-dnd')?.checked || false,
      theme: this.currentTheme
    });
    document.getElementById('profile-name-display').textContent = displayName;
    document.getElementById('modal-profile').style.display = 'none';
    this.updateMyProfile();
    this.showNotification('Профиль обновлён');
  }

  logout() {
    if (this.socket) {
      this.socket.emit('user:logout');
      this.socket.disconnect();
      this.socket = null;
    }
    this.user = null;
    this.currentRoom = null;
    this.messages = {};
    localStorage.removeItem('hb-session-token');
    localStorage.removeItem('pulse-token');
    localStorage.removeItem('pulse-phone');
    localStorage.removeItem('pulse-username');
    document.getElementById('modal-profile').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('chat-container').style.display = 'none';
    document.getElementById('sidebar-container').style.display = 'none';
    this.showNotification('Вы вышли из аккаунта');
  }

  // ==================== STATS ====================
  showStats() { this.socket.emit('stats:get', { room: this.currentRoom }); }

  showStatsModal(data) {
    let modal = document.getElementById('modal-stats');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-stats'; modal.className = 'modal';
      document.body.appendChild(modal);
    }
    let topHTML = data.topSenders.map((s, i) => `<div class="stat-row"><span class="stat-rank">${i+1}.</span><span class="stat-name">${s.name}</span><span class="stat-count">${s.count} сообщ.</span></div>`).join('');
    modal.innerHTML = `<div class="modal-content"><div class="modal-header"><h3>Статистика</h3><button class="btn-icon" onclick="this.closest('.modal').style.display='none'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="modal-body"><div class="stats-grid"><div class="stat-card"><div class="stat-number">${data.totalMessages}</div><div class="stat-label">Сообщений</div></div>
    <div class="stat-card"><div class="stat-number">${data.totalMembers}</div><div class="stat-label">Участников</div></div></div>
    <h4 style="margin:16px 0 8px">Топ отправителей</h4>${topHTML}</div></div>`;
    modal.style.display = 'flex';
  }

  // ==================== GROUPS ====================
  showGroupModal() {
    const modal = document.getElementById('modal-new-group');
    const mc = document.getElementById('members-select');
    mc.innerHTML = '';
    this.onlineUsers.forEach(u => {
      if (u.username === this.user?.username) return;
      const opt = document.createElement('label');
      opt.className = 'member-option';
      const color = u.avatarColor || '#6c5ce7';
      opt.innerHTML = `<input type="checkbox" value="${u.username}"><div class="avatar-colored" style="width:32px;height:32px;background:${color};font-size:13px">${u.displayName.charAt(0).toUpperCase()}</div><span>${u.displayName}</span>`;
      mc.appendChild(opt);
    });
    modal.style.display = 'flex';
  }

  createGroup() {
    const name = document.getElementById('group-name-input').value.trim();
    if (!name) { this.showNotification('Введите название'); return; }
    const members = Array.from(document.querySelectorAll('#members-select input:checked')).map(c => c.value);
    const isSecret = document.getElementById('group-secret')?.checked || false;
    const password = isSecret ? document.getElementById('group-password')?.value : null;
    this.socket.emit('room:create', { name, type: 'group', members, isSecret, secretPassword: password, description: document.getElementById('group-desc')?.value || '' });
    document.getElementById('modal-new-group').style.display = 'none';
    document.getElementById('group-name-input').value = '';
    document.getElementById('group-desc').value = '';
  }

  getInviteLink() {
    const room = this.rooms.get(this.currentRoom);
    if (!room?.inviteCode) return;
    const link = `${window.location.origin}/invite/${room.inviteCode}`;
    navigator.clipboard.writeText(link).then(() => this.showNotification('Ссылка скопирована'));
  }

  // ==================== MODERATION ====================
  banUser(username) {
    if (!confirm(`Заблокировать ${username}?`)) return;
    this.socket.emit('room:ban', { roomId: this.currentRoom, username });
  }

  muteUser(username, muted) {
    this.socket.emit('room:mute', { roomId: this.currentRoom, username, muted });
  }

  setRole(username, role) {
    this.socket.emit('room:set-role', { roomId: this.currentRoom, username, role });
  }

  blockUser(username) {
    if (!confirm(`Заблокировать ${username}?`)) return;
    this.socket.emit('user:block', { username });
  }

  // ==================== SOUND / EMOJI / FILES ====================
  bindSoundSelector() {
    const btn = document.getElementById('btn-sound');
    const dd = document.getElementById('sound-dropdown');
    btn.addEventListener('click', (e) => { e.stopPropagation(); dd.classList.toggle('show'); });
    document.querySelectorAll('.sound-option').forEach(o => {
      o.addEventListener('click', (e) => {
        this.selectedSound = o.dataset.sound;
        document.querySelectorAll('.sound-option').forEach(x => x.classList.remove('active'));
        o.classList.add('active');
        btn.classList.toggle('has-sound', o.dataset.sound !== 'default');
        dd.classList.remove('show');
      });
    });
    document.addEventListener('click', () => dd.classList.remove('show'));
  }

  showSoundNotification(type) {
    const s = this.soundMap[type]; if (!s) return;
    const n = document.getElementById('sound-notification');
    document.getElementById('sound-notif-text').textContent = `${s.name}!`;
    n.style.display = 'block'; setTimeout(() => n.style.display = 'none', 3000);
  }

  showNotification(text) {
    const n = document.getElementById('sound-notification');
    document.getElementById('sound-notif-text').textContent = text;
    n.style.display = 'block'; setTimeout(() => n.style.display = 'none', 3000);
  }

  bindEmojiPicker() {
    const btn = document.getElementById('btn-emoji');
    const picker = document.getElementById('emoji-picker');
    btn.addEventListener('click', (e) => { e.stopPropagation(); picker.style.display = picker.style.display === 'none' ? 'block' : 'none'; });
    document.addEventListener('click', () => picker.style.display = 'none');
    picker.addEventListener('click', (e) => e.stopPropagation());
  }

  buildEmojiGrid() {
    const grid = document.querySelector('.emoji-grid'); if (!grid) return;
    grid.innerHTML = '';
    for (const [category, emojis] of Object.entries(this.emojiCategories)) {
      const catDiv = document.createElement('div');
      catDiv.className = 'emoji-category';
      catDiv.innerHTML = `<div class="emoji-cat-title">${category}</div>`;
      const emojiRow = document.createElement('div');
      emojiRow.className = 'emoji-cat-grid';
      emojis.forEach(e => {
        const s = document.createElement('span');
        s.textContent = e;
        s.addEventListener('click', () => {
          document.getElementById('message-input').value += e;
          document.getElementById('message-input').focus();
        });
        emojiRow.appendChild(s);
      });
      catDiv.appendChild(emojiRow);
      grid.appendChild(catDiv);
    }
  }

  bindFileUpload() {
    document.getElementById('btn-attach').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('file-input').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append('file', f);
      try {
        const r = await fetch('/upload', { method: 'POST', body: fd });
        const fi = await r.json();
        this.socket.emit('message:send', { type: f.type.startsWith('image/') ? 'image' : 'file', content: '', room: this.currentRoom, sendSound: this.selectedSound, file: fi });
      } catch (e) { this.showNotification('Ошибка загрузки'); }
      e.target.value = '';
    });
    document.getElementById('avatar-file-input')?.addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (!f.type.startsWith('image/')) { this.showNotification('Выберите изображение'); return; }
      this.uploadAvatar(f); e.target.value = '';
    });
  }

  // ==================== REPLY / TYPING / UTILS ====================
  setReply(id, content) {
    this.replyingTo = { id, content: content || '' };
    document.getElementById('reply-preview').style.display = 'flex';
    document.getElementById('reply-text').textContent = (content || '').substring(0, 50);
    document.getElementById('message-input').focus();
  }

  cancelReply() {
    this.replyingTo = null;
    document.getElementById('reply-preview').style.display = 'none';
  }

  emitTyping() {
    if (!this.socket) return;
    this.socket.emit('typing:start', { room: this.currentRoom });
    clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => this.socket.emit('typing:stop', { room: this.currentRoom }), 2000);
  }

  scrollToBottom() {
    const c = document.getElementById('messages-container');
    setTimeout(() => c.scrollTop = c.scrollHeight, 50);
  }

  escapeHTML(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

  formatSize(b) {
    if (b < 1024) return b + ' Б';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' КБ';
    return (b / 1048576).toFixed(1) + ' МБ';
  }

  // ==================== VIDEO CIRCLES ====================
  startVideoCircle() {
    if (!navigator.mediaDevices?.getUserMedia) return alert('Видео не поддерживается');
    const modal = document.getElementById('modal-video-circle');
    const video = document.getElementById('video-circle-preview');
    modal.style.display = 'flex';
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 360, height: 360 }, audio: true })
      .then(stream => {
        this._vcStream = stream;
        video.srcObject = stream;
        video.style.borderRadius = '50%';
        video.play();
        this._vcRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
        this._vcChunks = [];
        this._vcRecorder.ondataavailable = e => this._vcChunks.push(e.data);
        this._vcRecorder.start();
        this._vcTimer = setInterval(() => {
          const t = document.getElementById('vc-timer');
          if (t) {
            const s = parseInt(t.textContent) + 1;
            t.textContent = s;
            if (s >= 15) this.stopVideoCircle();
          }
        }, 1000);
      })
      .catch(() => alert('Нет доступа к камере'));
  }

  stopVideoCircle() {
    clearInterval(this._vcTimer);
    if (this._vcRecorder && this._vcRecorder.state !== 'inactive') {
      this._vcRecorder.onstop = async () => {
        const blob = new Blob(this._vcChunks, { type: 'video/webm' });
        const fd = new FormData();
        fd.append('file', blob, `vc-${Date.now()}.webm`);
        try {
          const r = await fetch('/upload', { method: 'POST', body: fd });
          const fi = await r.json();
          this.socket.emit('message:send', {
            type: 'video_circle', content: 'Видеокружок',
            room: this.currentRoom, sendSound: this.selectedSound, file: fi
          });
        } catch (e) { console.error('VC upload error:', e); }
        this.closeVideoCircle();
      };
      this._vcRecorder.stop();
    } else {
      this.closeVideoCircle();
    }
  }

  closeVideoCircle() {
    if (this._vcStream) this._vcStream.getTracks().forEach(t => t.stop());
    this._vcStream = null;
    this._vcRecorder = null;
    this._vcChunks = null;
    document.getElementById('modal-video-circle').style.display = 'none';
    document.getElementById('vc-timer').textContent = '0';
  }

  // ==================== WEBRTC CALLS ====================
  startCall(callee, type = 'audio') {
    if (!this.socket) return;
    this.socket.emit('call:start', { callee, callType: type });
    this._callType = type;
    document.getElementById('modal-call').style.display = 'flex';
    document.getElementById('call-status').textContent = 'Звоним...';
  }

  async answerCall(data) {
    this._currentCall = data.callId;
    this._callType = data.type;
    this._callPeer = data.caller;
    document.getElementById('modal-call').style.display = 'flex';
    document.getElementById('call-status').textContent = 'Соединяем...';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true, video: data.type === 'video'
      });
      this._localStream = stream;
      const localVideo = document.getElementById('call-local-video');
      if (localVideo) localVideo.srcObject = stream;
      this._pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      stream.getTracks().forEach(t => this._pc.addTrack(t, stream));
      this._pc.onicecandidate = e => {
        if (e.candidate && this.socket) {
          this.socket.emit('call:signal', { callId: data.callId, signal: { type: 'candidate', candidate: e.candidate } });
        }
      };
      this._pc.ontrack = e => {
        const remoteVideo = document.getElementById('call-remote-video');
        if (remoteVideo) remoteVideo.srcObject = e.streams[0];
      };
      const offer = await this._pc.createOffer();
      await this._pc.setLocalDescription(offer);
      this.socket.emit('call:signal', { callId: data.callId, signal: { type: 'offer', sdp: offer } });
      this.socket.emit('call:accept', { callId: data.callId });
    } catch (e) { console.error('Answer error:', e); }
  }

  async handleCallSignal(data) {
    if (!this._pc) {
      if (data.signal.type === 'offer') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true, video: this._callType === 'video'
          });
          this._localStream = stream;
          this._pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
          stream.getTracks().forEach(t => this._pc.addTrack(t, stream));
          this._pc.onicecandidate = e => {
            if (e.candidate && this.socket) {
              this.socket.emit('call:signal', { callId: data.callId, signal: { type: 'candidate', candidate: e.candidate } });
            }
          };
          this._pc.ontrack = e => {
            const remoteVideo = document.getElementById('call-remote-video');
            if (remoteVideo) remoteVideo.srcObject = e.streams[0];
          };
          await this._pc.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
          const answer = await this._pc.createAnswer();
          await this._pc.setLocalDescription(answer);
          this.socket.emit('call:signal', { callId: data.callId, signal: { type: 'answer', sdp: answer } });
        } catch (e) { console.error('Handle offer error:', e); }
      }
      return;
    }
    if (data.signal.type === 'answer' && this._pc.currentRemoteDescription === null) {
      try {
        await this._pc.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
      } catch (e) { console.error('Set answer error:', e); }
    } else if (data.signal.type === 'candidate' && data.signal.candidate) {
      try {
        await this._pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
      } catch (e) {}
    }
  }

  endCall() {
    if (this._currentCall && this.socket) {
      this.socket.emit('call:end', { callId: this._currentCall });
    }
    this._cleanupCall();
  }

  _cleanupCall() {
    if (this._pc) { this._pc.close(); this._pc = null; }
    if (this._localStream) { this._localStream.getTracks().forEach(t => t.stop()); this._localStream = null; }
    this._currentCall = null;
    this._callPeer = null;
    document.getElementById('modal-call').style.display = 'none';
    document.getElementById('call-status').textContent = 'Звонок завершён';
  }

  // ==================== DEVICE SYNC ====================
  registerDevice() {
    let deviceId = localStorage.getItem('hb-device-id');
    if (!deviceId) {
      deviceId = 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('hb-device-id', deviceId);
    }
    if (this.socket) {
      this.socket.emit('device:register', { deviceId, platform: 'web' });
      // Request sync after a brief delay to let user:joined complete
      setTimeout(() => {
        this.socket.emit('sync:request', { deviceId, since: new Date(Date.now() - 86400000).toISOString() });
      }, 2000);
    }
  }

  // ==================== FEATURE SOCKET BINDINGS ====================
  _bindFeatureSockets() {
    if (!this.socket) return;

    this.socket.on('sync:messages', (data) => {
      const syncMsgs = data.messages || [];
      if (syncMsgs.length > 0) {
        syncMsgs.forEach(m => {
          if (!this.messagesCache.has(m.room)) this.messagesCache.set(m.room, []);
          const existing = this.messagesCache.get(m.room);
          if (!existing.find(e => e.messageId === m.messageId)) {
            existing.push(m);
          }
        });
        if (this.messagesCache.has(this.currentRoom)) {
          document.getElementById('messages-list').innerHTML = '';
          this.messagesCache.get(this.currentRoom).forEach(m => this.renderMessage(m));
          this.scrollToBottom();
        }
      }
    });

    this.socket.on('call:incoming', (data) => {
      if (!confirm(`Входящий ${data.type === 'video' ? 'видео' : 'аудио'}звонок от ${data.callerDisplayName || data.caller}\nПринять?`)) {
        this.socket.emit('call:reject', { callId: data.callId });
        return;
      }
      this._currentCall = data.callId;
      this._callPeer = data.caller;
      this.answerCall(data);
    });
    this.socket.on('call:ringing', () => {
      document.getElementById('call-status').textContent = 'Звонок...';
    });
    this.socket.on('call:accepted', async (data) => {
      document.getElementById('call-status').textContent = 'Соединено';
    });
    this.socket.on('call:rejected', () => {
      document.getElementById('call-status').textContent = 'Отклонено';
      setTimeout(() => this._cleanupCall(), 2000);
    });
    this.socket.on('call:ended', () => {
      document.getElementById('call-status').textContent = 'Завершён';
      setTimeout(() => this._cleanupCall(), 2000);
    });
    this.socket.on('call:error', (data) => {
      alert(data.text);
      this._cleanupCall();
    });
    this.socket.on('call:signal', (data) => this.handleCallSignal(data));
  }
}

const app = new HelloBro();
