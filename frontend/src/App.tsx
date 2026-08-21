import React, { useState, useEffect } from "react";
import { generateIdentity, generateAvatar } from "../../shared/identities";
import { Home } from "./components/Home";
import { CreateRoom } from "./components/CreateRoom";
import { JoinRoom } from "./components/JoinRoom";
import { IdentitySetup } from "./components/IdentitySetup";
import { ActiveRoom } from "./components/ActiveRoom";
import { NukeAnimation } from "./components/NukeAnimation";
import { LegalPage } from "./components/LegalPage";
import { Shuffle, Loader2 } from "lucide-react";
import { RoomType, RoomVisibility } from "../../shared/types";
import { wipeDatabase } from "./utils/db";

// Dynamic Backend URL resolution (development vs production Pages deployment)
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  (window.location.hostname === "localhost"
    ? "http://localhost:8787"
    : window.location.origin);

type AppScreen = "HOME" | "CREATE" | "JOIN" | "IDENTITY" | "ACTIVE_CHAT" | "MATCHMAKING" | "NUKED" | "EXPIRED";

export default function App() {
  const [screen, setScreen] = useState<AppScreen>("HOME");
  const [sessionId, setSessionId] = useState("");
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  
  // Room parameters
  const [roomCode, setRoomCode] = useState("");
  const [roomType, setRoomType] = useState<RoomType>("timed");
  const [expiresAt, setExpiresAt] = useState("");
  const [salt, setSalt] = useState("");
  const [isActionPending, setIsActionPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Identity parameters
  const [identityName, setIdentityName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  // Matchmaking poll handle
  const [matchmakeInterval, setMatchmakeInterval] = useState<any>(null);

  // Hash Routing parameters
  const [currentHash, setCurrentHash] = useState(window.location.hash);

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentHash(window.location.hash);
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // 1. Initial configuration on application startup
  useEffect(() => {
    // Session ID setup (persistent across browser tabs using sessionStorage)
    let sId = sessionStorage.getItem("nukechat_session_id");
    if (!sId) {
      sId = crypto.randomUUID();
      sessionStorage.setItem("nukechat_session_id", sId);
    }
    setSessionId(sId);

    // One Room Rule verification
    const activeCode = localStorage.getItem("nukechat_active_room_code");
    if (activeCode) {
      setActiveRoomCode(activeCode);
    }
  }, []);

  // 1.5 Dynamic SEO Page Title and Meta Description Updates
  useEffect(() => {
    let title = "Nuke Chat | Free Anonymous Chat Rooms & Temporary Ephemeral Messenger";
    let description = "Nuke Chat is a secure, anonymous, accountless, and temporary web chat. Create end-to-end encrypted rooms or P2P mesh chats. Nuke the history anytime.";

    if (currentHash === "#/privacy") {
      title = "Privacy Policy | Nuke Chat";
      description = "Read Nuke Chat's zero-knowledge privacy policy. We do not collect, request, or store any personal data, IP addresses, or message logs.";
    } else if (currentHash === "#/terms") {
      title = "Terms of Service | Nuke Chat";
      description = "Read Nuke Chat's terms of service. Ephemeral, self-destructing rooms with client-side encryption and zero database retention.";
    } else {
      switch (screen) {
        case "CREATE":
          title = "Create Temporary Chat Room | Nuke Chat";
          description = "Configure and launch a temporary, secure, anonymous chat room. Choose timed server-side encryption or WebRTC peer-to-peer mesh.";
          break;
        case "JOIN":
          title = "Join Anonymous Chat Room | Nuke Chat";
          description = "Enter a room code to join an anonymous, end-to-end encrypted or direct peer-to-peer temporary chat room.";
          break;
        case "IDENTITY":
          title = "Set Chat Identity | Nuke Chat";
          description = "Configure your temporary adjective-animal identity and avatar before entering the chat room.";
          break;
        case "ACTIVE_CHAT":
          title = `Active Secure Chat (${roomCode || "Session"}) | Nuke Chat`;
          description = "You are in an active, encrypted, temporary chat session. Disappears permanently when empty, expired, or nuked.";
          break;
        case "MATCHMAKING":
          title = "Searching for Open Room | Nuke Chat";
          description = "Finding an open room for random matchmaking. Please hold on...";
          break;
        case "NUKED":
          title = "Chat Nuked & Destroyed | Nuke Chat";
          description = "This room has been completely nuked. All messages and database records have been permanently wiped.";
          break;
        case "EXPIRED":
          title = "Chat Expired | Nuke Chat";
          description = "This chat room has expired and disappeared naturally. The server database and client cache have been cleared.";
          break;
        case "HOME":
        default:
          title = "Nuke Chat | Free Anonymous Chat Rooms & Temporary Ephemeral Messenger";
          description = "Nuke Chat is a secure, anonymous, accountless, and temporary web chat. Create end-to-end encrypted rooms or P2P mesh chats. Nuke the history anytime.";
          break;
      }
    }

    document.title = title;
    
    // Update Meta Description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute('content', description);

    // Update OpenGraph Title
    let ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', title);
    
    // Update OpenGraph Description
    let ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', description);

    // Update Twitter Title
    let twTitle = document.querySelector('meta[name="twitter:title"]');
    if (twTitle) twTitle.setAttribute('content', title);

    // Update Twitter Description
    let twDesc = document.querySelector('meta[name="twitter:description"]');
    if (twDesc) twDesc.setAttribute('content', description);
  }, [screen, currentHash, roomCode]);

  // 2. Generate identity
  const handleGenerateIdentity = () => {
    const name = generateIdentity();
    const avatar = generateAvatar(name);
    setIdentityName(name);
    setAvatarUrl(avatar);
  };

  // 3. API Call: Create Room
  const handleCreateRoom = async (params: { type: RoomType; visibility: RoomVisibility; expiresInMinutes: number }) => {
    setIsActionPending(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/room/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      const data = await res.json();
      if (res.status === 200 && data.success) {
        setRoomCode(data.roomCode);
        setRoomType(params.type);
        setExpiresAt(data.expiresAt);
        setSalt(data.salt);

        // Prepare initial identity
        handleGenerateIdentity();
        setScreen("IDENTITY");
      } else {
        setErrorMessage(data.error || "Failed to create room. Please try again.");
      }
    } catch (err) {
      setErrorMessage("Network error connecting to Nuke Chat server.");
    } finally {
      setIsActionPending(false);
    }
  };

  // 4. API Call: Join Room (Eligibility Check)
  const handleJoinRoom = async (code: string) => {
    setIsActionPending(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/room/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode: code }),
      });

      const data = await res.json();
      if (res.status === 200 && data.success) {
        setRoomCode(data.roomCode);
        setRoomType(data.type);
        setExpiresAt(data.expiresAt);
        setSalt(data.salt);

        handleGenerateIdentity();
        setScreen("IDENTITY");
      } else {
        setErrorMessage(data.error || "Failed to join room.");
      }
    } catch (err) {
      setErrorMessage("Network error checking room parameters.");
    } finally {
      setIsActionPending(false);
    }
  };

  // 5. Random Matchmaking Coordinator
  const handleStartMatchmaking = () => {
    setScreen("MATCHMAKING");
    setErrorMessage(null);

    const poll = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/matchmake`, {
          headers: { "X-Session-ID": sessionId },
        });

        if (res.status === 200) {
          const data = await res.json();
          if (data.success) {
            clearInterval(pollInterval);
            setRoomCode(data.roomCode);
            setRoomType("timed");
            setExpiresAt(data.expiresAt);
            setSalt(data.salt);

            handleGenerateIdentity();
            setScreen("IDENTITY");
          }
        }
      } catch (e) {
        // Retry silently
      }
    };

    poll(); // Run instantly
    const pollInterval = setInterval(poll, 3000);
    setMatchmakeInterval(pollInterval);
  };

  const handleCancelMatchmaking = () => {
    if (matchmakeInterval) {
      clearInterval(matchmakeInterval);
      setMatchmakeInterval(null);
    }
    setScreen("HOME");
  };

  // 6. Enter Active Chat Room
  const handleEnterChat = () => {
    localStorage.setItem("nukechat_active_room_code", roomCode);
    setActiveRoomCode(roomCode);
    setScreen("ACTIVE_CHAT");
  };

  // 7. Rejoin active session from local storage
  const handleRejoinSession = async () => {
    if (!activeRoomCode) return;
    await handleJoinRoom(activeRoomCode);
  };

  // 8. Leave and wipe active room details
  const handleLeaveRoom = () => {
    localStorage.removeItem("nukechat_active_room_code");
    setActiveRoomCode(null);
    wipeDatabase().catch(() => {});
    setScreen("HOME");
  };

  // 9. Nuke Event
  const handleNukeTriggered = () => {
    setScreen("NUKED");
    localStorage.removeItem("nukechat_active_room_code");
    setActiveRoomCode(null);
    wipeDatabase().catch(() => {});
  };

  // 10. Natural Expiry Event
  const handleRoomExpired = () => {
    setScreen("EXPIRED");
    localStorage.removeItem("nukechat_active_room_code");
    setActiveRoomCode(null);
    wipeDatabase().catch(() => {});
  };

  return (
    <div className="min-h-[100dvh] bg-background text-primaryText flex flex-col font-sans">
      {currentHash === "#/privacy" || currentHash === "#/terms" ? (
        <main className="flex-grow flex flex-col">
          <LegalPage
            type={currentHash === "#/privacy" ? "privacy" : "terms"}
            onBack={() => {
              window.location.hash = "";
            }}
          />
        </main>
      ) : (
        <main className="flex-grow flex flex-col justify-center">
          {/* 1. HOME SCREEN */}
          {screen === "HOME" && (
            <Home
              onCreateClick={() => {
                setErrorMessage(null);
                setScreen("CREATE");
              }}
              onRandomClick={handleStartMatchmaking}
              onJoinSubmit={handleJoinRoom}
              activeRoomCode={activeRoomCode}
              onRejoinClick={handleRejoinSession}
              onLeaveSessionClick={handleLeaveRoom}
              isJoining={isActionPending}
              errorMessage={errorMessage}
            />
          )}

          {/* 2. CREATE SCREEN */}
          {screen === "CREATE" && (
            <CreateRoom
              onBackClick={() => setScreen("HOME")}
              onCreateRoom={handleCreateRoom}
              isCreating={isActionPending}
            />
          )}

          {/* 4. MATCHMAKING WAITING SCREEN */}
          {screen === "MATCHMAKING" && (
            <div className="max-w-md mx-auto px-4 py-24 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 bg-brand-blue/30 rounded-2xl flex items-center justify-center text-sky-600 mb-6 animate-spin">
                <Shuffle className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Searching for Open Room</h2>
              <p className="text-xs text-secondaryText mb-8 max-w-xs leading-relaxed">
                Finding someone to match with you. Please hold on...
              </p>
              <button
                onClick={handleCancelMatchmaking}
                className="px-6 py-2.5 border border-[#E4E2DD] hover:bg-black/5 font-semibold text-xs tracking-wider uppercase rounded-full transition-all"
              >
                Cancel
              </button>
            </div>
          )}

          {/* 5. IDENTITY PREVIEW SCREEN */}
          {screen === "IDENTITY" && (
            <IdentitySetup
              onBackClick={() => setScreen("HOME")}
              identityName={identityName}
              avatarUrl={avatarUrl}
              onRegenerate={handleGenerateIdentity}
              onConfirm={handleEnterChat}
              roomCode={roomCode}
              roomType={roomType}
              isConnecting={isActionPending}
            />
          )}

          {/* 6. CHAT WINDOW WRAPPER */}
          {screen === "ACTIVE_CHAT" && (
            <ActiveRoom
              roomCode={roomCode}
              roomType={roomType}
              sessionId={sessionId}
              identityName={identityName}
              avatarUrl={avatarUrl}
              salt={salt}
              expiresAt={expiresAt}
              onGoHome={handleLeaveRoom}
              onRoomNuked={handleNukeTriggered}
              onRoomExpired={handleRoomExpired}
              backendUrl={BACKEND_URL}
            />
          )}

          {/* 7. NUKED SCREEN */}
          {screen === "NUKED" && (
            <NukeAnimation onComplete={() => {}} onGoHome={() => setScreen("HOME")} />
          )}

          {/* 8. NATURAL EXPIRY SCREEN */}
          {screen === "EXPIRED" && (
            <div className="fixed inset-0 bg-background flex items-center justify-center p-6 text-center select-none">
              <div className="max-w-md w-full bg-surface border border-[#E4E2DD] p-8 rounded-3xl shadow-sm flex flex-col items-center">
                <div className="w-20 h-20 bg-brand-blue/20 rounded-full flex items-center justify-center mb-6">
                  <span className="text-4xl">⏰</span>
                </div>
                <h1 className="text-2xl font-bold mb-3 tracking-tight">TIME'S UP</h1>
                <p className="text-secondaryText mb-8 leading-relaxed text-sm">
                  This chat room has expired and disappeared naturally. The server database and client cache have been cleared.
                </p>
                <button
                  onClick={() => setScreen("HOME")}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-full shadow-sm transition-all duration-200"
                >
                  Go Home
                </button>
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}
