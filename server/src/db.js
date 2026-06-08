const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'hello_bro.db');

let db = null;

async function getDb() {
  if (db) return db;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');

  initSchema();
  seedData();
  saveDb();

  return db;
}

function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// ВАЖНО: `db.export()` внутри sql.js сбрасывает внутренний `last_insert_rowid()` в 0.
// Поэтому в обработчиках, где нужно сразу узнать ID свежевставленной записи,
// ОБЯЗАТЕЛЬНО делайте SELECT last_insert_rowid() ДО вызова saveDb():
//   db.run('INSERT ...');
//   const id = rowToObject(db.exec('SELECT last_insert_rowid() as id')).id;
//   saveDb();  // после захвата id
function lastInsertId() {
  const r = db.exec('SELECT last_insert_rowid() as id');
  if (!r || r.length === 0 || r[0].values.length === 0) return null;
  return r[0].values[0][0];
}

// dbExecBind: SELECT-эквивалент db.exec() с поддержкой bind-параметров.
// В sql.js `db.exec()` МОЛЧА ИГНОРИРУЕТ объект `{ bind: [...] }` (в отличие от
// better-sqlite3). Для параметризованных SELECT'ов нужно использовать prepared
// statements: prepare → bind → step → getAsObject → free.
// Эта функция возвращает результат в формате, совместимом с `db.exec()`:
//   [{ columns: [...], values: [[...], [...]] }] — чтобы существующий код
//   `rowToObject(dbExecBind(...))` и `rowsToArray(dbExecBind(...))` работал без
//   изменений.
// При params = []/null/undefined просто делегирует в `db.exec()`.
function dbExecBind(sql, params) {
  if (!params || (Array.isArray(params) && params.length === 0)) {
    return db.exec(sql);
  }
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    let columns = null;
    const values = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (columns === null) columns = Object.keys(row);
      values.push(columns.map(c => row[c]));
    }
    if (columns === null) return [];
    return [{ columns, values }];
  } finally {
    stmt.free();
  }
}

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      profile_picture TEXT,
      is_online INTEGER DEFAULT 0,
      last_seen TEXT,
      hide_last_seen INTEGER DEFAULT 0,
      hide_phone INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      is_moderator INTEGER DEFAULT 0,
      is_blocked INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      notification_settings TEXT DEFAULT '{}',
      auto_reply_settings TEXT DEFAULT '{}',
      story_visibility TEXT DEFAULT '{}',
      panic_mode_triggered INTEGER DEFAULT 0,
      last_activity TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('private','group','channel')),
      name TEXT,
      description TEXT,
      avatar TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS chat_participants (
      chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (chat_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS chat_invite_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
      link TEXT UNIQUE NOT NULL,
      created_by INTEGER REFERENCES users(id),
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
      sender_id INTEGER REFERENCES users(id),
      message_type TEXT NOT NULL DEFAULT 'text',
      content TEXT,
      encrypted_content TEXT,
      session_key TEXT,
      media_url TEXT,
      sticker_id TEXT,
      duration INTEGER,
      reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      forwarded_from_chat_id INTEGER REFERENCES chats(id) ON DELETE SET NULL,
      forwarded_from_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      forwarded_from_name TEXT,
      is_deleted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      edited_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS message_status (
      message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','delivered','read')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (message_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(message_id, user_id, emoji)
    )
  `);

  runMigrations();

  db.run(`
    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caller_id INTEGER REFERENCES users(id),
      callee_id INTEGER REFERENCES users(id),
      call_type TEXT NOT NULL CHECK(call_type IN ('audio','video')),
      status TEXT NOT NULL DEFAULT 'missed' CHECK(status IN ('active','ringing','ended','missed','rejected')),
      started_at TEXT,
      ended_at TEXT,
      duration INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  const callCols = db.exec("PRAGMA table_info(calls)");
  const callColNames = callCols.length > 0 ? callCols[0].values.map(r => r[1]) : [];
  const callMigrations = [
    { name: 'chat_id', sql: "ALTER TABLE calls ADD COLUMN chat_id INTEGER REFERENCES chats(id) ON DELETE SET NULL" },
    { name: 'is_group_call', sql: "ALTER TABLE calls ADD COLUMN is_group_call INTEGER DEFAULT 0" },
    { name: 'push_to_talk_active', sql: "ALTER TABLE calls ADD COLUMN push_to_talk_active INTEGER DEFAULT 0" },
  ];
  for (const m of callMigrations) {
    if (!callColNames.includes(m.name)) {
      try { db.run(m.sql); console.log(`✅ Migration applied: calls.${m.name}`); }
      catch (e) { console.warn(`⚠️ Migration failed: calls.${m.name}: ${e.message}`); }
    }
  }

  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS call_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        call_id INTEGER REFERENCES calls(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        joined_at TEXT DEFAULT (datetime('now','localtime')),
        left_at TEXT,
        was_missed INTEGER DEFAULT 0,
        UNIQUE(call_id, user_id)
      )
    `);
  } catch (e) { console.warn(`⚠️ Table failed: call_participants: ${e.message}`); }

  try { db.run('CREATE INDEX IF NOT EXISTS idx_call_participants_call ON call_participants(call_id)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_call_participants_call: ${e.message}`); }
  try { db.run('CREATE INDEX IF NOT EXISTS idx_call_participants_user ON call_participants(user_id)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_call_participants_user: ${e.message}`); }
  try { db.run('CREATE INDEX IF NOT EXISTS idx_calls_user ON calls(caller_id, callee_id, created_at)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_calls_user: ${e.message}`); }

  db.run(`
    CREATE TABLE IF NOT EXISTS stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      story_type TEXT NOT NULL CHECK(story_type IN ('photo','video')),
      content_url TEXT NOT NULL,
      duration INTEGER DEFAULT 24,
      visibility_settings TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      expires_at TEXT DEFAULT (datetime('now','+24 hours','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS story_views (
      story_id INTEGER REFERENCES stories(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      viewed_at TEXT DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (story_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(sender_id, receiver_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS friends (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      friend_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (user_id, friend_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS blacklist (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (user_id, blocked_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS violation_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER REFERENCES users(id),
      target_id INTEGER REFERENCES users(id),
      chat_id INTEGER REFERENCES chats(id),
      message_id INTEGER REFERENCES messages(id),
      reason TEXT,
      description TEXT,
      screenshots TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT,
      type TEXT DEFAULT 'info',
      data TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);
}

function seedData() {
  const count = db.exec('SELECT COUNT(*) as cnt FROM users');
  if (count.length > 0 && count[0].values.length > 0 && count[0].values[0][0] > 0) return;

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  db.run('INSERT INTO users (phone, username, display_name, is_admin, is_moderator, is_online, last_seen) VALUES (?, ?, ?, ?, ?, 0, ?)',
    ['+79990000001', '@hello_bro_admin', 'Hello Bro Admin', 1, 0, now]);

  db.run('INSERT INTO users (phone, username, display_name, is_admin, is_moderator, is_online, last_seen) VALUES (?, ?, ?, ?, ?, 0, ?)',
    ['+79990000002', '@hello_bro_moder', 'Hello Bro Moder', 0, 1, now]);

  console.log('✅ Seed data inserted (admin/moderator users)');
}

function runMigrations() {
  const msgCols = db.exec("PRAGMA table_info(messages)");
  const msgColNames = msgCols.length > 0 ? msgCols[0].values.map(r => r[1]) : [];
  const msgMigrations = [
    { name: 'reply_to', sql: "ALTER TABLE messages ADD COLUMN reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL" },
    { name: 'forwarded_from_chat_id', sql: "ALTER TABLE messages ADD COLUMN forwarded_from_chat_id INTEGER REFERENCES chats(id) ON DELETE SET NULL" },
    { name: 'forwarded_from_user_id', sql: "ALTER TABLE messages ADD COLUMN forwarded_from_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL" },
    { name: 'forwarded_from_name', sql: "ALTER TABLE messages ADD COLUMN forwarded_from_name TEXT" },
    { name: 'is_deleted', sql: "ALTER TABLE messages ADD COLUMN is_deleted INTEGER DEFAULT 0" },
  ];
  for (const m of msgMigrations) {
    if (!msgColNames.includes(m.name)) {
      try { db.run(m.sql); console.log(`✅ Migration applied: messages.${m.name}`); }
      catch (e) { console.warn(`⚠️ Migration failed: messages.${m.name}: ${e.message}`); }
    }
  }

  const chatCols = db.exec("PRAGMA table_info(chats)");
  const chatColNames = chatCols.length > 0 ? chatCols[0].values.map(r => r[1]) : [];
  const chatMigrations = [
    { name: 'pinned_message_id', sql: "ALTER TABLE chats ADD COLUMN pinned_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL" },
    { name: 'invite_link', sql: "ALTER TABLE chats ADD COLUMN invite_link TEXT" },
    { name: 'invite_link_expires_at', sql: "ALTER TABLE chats ADD COLUMN invite_link_expires_at TEXT" },
  ];
  for (const m of chatMigrations) {
    if (!chatColNames.includes(m.name)) {
      try { db.run(m.sql); console.log(`✅ Migration applied: chats.${m.name}`); }
      catch (e) { console.warn(`⚠️ Migration failed: chats.${m.name}: ${e.message}`); }
    }
  }

  const cpCols = db.exec("PRAGMA table_info(chat_participants)");
  const cpColNames = cpCols.length > 0 ? cpCols[0].values.map(r => r[1]) : [];
  const cpMigrations = [
    { name: 'role', sql: "ALTER TABLE chat_participants ADD COLUMN role TEXT DEFAULT 'member'" },
    { name: 'joined_by', sql: "ALTER TABLE chat_participants ADD COLUMN joined_by INTEGER REFERENCES users(id) ON DELETE SET NULL" },
    { name: 'can_send_messages', sql: "ALTER TABLE chat_participants ADD COLUMN can_send_messages INTEGER DEFAULT 1" },
    { name: 'can_add_members', sql: "ALTER TABLE chat_participants ADD COLUMN can_add_members INTEGER DEFAULT 0" },
    { name: 'is_archived', sql: "ALTER TABLE chat_participants ADD COLUMN is_archived INTEGER DEFAULT 0" },
    { name: 'is_muted', sql: "ALTER TABLE chat_participants ADD COLUMN is_muted INTEGER DEFAULT 0" },
  ];
  for (const m of cpMigrations) {
    if (!cpColNames.includes(m.name)) {
      try { db.run(m.sql); console.log(`✅ Migration applied: chat_participants.${m.name}`); }
      catch (e) { console.warn(`⚠️ Migration failed: chat_participants.${m.name}: ${e.message}`); }
    }
  }

  const chatTypeCols = db.exec("PRAGMA table_info(chats)");
  const chatTypeColNames = chatTypeCols.length > 0 ? chatTypeCols[0].values.map(r => r[1]) : [];
  if (!chatTypeColNames.includes('is_saved')) {
    try { db.run("ALTER TABLE chats ADD COLUMN is_saved INTEGER DEFAULT 0"); console.log('✅ Migration applied: chats.is_saved'); }
    catch (e) { console.warn(`⚠️ Migration failed: chats.is_saved: ${e.message}`); }
  }

  try { db.run('CREATE INDEX IF NOT EXISTS idx_messages_content ON messages(content)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_messages_content: ${e.message}`); }
  try { db.run('CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_messages_chat_id: ${e.message}`); }
  try { db.run('CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_chat_participants_user: ${e.message}`); }
  try { db.run('CREATE INDEX IF NOT EXISTS idx_chats_name ON chats(name)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_chats_name: ${e.message}`); }

  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE(user_id, message_id)
      )
    `);
  } catch (e) { console.warn(`⚠️ Table failed: bookmarks: ${e.message}`); }

  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS scheduled_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        message_type TEXT NOT NULL DEFAULT 'text',
        content TEXT,
        media_url TEXT,
        reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL,
        send_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','cancelled','failed')),
        sent_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);
  } catch (e) { console.warn(`⚠️ Table failed: scheduled_messages: ${e.message}`); }

  try { db.run('CREATE INDEX IF NOT EXISTS idx_scheduled_pending ON scheduled_messages(status, send_at)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_scheduled_pending: ${e.message}`); }
  try { db.run('CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_bookmarks_user: ${e.message}`); }

  // Security (этап 6)
  const userCols2 = db.exec("PRAGMA table_info(users)");
  const userColNames2 = userCols2.length > 0 ? userCols2[0].values.map(r => r[1]) : [];
  const userSecMigrations = [
    { name: 'totp_secret', sql: "ALTER TABLE users ADD COLUMN totp_secret TEXT" },
    { name: 'twofa_enabled', sql: "ALTER TABLE users ADD COLUMN twofa_enabled INTEGER DEFAULT 0" },
  ];
  for (const m of userSecMigrations) {
    if (!userColNames2.includes(m.name)) {
      try { db.run(m.sql); console.log(`✅ Migration applied: users.${m.name}`); }
      catch (e) { console.warn(`⚠️ Migration failed: users.${m.name}: ${e.message}`); }
    }
  }

  const msgCols2 = db.exec("PRAGMA table_info(messages)");
  const msgColNames2 = msgCols2.length > 0 ? msgCols2[0].values.map(r => r[1]) : [];
  if (!msgColNames2.includes('expires_at')) {
    try { db.run("ALTER TABLE messages ADD COLUMN expires_at TEXT"); console.log('✅ Migration applied: messages.expires_at'); }
    catch (e) { console.warn(`⚠️ Migration failed: messages.expires_at: ${e.message}`); }
  }

  try { db.run('CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages(expires_at)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_messages_expires_at: ${e.message}`); }

  // Этап 7 — Стикерпаки
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS sticker_packs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        author_id INTEGER REFERENCES users(id),
        cover_url TEXT,
        is_premium INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);
    console.log('✅ Table created: sticker_packs');
  } catch (e) { console.warn(`⚠️ Table failed: sticker_packs: ${e.message}`); }

  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS stickers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pack_id INTEGER REFERENCES sticker_packs(id) ON DELETE CASCADE,
        file_url TEXT NOT NULL,
        emoji TEXT DEFAULT '😀',
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);
    console.log('✅ Table created: stickers');
  } catch (e) { console.warn(`⚠️ Table failed: stickers: ${e.message}`); }

  try { db.run('CREATE INDEX IF NOT EXISTS idx_stickers_pack ON stickers(pack_id)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_stickers_pack: ${e.message}`); }

  // Этап 7 — Опросы/голосования
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        multiple_choices INTEGER DEFAULT 0,
        is_anonymous INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);
    console.log('✅ Table created: polls');
  } catch (e) { console.warn(`⚠️ Table failed: polls: ${e.message}`); }

  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS poll_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id INTEGER REFERENCES polls(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);
    console.log('✅ Table created: poll_options');
  } catch (e) { console.warn(`⚠️ Table failed: poll_options: ${e.message}`); }

  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS poll_votes (
        poll_id INTEGER REFERENCES polls(id) ON DELETE CASCADE,
        option_id INTEGER REFERENCES poll_options(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE(poll_id, option_id, user_id)
      )
    `);
    console.log('✅ Table created: poll_votes');
  } catch (e) { console.warn(`⚠️ Table failed: poll_votes: ${e.message}`); }

  try { db.run('CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_poll_votes_poll: ${e.message}`); }
  try { db.run('CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_poll_options_poll: ${e.message}`); }

  // === Модерация: таблицы нарушений и расшифрованных сообщений ===
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS violations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        description TEXT,
        source TEXT DEFAULT 'auto' CHECK(source IN ('auto','user_report','keyword')),
        status TEXT DEFAULT 'open' CHECK(status IN ('open','warned','immune','banned','resolved')),
        auto_decrypted INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        resolved_by INTEGER REFERENCES users(id),
        resolved_at TEXT
      )
    `);
    console.log('✅ Table created: violations');
  } catch (e) { console.warn(`⚠️ Table failed: violations: ${e.message}`); }

  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS violation_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        violation_id INTEGER REFERENCES violations(id) ON DELETE CASCADE,
        message_id INTEGER,
        sender_id INTEGER REFERENCES users(id),
        sender_name TEXT,
        sender_avatar TEXT,
        content TEXT,
        message_type TEXT DEFAULT 'text',
        media_url TEXT,
        created_at TEXT,
        is_from_violator INTEGER DEFAULT 0,
        UNIQUE(violation_id, message_id)
      )
    `);
    console.log('✅ Table created: violation_messages');
  } catch (e) { console.warn(`⚠️ Table failed: violation_messages: ${e.message}`); }

  try { db.run('CREATE INDEX IF NOT EXISTS idx_violations_target ON violations(target_user_id)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_violations_target: ${e.message}`); }
  try { db.run('CREATE INDEX IF NOT EXISTS idx_violations_status ON violations(status)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_violations_status: ${e.message}`); }
  try { db.run('CREATE INDEX IF NOT EXISTS idx_violation_messages_violation ON violation_messages(violation_id)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_violation_messages_violation: ${e.message}`); }

  // === Таблица правил модерации (ключевые слова, паттерны) ===
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS moderation_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL UNIQUE,
        category TEXT DEFAULT 'general',
        severity INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        created_by INTEGER REFERENCES users(id)
      )
    `);
    console.log('✅ Table created: moderation_rules');
  } catch (e) { console.warn(`⚠️ Table failed: moderation_rules: ${e.message}`); }

  // === Таблица шаблонов рассылок ===
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS broadcast_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);
    console.log('✅ Table created: broadcast_templates');
  } catch (e) { console.warn(`⚠️ Table failed: broadcast_templates: ${e.message}`); }

  // === Таблица логов действий персонала ===
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS staff_action_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER REFERENCES users(id),
        action TEXT NOT NULL,
        target_type TEXT,
        target_id INTEGER,
        details TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);
    console.log('✅ Table created: staff_action_log');
  } catch (e) { console.warn(`⚠️ Table failed: staff_action_log: ${e.message}`); }

  try { db.run('CREATE INDEX IF NOT EXISTS idx_staff_log_staff ON staff_action_log(staff_id)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_staff_log_staff: ${e.message}`); }
  try { db.run('CREATE INDEX IF NOT EXISTS idx_staff_log_action ON staff_action_log(action)'); }
  catch (e) { console.warn(`⚠️ Index failed: idx_staff_log_action: ${e.message}`); }

  // === Миграции: is_operation_manager, is_immune для users ===
  const userCols3 = db.exec("PRAGMA table_info(users)");
  const userColNames3 = userCols3.length > 0 ? userCols3[0].values.map(r => r[1]) : [];
  const userModMigrations = [
    { name: 'is_operation_manager', sql: "ALTER TABLE users ADD COLUMN is_operation_manager INTEGER DEFAULT 0" },
    { name: 'is_immune', sql: "ALTER TABLE users ADD COLUMN is_immune INTEGER DEFAULT 0" },
    { name: 'recovery_code', sql: "ALTER TABLE users ADD COLUMN recovery_code TEXT" },
    { name: 'recovery_code_expires', sql: "ALTER TABLE users ADD COLUMN recovery_code_expires TEXT" },
    { name: 'password_hash', sql: "ALTER TABLE users ADD COLUMN password_hash TEXT" },
  ];
  for (const m of userModMigrations) {
    if (!userColNames3.includes(m.name)) {
      try { db.run(m.sql); console.log(`✅ Migration applied: users.${m.name}`); }
      catch (e) { console.warn(`⚠️ Migration failed: users.${m.name}: ${e.message}`); }
    }
  }

  // Seed default moderation rules (запрещённый в РФ контент)
  const ruleCount = db.exec('SELECT COUNT(*) as cnt FROM moderation_rules');
  if (ruleCount.length > 0 && ruleCount[0].values.length > 0 && ruleCount[0].values[0][0] === 0) {
    const defaultRules = [
      // Экстремизм и терроризм
      ['экстремизм', 'extremism', 1], ['терроризм', 'terrorism', 1], ['теракт', 'terror_act', 1],
      ['взрывчатк', 'explosives', 1], ['оружие массов', 'weapons_mass', 1],
      // Наркотики
      ['наркотик', 'drugs', 2], ['наркота', 'drugs_slang', 2], ['мефедрон', 'drugs', 2],
      ['соль для ванн', 'drugs', 2], ['спайс', 'drugs', 2], ['закладк', 'drug_hide', 2],
      ['куплю соль', 'drugs', 2], ['кладмен', 'drug_dealer', 2],
      // Пропаганда нетрадиционных отношений (среди несовершеннолетних)
      ['лгбт пропаганд', 'lgbt_propaganda', 3], ['гей пропаганд', 'lgbt_propaganda', 3],
      ['нетрадицион отношен', 'lgbt_propaganda', 3],
      // Призывы к санкциям
      ['санкци', 'sanctions', 3], ['призыв к санкци', 'call_sanctions', 3],
      // Дискредитация власти
      ['дискредитац', 'discredit', 3], ['фейк о власти', 'fake_government', 3],
      ['недостоверн информац', 'fake_news', 3],
      // Суицид
      ['суицид', 'suicide', 2], ['способы самоубийств', 'suicide_methods', 2],
      ['как покончить с собой', 'suicide', 2],
      // Детская безопасность
      ['детска порнограф', 'child_safety', 1], ['педофил', 'child_safety', 1],
      // Оскорбление государственных символов
      ['оскорбление герб', 'state_symbols', 3], ['оскорбление флаг', 'state_symbols', 3],
      ['оскорбление гимн', 'state_symbols', 3],
      // Разжигание ненависти
      ['разжиган ненавист', 'hate_speech', 1], ['межнациональн розн', 'hate_speech', 1],
      ['нацизм', 'nazism', 1], ['превосходств', 'supremacy', 1],
    ];
    for (const r of defaultRules) {
      try {
        db.run('INSERT OR IGNORE INTO moderation_rules (pattern, category, severity) VALUES (?, ?, ?)', r);
      } catch (e) {}
    }
    console.log(`✅ Seeded ${defaultRules.length} moderation rules`);
  }

  // Seed operation manager user
  const opManCount = db.exec("SELECT COUNT(*) as cnt FROM users WHERE username = '@hello_bro_ops'");
  if (opManCount.length > 0 && opManCount[0].values.length > 0 && opManCount[0].values[0][0] === 0) {
    const now = new Date().toISOString().replace('T', ' ').split('.')[0];
    db.run('INSERT INTO users (phone, username, display_name, is_operation_manager, is_online, last_seen) VALUES (?, ?, ?, ?, 0, ?)',
      ['+79990000003', '@hello_bro_ops', 'Hello Bro Ops', 1, now]);
    console.log('✅ Seed data inserted (operation manager user)');
  }

  // Seed broadcast templates
  const tmplCount = db.exec('SELECT COUNT(*) as cnt FROM broadcast_templates');
  if (tmplCount.length > 0 && tmplCount[0].values.length > 0 && tmplCount[0].values[0][0] === 0) {
    const templates = [
      { name: 'Приветствие', title: 'Добро пожаловать в Hello Bro!', body: 'Рады приветствовать вас в нашем мессенджере. Наслаждайтесь безопасным общением!' },
      { name: 'Обновление', title: 'Вышло обновление!', body: 'Установите новую версию Hello Bro для улучшения безопасности и новых функций.' },
      { name: 'Нарушение правил', title: 'Предупреждение о нарушении', body: 'Ваше сообщение было отмечено как потенциальное нарушение правил платформы. Пожалуйста, ознакомьтесь с правилами.' },
    ];
    for (const t of templates) {
      db.run('INSERT INTO broadcast_templates (name, title, body) VALUES (?, ?, ?)', [t.name, t.title, t.body]);
    }
    console.log('✅ Seeded broadcast templates');
  }

  // Seed sticker packs
  const packCount = db.exec('SELECT COUNT(*) as cnt FROM sticker_packs');
  if (packCount.length > 0 && packCount[0].values.length > 0 && packCount[0].values[0][0] === 0) {
    const packEmojis = [
      { name: 'Classic Smiles', emojis: ['😀', '😂', '😊', '🥰', '😎', '🤔', '😴', '🤗', '😍', '😘', '😜', '🤪'] },
      { name: 'Reactions Pack', emojis: ['👍', '👎', '👌', '✌️', '💪', '🔥', '💯', '⭐', '❤️', '💔', '🎉', '✅'] },
      { name: 'Animals', emojis: ['🐶', '🐱', '🐼', '🐨', '🦊', '🐸', '🐵', '🦄', '🐧', '🐝', '🐳', '🦋'] },
      { name: 'Premium Fun', emojis: ['🤩', '🥳', '🎊', '🎉', '🎈', '🎁', '💎', '🌟', '🔥', '🚀', '⭐', '👑'], isPremium: true },
    ];
    for (const pack of packEmojis) {
      if (pack.isPremium) {
        db.run('INSERT INTO sticker_packs (name, author_id, is_premium) VALUES (?, ?, 1)', [pack.name, 1]);
      } else {
        db.run('INSERT INTO sticker_packs (name, author_id) VALUES (?, ?)', [pack.name, 1]);
      }
      const pid = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
      for (const emoji of pack.emojis) {
        db.run('INSERT INTO stickers (pack_id, file_url, emoji) VALUES (?, ?, ?)', [pid, `emoji://${emoji}`, emoji]);
      }
    }
    console.log(`✅ Seeded ${packEmojis.length} sticker packs`);
  }
}

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

function getMessageFull(db, messageId) {
  const result = dbExecBind(`
    SELECT m.*, u.username as sender_username, u.display_name as sender_name
    FROM messages m JOIN users u ON m.sender_id = u.id
    WHERE m.id = ?
  `, [messageId]);
  const msg = rowToObject(result);
  if (!msg) return null;

  const reactionsResult = dbExecBind(`
    SELECT emoji, user_id FROM message_reactions WHERE message_id = ?
  `, [messageId]);
  const reactions = {};
  for (const r of rowsToArray(reactionsResult)) {
    if (!reactions[r.emoji]) reactions[r.emoji] = [];
    reactions[r.emoji].push(r.user_id);
  }
  msg.reactions = reactions;

  if (msg.reply_to) {
    const replyResult = dbExecBind(`
      SELECT m.id, m.sender_id, m.content, m.message_type, u.display_name as sender_name
      FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
    `, [msg.reply_to]);
    msg.reply_to_message = rowToObject(replyResult);
  }

  return msg;
}

function getChatFull(db, chatId, currentUserId) {
  const chatRes = dbExecBind('SELECT * FROM chats WHERE id = ?', [chatId]);
  const chat = rowToObject(chatRes);
  if (!chat) return null;
  if (chat.is_saved == null) chat.is_saved = 0;

  const membersRes = dbExecBind(`
    SELECT u.id, u.username, u.display_name, u.profile_picture, u.is_online, u.last_seen,
      cp.role, cp.joined_at, cp.joined_by, cp.can_send_messages, cp.can_add_members
    FROM chat_participants cp JOIN users u ON cp.user_id = u.id
    WHERE cp.chat_id = ?
    ORDER BY cp.role DESC, cp.joined_at ASC
  `, [chatId]);
  chat.members = rowsToArray(membersRes);
  chat.members_count = chat.members.length;
  chat.member_ids = chat.members.map(m => m.id);
  chat.admin_ids = chat.members.filter(m => m.role === 'owner' || m.role === 'admin').map(m => m.id);

  if (currentUserId) {
    const me = chat.members.find(m => m.id === currentUserId);
    if (me) {
      chat.current_user_role = me.role;
      chat.current_user_can_add_members = !!me.can_add_members;
      chat.current_user_can_send_messages = !!me.can_send_messages;
      chat.is_archived = !!me.is_archived;
      chat.is_muted = !!me.is_muted;
    } else {
      chat.current_user_role = null;
      chat.current_user_can_add_members = false;
      chat.current_user_can_send_messages = false;
      chat.is_archived = false;
      chat.is_muted = false;
    }
  }

  if (chat.pinned_message_id) {
    const pinnedRes = dbExecBind(`
      SELECT m.id, m.sender_id, m.content, m.message_type, m.created_at, m.is_deleted,
        u.display_name as sender_name
      FROM messages m JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `, [chat.pinned_message_id]);
    chat.pinned_message = rowToObject(pinnedRes);
  }

  if (chat.type !== 'private') {
    const lastMsgRes = dbExecBind(`
      SELECT m.id, m.content, m.message_type, m.created_at, m.sender_id,
        u.display_name as sender_name
      FROM messages m JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = ?
      ORDER BY m.created_at DESC LIMIT 1
    `, [chatId]);
    const lastMessage = rowToObject(lastMsgRes);
    if (lastMessage) {
      chat.last_message = lastMessage;
      chat.last_message_time = lastMessage.created_at;
    }
  }

  return chat;
}

function isUserChatAdmin(db, chatId, userId) {
  const res = dbExecBind(
    "SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ? AND role IN ('owner', 'admin')",
    [chatId, userId]
  );
  return res.length > 0 && res[0].values.length > 0;
}

function isUserChatOwner(db, chatId, userId) {
  const res = dbExecBind(
    "SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ? AND role = 'owner'",
    [chatId, userId]
  );
  return res.length > 0 && res[0].values.length > 0;
}

function isUserChatParticipant(db, chatId, userId) {
  const res = dbExecBind(
    'SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?',
    [chatId, userId]
  );
  return res.length > 0 && res[0].values.length > 0;
}

function generateInviteToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

module.exports = {
  getDb,
  saveDb,
  lastInsertId,
  rowToObject,
  rowsToArray,
  getMessageFull,
  getChatFull,
  isUserChatAdmin,
  isUserChatOwner,
  isUserChatParticipant,
  generateInviteToken,
  dbExecBind,
};
