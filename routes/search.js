const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  const { q } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'search query is required' });
  }

  try {
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      maxResults: '8',
      q: q.trim(),
      key: process.env.YOUTUBE_API_KEY,
    });

    const ytRes = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const data = await ytRes.json();

    if (!ytRes.ok) {
      console.error('youtube api error:', data);
      return res.status(502).json({ error: 'youtube search failed' });
    }

    const results = data.items.map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium.url,
    }));

    res.json(results);
  } catch (err) {
    console.error('search failed:', err.message);
    res.status(500).json({ error: 'something went wrong' });
  }
});

module.exports = router;