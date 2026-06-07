const express = require('express');
const { getDb } = require('../db');
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

router.get('/status', authMiddleware, async (req, res) => {
  const db = await getDb();
  const activeUsers = rowToObject(db.exec('SELECT COUNT(*) as cnt FROM users WHERE is_online = 1'));
  return res.json({
    success: true,
    data: {
      status: 'ok',
      active_users: activeUsers ? activeUsers.cnt : 0,
      server_time: new Date().toISOString(),
      version: '1.0.0',
    }
  });
});

module.exports = router;
