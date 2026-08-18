const express = require('express');
const router = express.Router();
const Room = require('../models/Room');
const Message = require('../models/Message');
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// naya room banane ke liye
router.post('/', async (req, res) => {
  const { hostId } = req.body;

  if (!hostId) {
    return res.status(400).json({ error: 'hostId is required' });
  }

  try {
    let roomCode;
    let existing;

    do {
      roomCode = generateRoomCode();
      existing = await Room.findOne({ roomCode });
    } while (existing);

    const room = await Room.create({ roomCode, hostId });

    res.status(201).json(room);
  } catch (err) {
    console.error('failed to create room:', err.message);
    res.status(500).json({ error: 'could not create room' });
  }
});

// GET /api/rooms/:roomCode/messages - last 50 chat messages
// note: ye route /:roomCode route se pehle honi chahiye, warna Express
// "messages" ko galti se roomCode maan lega
router.get('/:roomCode/messages', async (req, res) => {
  try {
    const messages = await Message.find({ roomCode: req.params.roomCode.toUpperCase() })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(messages.reverse());
  } catch (err) {
    console.error('failed to fetch messages:', err.message);
    res.status(500).json({ error: 'could not load messages' });
  }
});

// room join karne ke liye, code se dhundhna
router.get('/:roomCode', async (req, res) => {
  try {
    const room = await Room.findOne({
      roomCode: req.params.roomCode.toUpperCase(),
    });

    if (!room) {
      return res.status(404).json({ error: 'room not found' });
    }

    res.json(room);
  } catch (err) {
    console.error('failed to fetch room:', err.message);
    res.status(500).json({ error: 'something went wrong' });
  }
});

// POST /api/rooms/:roomCode/summary - AI catch-up summary of recent chat
router.post('/:roomCode/summary', async (req, res) => {
  try {
    const roomCode = req.params.roomCode.toUpperCase();

    const recentMessages = await Message.find({ roomCode })
      .sort({ createdAt: -1 })
      .limit(40);

    if (recentMessages.length === 0) {
      return res.json({ summary: "nothing's been said yet in this room." });
    }

    const chatLog = recentMessages
      .reverse()
      .map((m) => `${m.sender}: ${m.text}`)
      .join('\n');

    const completion = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [
        {
          role: 'system',
          content:
            'You summarize group chat conversations for someone who just joined. Keep it short — 2-4 sentences, casual tone, no headers or bullet points. Just tell them what people have been talking about.',
        },
        {
          role: 'user',
          content: chatLog,
        },
      ],
      temperature: 0.5,
      max_tokens: 200,
    });

    const summary = completion.choices[0]?.message?.content?.trim();

    res.json({ summary });
  } catch (err) {
    console.error('summary generation failed:', err.message);
    res.status(500).json({ error: 'could not generate summary' });
  }
});

module.exports = router;