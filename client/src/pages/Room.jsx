import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL;

function extractVideoId(input) {
  const trimmed = input.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1);
    if (url.searchParams.get('v')) return url.searchParams.get('v');
    const match = url.pathname.match(/\/(embed|live)\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[2];
  } catch {
    return null;
  }

  return null;
}

function loadYouTubeApi() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.body.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
  });
}

export default function Room() {
  const { roomCode } = useParams();
  const isHost = localStorage.getItem(`isHost-${roomCode}`) === 'true';

  const [videoInput, setVideoInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [initialRoom, setInitialRoom] = useState(null);

  const [displayName, setDisplayName] = useState(() => localStorage.getItem('roomly-username') || '');
  const [nameInput, setNameInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [participants, setParticipants] = useState([]);

  const [summary, setSummary] = useState('');
  const [summarizing, setSummarizing] = useState(false);

  const [toasts, setToasts] = useState([]);

  const socketRef = useRef(null);
  const playerRef = useRef(null);
  const lastTimeRef = useRef(0);
  const seekCheckInterval = useRef(null);
  const chatEndRef = useRef(null);

  function pushToast(text) {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }

  // fetch room + connect socket
  useEffect(() => {
    let socket;

    async function init() {
      try {
        const res = await fetch(`${API_URL}/api/rooms/${roomCode}`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        const room = await res.json();

        const messagesRes = await fetch(`${API_URL}/api/rooms/${roomCode}/messages`);
        const pastMessages = await messagesRes.json();
        setMessages(pastMessages);

        socket = io(API_URL);
        socketRef.current = socket;

        socket.on('connect', () => {
          socket.emit('join-room', roomCode);

          const savedName = localStorage.getItem('roomly-username');
          if (savedName) {
            socket.emit('set-name', { roomCode, name: savedName });
          }
        });

        socket.on('load-video', (videoId) => {
          if (playerRef.current) {
            playerRef.current.loadVideoById(videoId);
          } else {
            createPlayer(videoId);
          }
        });

        socket.on('video-play', (currentTime) => {
          if (!playerRef.current) return;
          const drift = Math.abs(playerRef.current.getCurrentTime() - currentTime);
          if (drift > 1) playerRef.current.seekTo(currentTime, true);
          playerRef.current.playVideo();
        });

        socket.on('video-pause', (currentTime) => {
          if (!playerRef.current) return;

          const drift = Math.abs(playerRef.current.getCurrentTime() - currentTime);
          if (drift > 1) {
            playerRef.current.seekTo(currentTime, true);
          }

          playerRef.current.pauseVideo();

          setTimeout(() => {
            if (playerRef.current) playerRef.current.pauseVideo();
          }, 300);
        });

        socket.on('video-seek', (currentTime) => {
          if (!playerRef.current) return;
          playerRef.current.seekTo(currentTime, true);
        });

        socket.on('new-message', (message) => {
          setMessages((prev) => [...prev, message]);
        });

        socket.on('user-joined', (name) => {
          pushToast(`${name} joined the room`);
        });

        socket.on('user-left', (name) => {
          pushToast(`${name} left the room`);
        });

        socket.on('participant-list', (names) => {
          setParticipants(names);
        });

        setInitialRoom(room);
        setLoadingRoom(false);
      } catch (err) {
        console.error('failed to load room:', err.message);
        setNotFound(true);
      }
    }

    init();

    return () => {
      if (socket) socket.disconnect();
      if (seekCheckInterval.current) clearInterval(seekCheckInterval.current);
      if (playerRef.current) playerRef.current.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  useEffect(() => {
    if (!loadingRoom && initialRoom?.currentVideoId && !playerRef.current) {
      createPlayer(initialRoom.currentVideoId, initialRoom.currentTime, initialRoom.isPlaying);
    }
  }, [loadingRoom, initialRoom]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function createPlayer(videoId, startTime = 0, shouldAutoplay = false) {
    const YT = await loadYouTubeApi();

    playerRef.current = new YT.Player('yt-player', {
      videoId,
      playerVars: {
        controls: isHost ? 1 : 0,
        disablekb: isHost ? 0 : 1,
        fs: isHost ? 1 : 0,
        start: Math.floor(startTime),
      },
      events: {
        onStateChange: handlePlayerStateChange,
        onReady: () => {
          if (shouldAutoplay && playerRef.current) {
            playerRef.current.playVideo();
          }
        },
      },
    });
  }

  function handlePlayerStateChange(event) {
    if (!isHost) return;

    const currentTime = event.target.getCurrentTime();

    if (event.data === window.YT.PlayerState.PLAYING) {
      lastTimeRef.current = currentTime;
      socketRef.current.emit('video-play', { roomCode, currentTime });
      startSeekWatcher();
    }

    if (event.data === window.YT.PlayerState.PAUSED) {
      socketRef.current.emit('video-pause', { roomCode, currentTime });
      clearInterval(seekCheckInterval.current);
    }
  }

  function startSeekWatcher() {
    clearInterval(seekCheckInterval.current);
    let lastCheckedAt = Date.now();

    seekCheckInterval.current = setInterval(() => {
      if (!playerRef.current) return;

      const now = Date.now();
      const secondsElapsed = (now - lastCheckedAt) / 1000;
      const current = playerRef.current.getCurrentTime();
      const expected = lastTimeRef.current + secondsElapsed;

      if (Math.abs(current - expected) > 2.5) {
        socketRef.current.emit('video-seek', { roomCode, currentTime: current });
      }

      lastTimeRef.current = current;
      lastCheckedAt = now;
    }, 1500);
  }

  function handleLoadVideo() {
    const videoId = extractVideoId(videoInput);
    if (!videoId) {
      alert("that doesn't look like a valid YouTube link or id");
      return;
    }

    socketRef.current.emit('load-video', { roomCode, videoId });
    createPlayer(videoId);
    setVideoInput('');
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;

    setSearching(true);
    try {
      const res = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data);
    } catch (err) {
      console.error('search failed:', err.message);
    } finally {
      setSearching(false);
    }
  }

  function handleSelectVideo(videoId) {
    socketRef.current.emit('load-video', { roomCode, videoId });
    createPlayer(videoId);
    setSearchResults([]);
    setSearchQuery('');
  }

  function handleSetName() {
    if (!nameInput.trim()) return;
    const name = nameInput.trim();
    localStorage.setItem('roomly-username', name);
    setDisplayName(name);

    if (socketRef.current) {
      socketRef.current.emit('set-name', { roomCode, name });
    }
  }

  function handleSendMessage() {
    if (!chatInput.trim() || !socketRef.current) return;

    socketRef.current.emit('send-message', {
      roomCode,
      sender: displayName,
      text: chatInput.trim(),
    });
    setChatInput('');
  }

  async function handleCatchUp() {
    setSummarizing(true);
    setSummary('');

    try {
      const res = await fetch(`${API_URL}/api/rooms/${roomCode}/summary`, {
        method: 'POST',
      });

      if (!res.ok) throw new Error('summary failed');

      const data = await res.json();
      setSummary(data.summary);
    } catch (err) {
      console.error('catch up failed:', err.message);
      setSummary("couldn't generate a summary right now, try again in a bit");
    } finally {
      setSummarizing(false);
    }
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-[#121212] text-[#F2EFEA] flex items-center justify-center">
        <p className="text-[#A8A29E]">this room doesn't exist</p>
      </div>
    );
  }

  if (loadingRoom) {
    return (
      <div className="min-h-screen bg-[#121212] text-[#F2EFEA] flex flex-col items-center justify-center gap-3">
        <div className="w-6 h-6 border-2 border-[#383838] border-t-[#B20710] rounded-full animate-spin" />
        <p className="text-[#A8A29E] text-sm">joining room...</p>
      </div>
    );
  }

  if (!displayName) {
    return (
      <div className="min-h-screen bg-[#121212] text-[#F2EFEA] flex items-center justify-center px-4">
        <div className="w-full max-w-xs">
          <h2 className="text-lg font-medium mb-4">what should we call you?</h2>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSetName()}
            placeholder="your name"
            autoFocus
            className="w-full bg-[#1E1E1E] border border-[#383838] rounded-lg px-4 py-3 mb-3 outline-none focus:border-[#D97706] transition-colors"
          />
          <button
            onClick={handleSetName}
            className="w-full bg-[#B20710] hover:bg-[#8F060D] text-white font-medium py-3 rounded-lg transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#121212] text-[#F2EFEA] px-4 py-6 sm:py-8">
      {/* toasts */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 items-end">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="bg-[#292929] border border-[#383838] text-sm px-3 py-2 rounded-lg shadow"
          >
            {toast.text}
          </div>
        ))}
      </div>

      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-medium">room: {roomCode}</h1>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#A8A29E]">
              {participants.length} watching
            </span>
            {isHost && (
              <span className="text-xs bg-[#292929] border border-[#383838] px-2 py-1 rounded">
                host
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* main video area */}
          <div className="flex-1 min-w-0">
            {isHost && (
              <div className="mb-6">
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={videoInput}
                    onChange={(e) => setVideoInput(e.target.value)}
                    placeholder="paste a YouTube link or video id"
                    className="flex-1 bg-[#1E1E1E] border border-[#383838] rounded-lg px-4 py-2 outline-none focus:border-[#D97706] transition-colors"
                  />
                  <button
                    onClick={handleLoadVideo}
                    className="bg-[#B20710] hover:bg-[#8F060D] text-white font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    Load
                  </button>
                </div>

                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="or search YouTube..."
                    className="flex-1 bg-[#1E1E1E] border border-[#383838] rounded-lg px-4 py-2 outline-none focus:border-[#D97706] transition-colors"
                  />
                  <button
                    onClick={handleSearch}
                    disabled={searching}
                    className="bg-[#292929] border border-[#383838] hover:bg-[#353535] px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {searching ? '...' : 'Search'}
                  </button>
                </div>

                {searchResults.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    {searchResults.map((result) => (
                      <button
                        key={result.videoId}
                        onClick={() => handleSelectVideo(result.videoId)}
                        className="text-left bg-[#1E1E1E] border border-[#383838] rounded-lg overflow-hidden hover:border-[#D97706] transition-colors"
                      >
                        <img
                          src={result.thumbnail}
                          alt={result.title}
                          className="w-full aspect-video object-cover"
                        />
                        <p className="text-xs px-2 py-2 line-clamp-2">{result.title}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="aspect-video bg-[#1E1E1E] rounded-lg overflow-hidden relative">
              <div id="yt-player" className="w-full h-full" />
              {!isHost && <div className="absolute inset-0" />}
            </div>

            {!isHost && (
              <p className="text-xs text-[#A8A29E] mt-2">
                only the host controls playback here
              </p>
            )}

            {participants.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {participants.map((name, i) => (
                  <span
                    key={i}
                    className="text-xs bg-[#1E1E1E] border border-[#383838] px-2 py-1 rounded-full text-[#A8A29E]"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* side panel: chat */}
          <div className="w-full lg:w-80 flex flex-col bg-[#1E1E1E] border border-[#383838] rounded-lg h-[400px] lg:h-[560px]">
            <div className="px-4 py-3 border-b border-[#383838] flex items-center justify-between">
              <p className="text-sm font-medium">chat</p>
              <button
                onClick={handleCatchUp}
                disabled={summarizing}
                className="text-xs bg-[#292929] border border-[#383838] hover:bg-[#353535] px-2 py-1 rounded disabled:opacity-50 transition-colors"
              >
                {summarizing ? 'thinking...' : 'Catch me up'}
              </button>
            </div>

            {summary && (
              <div className="px-4 py-3 bg-[#292929] border-b border-[#383838] text-sm text-[#A8A29E]">
                {summary}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {messages.length === 0 && (
                <div className="h-full flex items-center justify-center">
                  <p className="text-xs text-[#A8A29E]">no messages yet, say hi</p>
                </div>
              )}
              {messages.map((msg) => (
                <div key={msg._id} className="text-sm">
                  <span className="text-[#A8A29E]">{msg.sender}: </span>
                  <span>{msg.text}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="p-3 border-t border-[#383838] flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="type a message"
                className="flex-1 bg-[#121212] border border-[#383838] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#D97706] transition-colors"
              />
              <button
                onClick={handleSendMessage}
                className="bg-[#B20710] hover:bg-[#8F060D] text-white text-sm font-medium px-3 rounded-lg transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}