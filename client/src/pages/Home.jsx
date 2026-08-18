import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL;

export default function Home() {
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  async function handleCreateRoom() {
    setLoading(true);
    setError('');

    try {
      const hostId =
        'host-' + Math.random().toString(36).slice(2, 10);

      const res = await fetch(`${API_URL}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ hostId }),
      });

      if (!res.ok) {
        throw new Error('room create failed');
      }

      const room = await res.json();

      localStorage.setItem(
        `isHost-${room.roomCode}`,
        'true'
      );

      navigate(`/room/${room.roomCode}`);
    } catch (err) {
      setError('Something went wrong. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinRoom() {
    if (!joinCode.trim()) {
      setError('Please enter a room code first.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(
        `${API_URL}/api/rooms/${joinCode.trim()}`
      );

      if (res.status === 404) {
        setError('This room does not exist.');
        return;
      }

      if (!res.ok) {
        throw new Error('something went wrong');
      }

      navigate(`/room/${joinCode.trim().toUpperCase()}`);
    } catch (err) {
      setError('Something went wrong. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#121212] px-4 text-[#F2EFEA]">
      <div className="w-full max-w-sm">
        {/* Heading */}
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Roomly
        </h1>

        <p className="mb-8 text-sm text-[#A8A29E]">
          Watch YouTube together, in sync.
        </p>

        {/* Create Room */}
        <button
          onClick={handleCreateRoom}
          disabled={loading}
          className="mb-4 w-full rounded-lg bg-[#B20710] py-3 text-sm font-medium text-white transition-colors hover:bg-[#8F060D] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create a room'}
        </button>

        {/* Divider */}
        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-[#383838]" />
          <span className="text-xs text-[#A8A29E]">or</span>
          <div className="h-px flex-1 bg-[#383838]" />
        </div>

        {/* Room Code Input */}
        <input
          type="text"
          value={joinCode}
          onChange={(e) => {
            setJoinCode(e.target.value);

            if (error) {
              setError('');
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleJoinRoom();
            }
          }}
          placeholder="Enter room code"
          className="mb-3 w-full rounded-lg border border-[#383838] bg-[#1E1E1E] px-4 py-3 text-sm text-[#F2EFEA] outline-none placeholder:text-[#77716B] transition-colors focus:border-[#D97706]"
        />

        {/* Join Room */}
        <button
          onClick={handleJoinRoom}
          disabled={loading}
          className="w-full rounded-lg border border-[#383838] bg-[#292929] py-3 text-sm font-medium text-[#F2EFEA] transition-colors hover:border-[#4A4A4A] hover:bg-[#353535] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Joining...' : 'Join a room'}
        </button>

        {/* Error Message */}
        {error && (
          <p className="mt-4 text-center text-sm text-[#D97706]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}