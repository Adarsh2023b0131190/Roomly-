require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const roomRoutes = require('./routes/rooms');
const searchRoutes = require('./routes/search');
const Room = require('./models/Room');
const Message = require('./models/Message');

const app = express();
const PORT = process.env.PORT || 5000;

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

app.use(
  cors({
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
  })
);

app.use(express.json());

app.use('/api/rooms', roomRoutes);
app.use('/api/search', searchRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'server is up',
  });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
  },
});

// roomCode -> Map(socketId -> displayName)
const roomParticipants = new Map();

function getParticipantNames(roomCode) {
  const room = roomParticipants.get(roomCode);
  return room ? Array.from(room.values()) : [];
}

io.on('connection', (socket) => {
  console.log('client connected:', socket.id);

  socket.on('join-room', (roomCode) => {
    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    console.log(`${socket.id} joined room ${roomCode}`);
  });

  socket.on('set-name', ({ roomCode, name }) => {
    socket.data.displayName = name;

    if (!roomParticipants.has(roomCode)) {
      roomParticipants.set(roomCode, new Map());
    }

    roomParticipants.get(roomCode).set(socket.id, name);

    socket.to(roomCode).emit('user-joined', name);
    io.to(roomCode).emit(
      'participant-list',
      getParticipantNames(roomCode)
    );
  });

  socket.on('load-video', async ({ roomCode, videoId }) => {
    try {
      await Room.findOneAndUpdate(
        { roomCode },
        {
          currentVideoId: videoId,
          isPlaying: false,
          currentTime: 0,
        }
      );

      socket.to(roomCode).emit('load-video', videoId);
    } catch (err) {
      console.error('load-video failed:', err.message);
    }
  });

  socket.on('video-play', async ({ roomCode, currentTime }) => {
    try {
      await Room.findOneAndUpdate(
        { roomCode },
        {
          isPlaying: true,
          currentTime,
        }
      );

      socket.to(roomCode).emit('video-play', currentTime);
    } catch (err) {
      console.error('video-play failed:', err.message);
    }
  });

  socket.on('video-pause', async ({ roomCode, currentTime }) => {
    try {
      await Room.findOneAndUpdate(
        { roomCode },
        {
          isPlaying: false,
          currentTime,
        }
      );

      socket.to(roomCode).emit('video-pause', currentTime);
    } catch (err) {
      console.error('video-pause failed:', err.message);
    }
  });

  socket.on('video-seek', async ({ roomCode, currentTime }) => {
    try {
      await Room.findOneAndUpdate(
        { roomCode },
        { currentTime }
      );

      socket.to(roomCode).emit('video-seek', currentTime);
    } catch (err) {
      console.error('video-seek failed:', err.message);
    }
  });

  socket.on('send-message', async ({ roomCode, sender, text }) => {
    if (!text || !text.trim()) return;

    try {
      const message = await Message.create({
        roomCode,
        sender: sender || 'anonymous',
        text: text.trim(),
      });

      // Sender ko bhi message milega
      io.to(roomCode).emit('new-message', message);
    } catch (err) {
      console.error('send-message failed:', err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log('client disconnected:', socket.id);

    const { roomCode, displayName } = socket.data;

    if (roomCode && roomParticipants.has(roomCode)) {
      roomParticipants.get(roomCode).delete(socket.id);

      if (displayName) {
        socket.to(roomCode).emit(
          'user-left',
          displayName
        );
      }

      io.to(roomCode).emit(
        'participant-list',
        getParticipantNames(roomCode)
      );

      // Empty room ko memory se hata do
      if (roomParticipants.get(roomCode).size === 0) {
        roomParticipants.delete(roomCode);
      }
    }
  });
});

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('mongo connected');

    server.listen(PORT, () => {
      console.log(`server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('mongo connection failed:', err.message);
    process.exit(1);
  });