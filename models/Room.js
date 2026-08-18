const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  roomCode: {
    type: String,
    required: true,
    unique: true,
  },
  hostId: {
    type: String,
    required: true,
  },
  currentVideoId: {
    type: String,
    default: null,
  },
  isPlaying: {
    type: Boolean,
    default: false,
  },
  currentTime: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});



module.exports = mongoose.model('Room', roomSchema);