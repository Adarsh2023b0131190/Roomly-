import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL;

function extractVideoId(input) {
  const trimmed = input.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);

    if (url.hostname.includes('youtu.be')) {
      return url.pathname.slice(1);
    }

    if (url.searchParams.get('v')) {
      return url.searchParams.get('v');
    }

    const match = url.pathname.match(
      /\/(embed|live)\/([a-zA-Z0-9_-]{11})/
    );

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

    if (document.getElementById('youtube-iframe-api')) {
      const checkPlayer = setInterval(() => {
        if (window.YT && window.YT.Player) {
          clearInterval(checkPlayer);
          resolve(window.YT);
        }
      }, 100);

      return;
    }

    const tag = document.createElement('script');
    tag.id = 'youtube-iframe-api';
    tag.src = 'https://www.youtube.com/iframe_api';

    document.body.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
      resolve(window.YT);
    };
  });
}

export default function Room() {
  const { roomCode } = useParams();

  const isHost =
    localStorage.getItem(`isHost-${roomCode}`) === 'true';

  const [videoInput, setVideoInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const [loadingRoom, setLoadingRoom] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [initialRoom, setInitialRoom] = useState(null);

  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem('roomly-username') || ''
  );

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

    setToasts((prev) => [
      ...prev,
      { id, text },
    ]);

    setTimeout(() => {
      setToasts((prev) =>
        prev.filter((toast) => toast.id !== id)
      );
    }, 3500);
  }

  useEffect(() => {
    let socket;

    async function init() {
      try {
        const res = await fetch(
          `${API_URL}/api/rooms/${roomCode}`
        );

        if (res.status === 404) {
          setNotFound(true);
          return;
        }

        if (!res.ok) {
          throw new Error('failed to load room');
        }

        const room = await res.json();

        const messagesRes = await fetch(
          `${API_URL}/api/rooms/${roomCode}/messages`
        );

        if (messagesRes.ok) {
          const pastMessages = await messagesRes.json();
          setMessages(pastMessages);
        }

        socket = io(API_URL);
        socketRef.current = socket;

        socket.on('connect', () => {
          socket.emit('join-room', roomCode);

          const savedName =
            localStorage.getItem('roomly-username');

          if (savedName) {
            socket.emit('set-name', {
              roomCode,
              name: savedName,
            });
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

          const drift = Math.abs(
            playerRef.current.getCurrentTime() - currentTime
          );

          if (drift > 1) {
            playerRef.current.seekTo(currentTime, true);
          }

          playerRef.current.playVideo();
        });

        socket.on('video-pause', (currentTime) => {
          if (!playerRef.current) return;

          const drift = Math.abs(
            playerRef.current.getCurrentTime() - currentTime
          );

          if (drift > 1) {
            playerRef.current.seekTo(currentTime, true);
          }

          playerRef.current.pauseVideo();

          setTimeout(() => {
            playerRef.current?.pauseVideo();
          }, 300);
        });

        socket.on('video-seek', (currentTime) => {
          if (!playerRef.current) return;

          playerRef.current.seekTo(currentTime, true);
        });

        socket.on('video-ended', () => {
          if (!playerRef.current) return;

          clearInterval(seekCheckInterval.current);
          playerRef.current.pauseVideo();
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
        console.error(
          'failed to load room:',
          err.message
        );

        setNotFound(true);
      }
    }

    init();

    return () => {
      socket?.disconnect();

      clearInterval(seekCheckInterval.current);

      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [roomCode]);

  useEffect(() => {
    if (
      !loadingRoom &&
      initialRoom?.currentVideoId &&
      !playerRef.current
    ) {
      createPlayer(
        initialRoom.currentVideoId,
        initialRoom.currentTime,
        initialRoom.isPlaying
      );
    }
  }, [loadingRoom, initialRoom]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: 'smooth',
    });
  }, [messages]);

  async function createPlayer(
    videoId,
    startTime = 0,
    shouldAutoplay = false
  ) {
    const YT = await loadYouTubeApi();

    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }

    playerRef.current = new YT.Player('yt-player', {
      videoId,

      playerVars: {
        controls: isHost ? 1 : 0,
        disablekb: isHost ? 0 : 1,

        // Fullscreen sab users ke liye enabled
        fs: 1,

        start: Math.floor(startTime),
      },

      events: {
        onStateChange: handlePlayerStateChange,

        onReady: () => {
          if (
            shouldAutoplay &&
            playerRef.current
          ) {
            playerRef.current.playVideo();
          }
        },
      },
    });
  }

  function handlePlayerStateChange(event) {
    if (!isHost || !socketRef.current) return;

    const currentTime =
      event.target.getCurrentTime();

    if (
      event.data ===
      window.YT.PlayerState.PLAYING
    ) {
      lastTimeRef.current = currentTime;

      socketRef.current.emit('video-play', {
        roomCode,
        currentTime,
      });

      startSeekWatcher();
    }

    if (
      event.data ===
      window.YT.PlayerState.PAUSED
    ) {
      socketRef.current.emit('video-pause', {
        roomCode,
        currentTime,
      });

      clearInterval(seekCheckInterval.current);
    }

    if (
      event.data ===
      window.YT.PlayerState.ENDED
    ) {
      clearInterval(seekCheckInterval.current);

      socketRef.current.emit('video-ended', {
        roomCode,
      });
    }
  }

  function startSeekWatcher() {
    clearInterval(seekCheckInterval.current);

    let lastCheckedAt = Date.now();

    seekCheckInterval.current = setInterval(() => {
      if (
        !playerRef.current ||
        !socketRef.current
      ) {
        return;
      }

      const now = Date.now();

      const secondsElapsed =
        (now - lastCheckedAt) / 1000;

      const current =
        playerRef.current.getCurrentTime();

      const expected =
        lastTimeRef.current + secondsElapsed;

      if (Math.abs(current - expected) > 2.5) {
        socketRef.current.emit('video-seek', {
          roomCode,
          currentTime: current,
        });
      }

      lastTimeRef.current = current;
      lastCheckedAt = now;
    }, 1500);
  }

  function handleLoadVideo() {
    const videoId =
      extractVideoId(videoInput);

    if (!videoId) {
      alert(
        "that doesn't look like a valid YouTube link or id"
      );
      return;
    }

    socketRef.current?.emit('load-video', {
      roomCode,
      videoId,
    });

    createPlayer(videoId);
    setVideoInput('');
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;

    setSearching(true);

    try {
      const res = await fetch(
        `${API_URL}/api/search?q=${encodeURIComponent(
          searchQuery
        )}`
      );

      if (!res.ok) {
        throw new Error('search failed');
      }

      const data = await res.json();

      setSearchResults(data);
    } catch (err) {
      console.error(
        'search failed:',
        err.message
      );
    } finally {
      setSearching(false);
    }
  }

  function handleSelectVideo(videoId) {
    socketRef.current?.emit('load-video', {
      roomCode,
      videoId,
    });

    createPlayer(videoId);

    setSearchResults([]);
    setSearchQuery('');
  }

  function handleSetName() {
    if (!nameInput.trim()) return;

    const name = nameInput.trim();

    localStorage.setItem(
      'roomly-username',
      name
    );

    setDisplayName(name);

    socketRef.current?.emit('set-name', {
      roomCode,
      name,
    });

    setNameInput('');
  }

  function handleSendMessage() {
    if (
      !chatInput.trim() ||
      !socketRef.current
    ) {
      return;
    }

    socketRef.current.emit('send-message', {
      roomCode,
      sender: displayName || 'anonymous',
      text: chatInput.trim(),
    });

    setChatInput('');
  }

  async function handleCatchUp() {
    setSummarizing(true);
    setSummary('');

    try {
      const res = await fetch(
        `${API_URL}/api/rooms/${roomCode}/summary`,
        {
          method: 'POST',
        }
      );

      if (!res.ok) {
        throw new Error('summary failed');
      }

      const data = await res.json();

      setSummary(data.summary);
    } catch (err) {
      console.error(
        'catch up failed:',
        err.message
      );

      setSummary(
        "couldn't generate a summary right now, try again in a bit"
      );
    } finally {
      setSummarizing(false);
    }
  }

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#121212] text-[#F2EFEA]">
        <p className="text-[#A8A29E]">
          this room doesn't exist
        </p>
      </div>
    );
  }

  if (loadingRoom) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#121212] text-[#F2EFEA]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#383838] border-t-[#B20710]" />

        <p className="text-sm text-[#A8A29E]">
          joining room...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#121212] text-[#F2EFEA]">
      <header className="border-b border-[#383838] bg-[#1E1E1E]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-lg font-semibold">
              Roomly
            </h1>

            <p className="mt-0.5 text-xs text-[#A8A29E]">
              room {roomCode}
            </p>
          </div>

          {isHost ? (
            <span className="rounded-full border border-[#B20710]/50 bg-[#292929] px-3 py-1 text-xs text-[#F2EFEA]">
              host
            </span>
          ) : (
            <span className="rounded-full border border-[#383838] bg-[#292929] px-3 py-1 text-xs text-[#A8A29E]">
              watching
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {!displayName && (
          <div className="mb-5 border border-[#383838] bg-[#1E1E1E] p-4">
            <p className="mb-3 text-sm">
              choose a name for the room
            </p>

            <div className="flex gap-2">
              <input
                value={nameInput}
                onChange={(e) =>
                  setNameInput(e.target.value)
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSetName();
                  }
                }}
                placeholder="your name"
                className="min-w-0 flex-1 border border-[#383838] bg-[#292929] px-3 py-2 text-sm outline-none placeholder:text-[#77716B] focus:border-[#D97706]"
              />

              <button
                onClick={handleSetName}
                className="bg-[#292929] px-4 py-2 text-sm font-medium hover:bg-[#353535]"
              >
                Join
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="min-w-0 flex-1">
            {isHost && (
              <div className="mb-4">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={videoInput}
                    onChange={(e) =>
                      setVideoInput(e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleLoadVideo();
                      }
                    }}
                    placeholder="paste a YouTube link"
                    className="min-w-0 flex-1 border border-[#383838] bg-[#1E1E1E] px-4 py-3 text-sm outline-none placeholder:text-[#77716B] focus:border-[#D97706]"
                  />

                  <button
                    onClick={handleLoadVideo}
                    className="bg-[#B20710] px-5 py-3 text-sm font-medium text-white hover:bg-[#8F060D]"
                  >
                    Load video
                  </button>
                </div>

                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) =>
                      setSearchQuery(e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSearch();
                      }
                    }}
                    placeholder="search YouTube"
                    className="min-w-0 flex-1 border border-[#383838] bg-[#1E1E1E] px-4 py-3 text-sm outline-none placeholder:text-[#77716B] focus:border-[#D97706]"
                  />

                  <button
                    onClick={handleSearch}
                    disabled={searching}
                    className="border border-[#383838] bg-[#292929] px-5 py-3 text-sm font-medium hover:bg-[#353535] disabled:opacity-50"
                  >
                    {searching ? 'searching...' : 'Search'}
                  </button>
                </div>

                {searchResults.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {searchResults.map((result) => (
                      <button
                        key={result.videoId}
                        onClick={() =>
                          handleSelectVideo(result.videoId)
                        }
                        className="overflow-hidden border border-[#383838] bg-[#1E1E1E] text-left hover:border-[#D97706]"
                      >
                        <img
                          src={result.thumbnail}
                          alt={result.title}
                          className="aspect-video w-full object-cover"
                        />

                        <p className="line-clamp-2 px-2 py-2 text-xs">
                          {result.title}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="relative aspect-video overflow-hidden bg-[#1E1E1E]">
              <div
                id="yt-player"
                className="h-full w-full"
              />

              {!isHost && (
                <div className="pointer-events-none absolute inset-0" />
              )}
            </div>

            {!isHost && (
              <p className="mt-2 text-xs text-[#A8A29E]">
                only the host controls playback. Use the
                fullscreen button to watch on your screen.
              </p>
            )}

            {participants.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {participants.map((name, index) => (
                  <span
                    key={`${name}-${index}`}
                    className="rounded-full border border-[#383838] bg-[#1E1E1E] px-3 py-1 text-xs text-[#A8A29E]"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <aside className="flex h-[400px] w-full flex-col border border-[#383838] bg-[#1E1E1E] lg:h-[560px] lg:w-80">
            <div className="flex items-center justify-between border-b border-[#383838] px-4 py-3">
              <p className="text-sm font-medium">
                chat
              </p>

              <button
                onClick={handleCatchUp}
                disabled={summarizing}
                className="border border-[#383838] bg-[#292929] px-2 py-1 text-xs hover:bg-[#353535] disabled:opacity-50"
              >
                {summarizing
                  ? 'thinking...'
                  : 'Catch me up'}
              </button>
            </div>

            {summary && (
              <div className="border-b border-[#383838] bg-[#292929] px-4 py-3 text-sm text-[#A8A29E]">
                {summary}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {messages.length === 0 ? (
                <p className="text-center text-xs text-[#77716B]">
                  no messages yet
                </p>
              ) : (
                messages.map((message) => (
                  <div
                    key={message._id}
                    className="mb-3"
                  >
                    <p className="mb-1 text-xs text-[#D97706]">
                      {message.sender}
                    </p>

                    <p className="break-words text-sm text-[#F2EFEA]">
                      {message.text}
                    </p>
                  </div>
                ))
              )}

              <div ref={chatEndRef} />
            </div>

            <div className="border-t border-[#383838] p-3">
              <div className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) =>
                    setChatInput(e.target.value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSendMessage();
                    }
                  }}
                  placeholder="write a message"
                  className="min-w-0 flex-1 border border-[#383838] bg-[#292929] px-3 py-2 text-sm outline-none placeholder:text-[#77716B] focus:border-[#D97706]"
                />

                <button
                  onClick={handleSendMessage}
                  className="bg-[#B20710] px-3 py-2 text-sm font-medium text-white hover:bg-[#8F060D]"
                >
                  Send
                </button>
              </div>
            </div>
          </aside>
        </div>
      </main>

      <div className="fixed right-4 top-4 z-50 flex w-64 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="border border-[#383838] bg-[#292929] px-4 py-3 text-sm shadow-lg"
          >
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}