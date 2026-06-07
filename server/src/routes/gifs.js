const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const https = require('https');
const http = require('http');

const router = express.Router();

const GIPHY_API_KEY = process.env.GIPHY_API_KEY || 'GlVGYHkrB1w2Hvk2R0IKEYQtFo3y9kRF';
const GIPHY_API_BASE = 'https://api.giphy.com/v1/gifs';

function giphyFetch(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Failed to parse Giphy response'));
        }
      });
    }).on('error', reject);
  });
}

// GET /api/v1/gifs/search?q=...&limit=...
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const q = req.query.q;
    const limit = parseInt(req.query.limit || 20);
    if (!q || q.trim().length === 0) {
      return res.json({ success: true, data: { gifs: [] } });
    }
    const response = await giphyFetch(
      `${GIPHY_API_BASE}/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q.trim())}&limit=${limit}&rating=g`
    );
    const gifs = (response.data || []).map(g => ({
      id: g.id,
      title: g.title || '',
      url: g.images?.original?.url || '',
      previewUrl: g.images?.fixed_height?.url || '',
      previewWidth: g.images?.fixed_height?.width || 200,
      previewHeight: g.images?.fixed_height?.height || 200,
      width: g.images?.original?.width || 480,
      height: g.images?.original?.height || 480,
    }));
    return res.json({ success: true, data: { gifs } });
  } catch (e) {
    console.error('GIF search error:', e);
    return res.json({ success: false, message: 'Ошибка поиска GIF' });
  }
});

// GET /api/v1/gifs/trending?limit=...
router.get('/trending', authMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || 20);
    const response = await giphyFetch(
      `${GIPHY_API_BASE}/trending?api_key=${GIPHY_API_KEY}&limit=${limit}&rating=g`
    );
    const gifs = (response.data || []).map(g => ({
      id: g.id,
      title: g.title || '',
      url: g.images?.original?.url || '',
      previewUrl: g.images?.fixed_height?.url || '',
      previewWidth: g.images?.fixed_height?.width || 200,
      previewHeight: g.images?.fixed_height?.height || 200,
      width: g.images?.original?.width || 480,
      height: g.images?.original?.height || 480,
    }));
    return res.json({ success: true, data: { gifs } });
  } catch (e) {
    console.error('GIF trending error:', e);
    return res.json({ success: false, message: 'Ошибка загрузки трендов' });
  }
});

module.exports = router;
