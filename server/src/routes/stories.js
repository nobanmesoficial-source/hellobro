const express = require('express');
const { getDb, saveDb, dbExecBind, lastInsertId } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

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

router.get('/', authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = db.exec(`
    SELECT s.*, u.username, u.display_name, u.profile_picture
    FROM stories s JOIN users u ON s.user_id = u.id
    WHERE s.expires_at > datetime('now','localtime')
    ORDER BY s.created_at DESC
  `);

  const stories = rowsToArray(result);
  const userStories = {};
  for (const s of stories) {
    if (!userStories[s.user_id]) {
      userStories[s.user_id] = {
        user_id: s.user_id,
        username: s.username,
        display_name: s.display_name,
        profile_picture: s.profile_picture,
        stories: [],
      };
    }
    userStories[s.user_id].stories.push({
      id: s.id,
      story_type: s.story_type,
      content_url: s.content_url,
      created_at: s.created_at,
      expires_at: s.expires_at,
    });
  }

  return res.json({ success: true, data: Object.values(userStories) });
});

router.post('/', authMiddleware, async (req, res) => {
  const { story_type, content_file, duration, visibility_settings } = req.body;
  if (!story_type || !content_file) {
    return res.json({ success: false, message: 'Заполните тип и файл' });
  }

  const fs = require('fs');
  const path = require('path');
  const filename = `story_${Date.now()}_${req.user.id}.${story_type === 'video' ? 'mp4' : 'jpg'}`;
  const filepath = path.join(__dirname, '..', '..', 'uploads', filename);
  fs.writeFileSync(filepath, Buffer.from(content_file, 'base64'));

  const db = await getDb();
  db.run(`
    INSERT INTO stories (user_id, story_type, content_url, duration, visibility_settings)
    VALUES (?, ?, ?, ?, ?)
  `, [req.user.id, story_type, '/uploads/' + filename, duration || 24, visibility_settings || '{}']);

  const storyId = lastInsertId();
  saveDb();
  return res.json({ success: true, data: { story_id: storyId } });
});

router.post('/:id/view', authMiddleware, async (req, res) => {
  const db = await getDb();
  db.run('INSERT OR IGNORE INTO story_views (story_id, user_id) VALUES (?, ?)',
    [parseInt(req.params.id), req.user.id]);
  saveDb();
  return res.json({ success: true, data: { message: 'Просмотрено' } });
});

router.get('/:id', authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = dbExecBind(`
    SELECT s.*, u.username, u.display_name FROM stories s JOIN users u ON s.user_id = u.id WHERE s.id = ?
  `, [parseInt(req.params.id)]);
  const story = rowToObject(result);
  if (!story) return res.json({ success: false, message: 'История не найдена' });

  const viewsResult = dbExecBind(`
    SELECT u.id, u.username, u.display_name, sv.viewed_at
    FROM story_views sv JOIN users u ON sv.user_id = u.id
    WHERE sv.story_id = ?
  `, [story.id]);

  return res.json({ success: true, data: { ...story, views: rowsToArray(viewsResult) } });
});

router.delete('/:id', authMiddleware, async (req, res) => {
  const db = await getDb();
  const storyResult = dbExecBind('SELECT * FROM stories WHERE id = ? AND user_id = ?',
    [parseInt(req.params.id), req.user.id]);
  const story = rowToObject(storyResult);
  if (!story) return res.json({ success: false, message: 'История не найдена' });

  db.run('DELETE FROM stories WHERE id = ?', [parseInt(req.params.id)]);
  saveDb();
  return res.json({ success: true, data: { message: 'История удалена' } });
});

module.exports = router;
