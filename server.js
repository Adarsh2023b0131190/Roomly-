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

const CLIENT_URL =
  process.env.CLIENT_URL || 'http://localhost:5173';

/* -------------------- Middleware -------------------- */

app.use(
  cors({
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  })
);

app.use(express.json());

/* -------------------- Routes -------------------- */

app.use('/api/rooms', roomRoutes);
app.use('/api/search', searchRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'server is up',
  });
});

/* -------------------- HTTP + Socket Server -------------------- */

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

/* -------------------- Participants -------------------- */

// roomCode -> Map(socketId -> displayName)
const roomParticipants = new Map();

function getParticipantNames(roomCode) {
  const room = roomParticipants.get(roomCode);

  return room
    ? Array.from(room.values())
    : [];
}

/* -------------------- Socket.IO -------------------- */

io.on('connection', (socket) => {
  console.log('client connected:', socket.id);

  /* ---------- Join Room ---------- */

  socket.on('join-room', (roomCode) => {
    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    console.log(
      `${socket.id} joined room ${roomCode}`
    );
  });

  /* ---------- Set Name ---------- */

  socket.on('set-name', ({ roomCode, name }) => {
    if (!name || !name.trim()) return;

    const displayName = name.trim();

    socket.data.roomCode = roomCode;
    socket.data.displayName = displayName;

    if (!roomParticipants.has(roomCode)) {
      roomParticipants.set(roomCode, new Map());
    }

    roomParticipants
      .get(roomCode)
      .set(socket.id, displayName);

    socket.to(roomCode).emit(
      'user-joined',
      displayName
    );

    io.to(roomCode).emit(
      'participant-list',
      getParticipantNames(roomCode)
    );
  });

  /* ---------- Load Video ---------- */

  socket.on(
    'load-video',
    async ({ roomCode, videoId }) => {
      if (!roomCode || !videoId) return;

      try {
        await Room.findOneAndUpdate(
          { roomCode },
          {
            currentVideoId: videoId,
            isPlaying: false,
            currentTime: 0,
          }
        );

        socket.to(roomCode).emit(
          'load-video',
          videoId
        );
      } catch (err) {
        console.error(
          'load-video failed:',
          err.message
        );
      }
    }
  );

  /* ---------- Video Play ---------- */

  socket.on(
    'video-play',
    async ({ roomCode, currentTime }) => {
      if (!roomCode) return;

      try {
        await Room.findOneAndUpdate(
          { roomCode },
          {
            isPlaying: true,
            currentTime,
          }
        );

        socket.to(roomCode).emit(
          'video-play',
          currentTime
        );
      } catch (err) {
        console.error(
          'video-play failed:',
          err.message
        );
      }
    }
  );

  /* ---------- Video Pause ---------- */

  socket.on(
    'video-pause',
    async ({ roomCode, currentTime }) => {
      if (!roomCode) return;

      try {
        await Room.findOneAndUpdate(
          { roomCode },
          {
            isPlaying: false,
            currentTime,
          }
        );

        socket.to(roomCode).emit(
          'video-pause',
          currentTime
        );
      } catch (err) {
        console.error(
          'video-pause failed:',
          err.message
        );
      }
    }
  );

  /* ---------- Video Seek ---------- */

  socket.on(
    'video-seek',
    async ({ roomCode, currentTime }) => {
      if (!roomCode) return;

      try {
        await Room.findOneAndUpdate(
          { roomCode },
          {
            currentTime,
          }
        );

        socket.to(roomCode).emit(
          'video-seek',
          currentTime
        );
      } catch (err) {
        console.error(
          'video-seek failed:',
          err.message
        );
      }
    }
  );

  /* ---------- Video Ended ---------- */

  socket.on(
    'video-ended',
    async ({ roomCode }) => {
      if (!roomCode) return;

      try {
        await Room.findOneAndUpdate(
          { roomCode },
          {
            isPlaying: false,
            currentTime: 0,
          }
        );

        // Host already ended hai, isliye event
        // baaki clients ko bhejo
        socket.to(roomCode).emit(
          'video-ended'
        );

        console.log(
          `video ended in room ${roomCode}`
        );
      } catch (err) {
        console.error(
          'video-ended failed:',
          err.message
        );
      }
    }
  );

  /* ---------- Chat ---------- */

  socket.on(
    'send-message',
    async ({ roomCode, sender, text }) => {
      if (!roomCode || !text || !text.trim()) {
        return;
      }

      try {
        const message = await Message.create({
          roomCode,
          sender: sender?.trim() || 'anonymous',
          text: text.trim(),
        });

        // Sender + baaki sab users ko message milega
        io.to(roomCode).emit(
          'new-message',
          message
        );
      } catch (err) {
        console.error(
          'send-message failed:',
          err.message
        );
      }
    }
  );

  /* ---------- Disconnect ---------- */

  socket.on('disconnect', () => {
    console.log(
      'client disconnected:',
      socket.id
    );

    const {
      roomCode,
      displayName,
    } = socket.data;

    if (
      !roomCode ||
      !roomParticipants.has(roomCode)
    ) {
      return;
    }

    const participants =
      roomParticipants.get(roomCode);

    participants.delete(socket.id);

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

    // Room mein koi participant nahi hai
    // to memory clean kar do
    if (participants.size === 0) {
      roomParticipants.delete(roomCode);
    }
  });
});

/* -------------------- Database + Server -------------------- */

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('mongo connected');

    server.listen(PORT, () => {
      console.log(
        `server running on port ${PORT}`
      );
    });
  })
  .catch((err) => {
    console.error(
      'mongo connection failed:',
      err.message
    );

    process.exit(1);
  });