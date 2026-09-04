import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera,
  RotateCw,
  Mic,
  MicOff,
  ScreenShare,
  Users,
  Bomb,
  ArrowLeft,
  Maximize,
  Volume2,
  VolumeX,
  MessageSquare,
  Hand,
  Check,
  Sliders,
  Radio,
  WifiOff,
  RefreshCw,
  AlertTriangle,
  X,
  PictureInPicture,
  Share2,
} from "lucide-react";
import { UIMessage } from "./ActiveRoom";
import { TextMessageBody } from "./TextMessageBody";
import { BroadcastSource, StreamHealth } from "../hooks/useLocalMeet";

interface LocalMeetProps {
  roomCode: string;
  participants: Array<{ id: string; identity: string; avatar: string }>;
  lanParticipants?: Array<{ id: string; identity: string; avatar: string }>;
  mySessionId: string;
  hostId: string;
  identityName: string;
  messages: UIMessage[];
  onSendMessage: (text: string) => void;
  onNukeClick: () => void;
  onLeaveClick: () => void;
  nukeVotesState: { votesCount: number; neededVotes: number };
  isConnected: boolean;
  // From useLocalMeet
  isHost: boolean;
  isScreenSharing: boolean;
  isMicActive: boolean;
  isHostPresenting: boolean;
  broadcastSource: BroadcastSource;
  cameraFacingMode: "environment" | "user";
  broadcastError: string | null;
  streamHealth: StreamHealth;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  qualityMode: "clarity" | "motion";
  setQualityMode: (mode: "clarity" | "motion") => void;
  activeViewersCount: number;
  starViewersCount?: number;
  relayViewersCount?: number;
  peerTopologyMap?: Record<string, "star_lan" | "relay">;
  connectionTopology?: "star_lan" | "relay" | null;
  startScreenShare: (includeMic?: boolean) => Promise<void>;
  startCameraShare: (facingMode?: "environment" | "user", includeMic?: boolean) => Promise<void>;
  switchCameraFacingMode: () => Promise<void>;
  stopBroadcast: () => void;
  toggleMic: () => Promise<void>;
  retryStudentConnection: () => void;
  internetState?: "online" | "offline";
}

export const LocalMeet: React.FC<LocalMeetProps> = ({
  roomCode,
  participants,
  lanParticipants = [],
  mySessionId,
  hostId,
  identityName,
  messages,
  onSendMessage,
  onNukeClick,
  onLeaveClick,
  nukeVotesState,
  isConnected,
  isHost,
  isScreenSharing,
  isMicActive,
  isHostPresenting,
  broadcastSource,
  cameraFacingMode,
  broadcastError,
  streamHealth,
  localStream,
  remoteStream,
  qualityMode,
  setQualityMode,
  activeViewersCount,
  starViewersCount = 0,
  relayViewersCount = 0,
  peerTopologyMap = {},
  connectionTopology = null,
  startScreenShare,
  startCameraShare,
  switchCameraFacingMode,
  stopBroadcast,
  toggleMic,
  retryStudentConnection,
  internetState = "online",
}) => {
  const isMobileDevice =
    typeof navigator !== "undefined" &&
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  const [selectedBroadcastMode, setSelectedBroadcastMode] = useState<"screen" | "camera">(
    isMobileDevice ? "camera" : "screen"
  );
  const [includeMicOption, setIncludeMicOption] = useState(true);
  const [selectedCameraMode, setSelectedCameraMode] = useState<"environment" | "user">("environment");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"chat" | "people">("people");
  const [chatInput, setChatInput] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [isNetworkOnline, setIsNetworkOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsNetworkOnline(true);
    const handleOffline = () => setIsNetworkOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // Bind local stream to preview video and configure autoPictureInPicture
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
      try {
        (localVideoRef.current as any).autoPictureInPicture = true;
      } catch (e) {}
    }
    return () => {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
    };
  }, [localStream]);

  // Bind remote stream to student video and configure autoPictureInPicture
  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      try {
        (remoteVideoRef.current as any).autoPictureInPicture = true;
      } catch (e) {}
      if (remoteStream) {
        remoteVideoRef.current.play().catch((err) => {
          console.warn("[LocalMeet] Autoplay unmuted failed, attempting muted autoplay:", err);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.muted = true;
            setIsMuted(true);
            remoteVideoRef.current.play().catch(() => {});
          }
        });
      } else {
        remoteVideoRef.current.pause();
      }
    }
    return () => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
    };
  }, [remoteStream]);

  const pipWindowRef = useRef<any>(null);

  const closePiPWindow = useCallback(() => {
    if (pipWindowRef.current) {
      try {
        pipWindowRef.current.close();
      } catch (e) {}
      pipWindowRef.current = null;
    }
    setIsPiPActive(false);
  }, []);

  // Track Picture-in-Picture lifecycle events
  useEffect(() => {
    const handleEnterPiP = () => setIsPiPActive(true);
    const handleLeavePiP = () => setIsPiPActive(false);

    const v1 = localVideoRef.current;
    const v2 = remoteVideoRef.current;

    v1?.addEventListener("enterpictureinpicture", handleEnterPiP);
    v1?.addEventListener("leavepictureinpicture", handleLeavePiP);
    v2?.addEventListener("enterpictureinpicture", handleEnterPiP);
    v2?.addEventListener("leavepictureinpicture", handleLeavePiP);

    return () => {
      v1?.removeEventListener("enterpictureinpicture", handleEnterPiP);
      v1?.removeEventListener("leavepictureinpicture", handleLeavePiP);
      v2?.removeEventListener("enterpictureinpicture", handleEnterPiP);
      v2?.removeEventListener("leavepictureinpicture", handleLeavePiP);
    };
  }, [localStream, remoteStream, isScreenSharing, isHostPresenting]);

  // Standard Picture-in-Picture toggle (enforcing standard compact 400x230 size)
  const togglePictureInPicture = useCallback(async () => {
    if (isPiPActive) {
      if (pipWindowRef.current) {
        closePiPWindow();
        return;
      }
      if (document.pictureInPictureElement) {
        try {
          await document.exitPictureInPicture();
        } catch (e) {}
        setIsPiPActive(false);
        return;
      }
    }

    const currentStream = isHost ? localStream : remoteStream;
    const activeVideo = isHost ? localVideoRef.current : remoteVideoRef.current;
    if (!currentStream && !activeVideo) return;

    // 1. Try Document Picture-in-Picture (Chrome 116+ standard for standard compact size)
    if (typeof window !== "undefined" && "documentPictureInPicture" in window) {
      try {
        // Standard compact size: 400px wide x 230px high (standard 16:9 compact PiP)
        const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
          width: 400,
          height: 230,
        });

        pipWindowRef.current = pipWindow;
        setIsPiPActive(true);

        const style = pipWindow.document.createElement("style");
        style.textContent = `
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: #000;
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            width: 100vw;
            height: 100vh;
          }
          .pip-container {
            position: relative;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #000;
          }
          video {
            width: 100%;
            height: 100%;
            object-fit: contain;
          }
          .pip-header {
            position: absolute;
            top: 8px;
            left: 8px;
            display: flex;
            align-items: center;
            pointer-events: none;
            z-index: 10;
          }
          .pip-badge {
            background: rgba(0, 0, 0, 0.75);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: #10b981;
            font-size: 10px;
            font-weight: 800;
            padding: 2px 8px;
            border-radius: 9999px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            display: flex;
            align-items: center;
            gap: 4px;
          }
          .pip-badge span.dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #10b981;
          }
        `;
        pipWindow.document.head.appendChild(style);

        const container = pipWindow.document.createElement("div");
        container.className = "pip-container";

        const pipVideo = pipWindow.document.createElement("video");
        pipVideo.autoplay = true;
        pipVideo.playsInline = true;
        pipVideo.muted = isHost ? true : isMuted;
        pipVideo.srcObject = currentStream;

        const header = pipWindow.document.createElement("div");
        header.className = "pip-header";
        header.innerHTML = `
          <div class="pip-badge">
            <span class="dot"></span>
            ${isHost ? (broadcastSource === "camera" ? "Live Camera" : "Live Screen") : "Live Broadcast"}
          </div>
        `;

        container.appendChild(pipVideo);
        container.appendChild(header);
        pipWindow.document.body.appendChild(container);

        pipVideo.play().catch(() => {});

        pipWindow.addEventListener("pagehide", () => {
          pipWindowRef.current = null;
          setIsPiPActive(false);
        });

        return;
      } catch (err) {
        console.warn("[LocalMeet] Document PiP failed, trying standard video PiP:", err);
      }
    }

    // 2. Standard HTML5 Video Picture-in-Picture fallback
    if (document.pictureInPictureEnabled && activeVideo) {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
          setIsPiPActive(false);
        } else {
          await activeVideo.requestPictureInPicture();
          setIsPiPActive(true);
        }
      } catch (err) {
        console.warn("[LocalMeet] Standard PiP failed:", err);
      }
    }
  }, [isPiPActive, isHost, localStream, remoteStream, broadcastSource, isMuted, closePiPWindow]);

  // Automatic Picture-in-Picture when screen/tab is changed away from NukeChat
  useEffect(() => {
    const handleVisibilityChange = async () => {
      const isActivelyStreaming = isHost ? isScreenSharing : (remoteStream && isHostPresenting);

      if (document.visibilityState === "hidden") {
        if (isActivelyStreaming && !isPiPActive) {
          togglePictureInPicture();
        }
      } else if (document.visibilityState === "visible") {
        if (isPiPActive) {
          closePiPWindow();
          if (document.pictureInPictureElement) {
            try {
              await document.exitPictureInPicture();
            } catch (e) {}
          }
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isHost, isScreenSharing, remoteStream, isHostPresenting, isPiPActive, togglePictureInPicture, closePiPWindow]);

  // Scroll chat to bottom on new message
  useEffect(() => {
    if (isDrawerOpen && drawerTab === "chat") {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isDrawerOpen, drawerTab]);

  // Detect recent hand-raise message for teacher alert toast
  const recentHandRaise = messages
    .filter((m) => m.text?.startsWith("✋ ") && Date.now() - m.timestamp < 10000)
    .slice(-1)[0];

  // Direct join URL for sharing (works seamlessly on WhatsApp, Telegram, SMS, web)
  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/?join=${roomCode}` : "";

  // Share or copy direct join link with native share sheet support
  const handleShareInviteLink = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `Join Local Meet (${roomCode})`,
          text: `Join our local classroom screen broadcast on NukeChat (0 KB external internet):`,
          url: inviteUrl,
        });
        return;
      } catch (err: any) {
        if (err.name === "AbortError") return;
      }
    }

    // Fallback: Copy to clipboard
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch (e) {}
  };

  const handleSendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendMessage(chatInput.trim());
    setChatInput("");
  };

  const handleRaiseHand = () => {
    if (handRaised) return;
    setHandRaised(true);
    onSendMessage(`✋ ${identityName} raised their hand!`);
    setTimeout(() => setHandRaised(false), 8000);
  };

  const handleToggleFullscreen = () => {
    if (!stageContainerRef.current) return;
    if (!document.fullscreenElement) {
      stageContainerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Effective participants merging server and direct LAN discovery (works 100% offline)
  const effectiveParticipants = React.useMemo(() => {
    const map = new Map<string, { id: string; identity: string; avatar: string }>();

    // 1. Server participants
    (participants || []).forEach((p) => {
      if (p.id) map.set(p.id, p);
    });

    // 2. Direct LAN participants discovered over WebRTC DataChannel
    (lanParticipants || []).forEach((p) => {
      if (p.id) map.set(p.id, p);
    });

    // 3. If I am host, purge any stale server participant records matching my identity or previous hostId
    if (isHost) {
      for (const [id, p] of map.entries()) {
        if (id !== mySessionId && (id === hostId || p.identity.toLowerCase() === (identityName || "").toLowerCase())) {
          map.delete(id);
        }
      }
    }

    // 4. Always ensure current self is present
    map.set(mySessionId, {
      id: mySessionId,
      identity: identityName || (isHost ? "Teacher" : "Student"),
      avatar: "",
    });

    return Array.from(map.values());
  }, [participants, lanParticipants, mySessionId, identityName, isHost, hostId]);

  const hostParticipant =
    effectiveParticipants.find((p) => p.id === hostId || (isHost && p.id === mySessionId)) ||
    (isHost ? { id: mySessionId, identity: identityName || "Teacher", avatar: "" } : null);
  const hostName = hostParticipant?.identity || (isHost ? identityName : "Teacher");

  // Joinees / Viewers: strictly students. The Broadcaster/Host must NEVER appear in joinees!
  const joinees = React.useMemo(() => {
    return effectiveParticipants.filter((p) => {
      // 1. Host is never a joinee
      if (isHost) {
        if (p.id === mySessionId || p.id === hostId) return false;
        if (identityName && p.identity.toLowerCase() === identityName.toLowerCase()) return false;
      }
      // 2. Exclude the host participant for students
      if (hostId && p.id === hostId) return false;
      if (hostParticipant && p.id === hostParticipant.id) return false;
      if (hostParticipant && p.identity.toLowerCase() === hostParticipant.identity.toLowerCase()) return false;
      return true;
    });
  }, [effectiveParticipants, isHost, mySessionId, hostId, identityName, hostParticipant]);

  const effectiveViewerCount = isHost ? Math.max(joinees.length, activeViewersCount) : effectiveParticipants.length;

  // Star Topology count: when offline without internet, all active connections are LAN star topology.
  // When online, strictly use measured starViewersCount from WebRTC stats.
  const effectiveStarViewers = isHost
    ? (!isNetworkOnline || !isConnected
        ? activeViewersCount
        : starViewersCount)
    : starViewersCount;

  // Single source of truth for network topology:
  // - For Host: Offline OR any attendee on Star LAN OR all viewers on local network
  // - For Student / Attendee: Their measured connectionTopology is NOT "relay" (i.e. direct "star_lan")
  const isDirectLAN = isHost
    ? (!isNetworkOnline || !isConnected || effectiveStarViewers > 0 || (effectiveViewerCount > 0 && relayViewersCount === 0))
    : (connectionTopology !== "relay");

  // Active hand raises (detected within last 60s)
  const activeHandRaises = new Set<string>();
  const now = Date.now();
  messages.forEach((m) => {
    if (m.text && m.text.includes("raised their hand") && now - (m.timestamp || 0) < 60000) {
      activeHandRaises.add(m.senderName);
    }
  });

  return (
    <div className="flex flex-col h-[100dvh] bg-black text-white select-none overflow-hidden font-sans">
      {/* Top Pure Black Navigation Bar */}
      <header className="h-14 border-b border-neutral-850 bg-black/95 backdrop-blur flex items-center justify-between px-3 sm:px-6 shrink-0 z-20 shadow-md">
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setShowConfirmLeave(true)}
            className="p-2 -ml-2 text-neutral-400 hover:text-white hover:bg-neutral-900 rounded-xl transition-colors active:scale-95"
            title="Leave classroom"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="font-extrabold text-sm sm:text-base tracking-tight text-white font-mono">
              {roomCode}
            </span>

            {/* Direct Join Share Button */}
            <button
              onClick={handleShareInviteLink}
              className="p-1.5 sm:px-2.5 sm:py-1 text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl text-xs font-bold transition-all active:scale-95 shadow-sm"
              title="Share direct join link"
            >
              {copiedLink ? (
                <div className="flex items-center gap-1 text-emerald-400">
                  <Check className="w-3.5 h-3.5" />
                  <span className="text-[11px] hidden sm:inline">Copied!</span>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <Share2 className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-[11px] hidden sm:inline">Share</span>
                </div>
              )}
            </button>
          </div>

          {/* Unified, Single Network Status Badge */}
          <div
            className={`flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-xs font-bold tracking-tight border transition-all ${
              isDirectLAN
                ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
            }`}
            title={
              isDirectLAN
                ? "Direct Local Wi-Fi Mesh • 0 KB internet data"
                : "Cloud Relay"
            }
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isDirectLAN
                  ? "bg-amber-400"
                  : "bg-emerald-400"
              } animate-pulse`}
            />
            <span className="text-[11px] font-semibold">
              {isDirectLAN ? "LAN" : "Relay"}
            </span>
          </div>

          {/* Dual Audience Split Counter for Host */}
          {isHost && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-neutral-900 border border-neutral-850 text-[11px] font-bold">
              <span className="text-amber-300 flex items-center gap-1" title="Direct Star LAN peers (0 KB data)">
                ⭐ {effectiveStarViewers} LAN
              </span>
              <span className="text-neutral-600">|</span>
              <span className="text-indigo-300 flex items-center gap-1" title="Global Cloud Relay peers">
                🌐 {relayViewersCount} Cloud
              </span>
            </div>
          )}
        </div>

        {/* Right Controls (Icon-Focused, Clean & Responsive) */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Audience Counter & Joinees Viewer Button */}
          <button
            type="button"
            onClick={() => {
              if (isDrawerOpen && drawerTab === "people") {
                setIsDrawerOpen(false);
              } else {
                setDrawerTab("people");
                setIsDrawerOpen(true);
              }
            }}
            className={`flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-full font-bold text-xs transition-all active:scale-95 ${
              isDrawerOpen && drawerTab === "people"
                ? "bg-white text-black shadow-md"
                : "bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-200"
            }`}
            title={`View participants (${effectiveViewerCount})`}
          >
            <Users className="w-3.5 h-3.5 text-neutral-400" />
            <span>{effectiveViewerCount}</span>
            <span className="hidden md:inline font-normal text-neutral-400">
              {isHost ? (effectiveViewerCount === 1 ? "Viewer" : "Viewers") : "in Class"}
            </span>
          </button>

          {/* Student Raise Hand Button */}
          {!isHost && (
            <button
              onClick={handleRaiseHand}
              disabled={handRaised}
              className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-full font-bold text-xs transition-all ${
                handRaised
                  ? "bg-amber-500/30 text-amber-300 border border-amber-500/50 animate-pulse"
                  : "bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-200"
              }`}
              title={handRaised ? "Hand Raised! Teacher notified" : "Raise Hand"}
            >
              <Hand className={`w-3.5 h-3.5 ${handRaised ? "text-amber-400 animate-bounce" : "text-amber-400"}`} />
            </button>
          )}

          {/* Q&A Drawer Toggle Button */}
          <button
            type="button"
            onClick={() => {
              if (isDrawerOpen && drawerTab === "chat") {
                setIsDrawerOpen(false);
              } else {
                setDrawerTab("chat");
                setIsDrawerOpen(true);
              }
            }}
            className={`flex items-center gap-1 p-1.5 sm:px-2.5 sm:py-1.5 rounded-full font-bold text-xs transition-all active:scale-95 ${
              isDrawerOpen && drawerTab === "chat"
                ? "bg-white text-black shadow-md"
                : "bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-200"
            }`}
            title="Classroom Q&A"
          >
            <MessageSquare className="w-3.5 h-3.5 text-neutral-400" />
            {messages.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${isDrawerOpen && drawerTab === "chat" ? "bg-black text-white" : "bg-emerald-500 text-black"}`}>
                {messages.length}
              </span>
            )}
          </button>

          {/* Nuke Classroom Button */}
          <button
            onClick={onNukeClick}
            className="flex items-center gap-1 p-1.5 sm:px-2.5 sm:py-1.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 border border-rose-800/60 rounded-full font-bold text-xs transition-colors"
            title="Vote to terminate room"
          >
            <Bomb className="w-3.5 h-3.5" />
            {nukeVotesState.votesCount > 0 && (
              <span className="text-[10px] font-black">
                {nukeVotesState.votesCount}/{nukeVotesState.neededVotes}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Cinema Video Stage */}
        <div ref={stageContainerRef} className="flex-1 flex flex-col bg-black relative overflow-hidden min-h-0">
          {/* Presenter / Viewer Display Area */}
          <div className="flex-1 flex items-center justify-center p-2 sm:p-4 overflow-hidden relative">
            {isHost ? (
              /* HOST / TEACHER VIEW */
              isScreenSharing ? (
                <div className="relative w-full h-full flex items-center justify-center">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    width={480}
                    height={270}
                    className="w-full h-full object-contain rounded-2xl shadow-2xl border border-neutral-800 bg-black"
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                  <div className="absolute top-3 left-3 bg-black/75 backdrop-blur border border-white/10 text-white px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 shadow z-10">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                    <span>{broadcastSource === "camera" ? "Camera" : "Screen"}</span>
                  </div>

                  {/* Real-time Hand-Raise Notification Alert on Teacher's Screen */}
                  {recentHandRaise && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-amber-500 text-black px-4 py-2 rounded-2xl font-black text-xs uppercase tracking-wider flex items-center gap-2 shadow-2xl z-30 animate-bounce">
                      <Hand className="w-4 h-4 fill-current" />
                      <span>{recentHandRaise.senderName} raised hand!</span>
                    </div>
                  )}

                  {/* Mid-call Internet Drop Banner for Host */}
                  {internetState === "offline" && (
                    <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-amber-500 text-black px-4 py-1.5 rounded-2xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-2xl z-30 animate-pulse whitespace-nowrap">
                      <WifiOff className="w-4 h-4" />
                      <span>Internet Disconnected • Local students ({effectiveStarViewers}) streaming offline</span>
                    </div>
                  )}
                </div>
              ) : (
                /* TEACHER PRE-SHARE LOBBY (Compact, Google Meet Style, Never Overflows) */
                <div className="max-w-xs sm:max-w-sm w-full bg-[#111111] border border-neutral-800 p-4 sm:p-6 rounded-3xl shadow-2xl text-white text-center space-y-4 animate-fadeIn">
                  {/* Mode Selector Tabs: Screen vs Camera */}
                  <div className="flex bg-black/80 p-1 rounded-2xl border border-neutral-800">
                    <button
                      type="button"
                      onClick={() => setSelectedBroadcastMode("screen")}
                      className={`flex-1 py-1.5 sm:py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                        selectedBroadcastMode === "screen"
                          ? "bg-white text-black shadow"
                          : "text-neutral-400 hover:text-white"
                      }`}
                    >
                      <ScreenShare className="w-3.5 h-3.5" />
                      Screen
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedBroadcastMode("camera")}
                      className={`flex-1 py-1.5 sm:py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                        selectedBroadcastMode === "camera"
                          ? "bg-white text-black shadow"
                          : "text-neutral-400 hover:text-white"
                      }`}
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Camera
                    </button>
                  </div>

                  <div>
                    <h2 className="text-base sm:text-lg font-black tracking-tight">Classroom Broadcast</h2>
                    <p className="text-[11px] text-neutral-400 mt-0.5">
                      Local Wi-Fi LAN • 0 KB External Data
                    </p>
                  </div>

                  {/* Shareable Direct Join Link Box */}
                  <div className="bg-black/60 border border-neutral-800/90 rounded-2xl p-2.5 flex items-center justify-between gap-2 text-left">
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider block">Invite Link</span>
                      <span className="text-xs text-neutral-200 font-mono truncate block">{inviteUrl}</span>
                    </div>
                    <button
                      onClick={handleShareInviteLink}
                      className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-bold shrink-0 flex items-center gap-1.5 transition-all active:scale-95 border border-neutral-700 shadow-sm"
                      title="Share link"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
                      <span>{copiedLink ? "Copied" : "Share"}</span>
                    </button>
                  </div>

                  {/* Joinees Section in Broadcaster Lobby */}
                  <div className="bg-black/60 border border-neutral-800/90 rounded-2xl p-3 text-left space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <Users className="w-3 h-3 text-indigo-400" />
                        Audience ({effectiveViewerCount})
                      </span>
                      {effectiveViewerCount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setDrawerTab("people");
                            setIsDrawerOpen(true);
                          }}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-wider"
                        >
                          View All
                        </button>
                      )}
                    </div>

                    {joinees.length === 0 ? (
                      effectiveViewerCount > 0 ? (
                        <p className="text-[11px] text-emerald-400 font-medium py-0.5 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          {effectiveViewerCount} viewer(s) connected.
                        </p>
                      ) : (
                        <p className="text-[11px] text-neutral-500 italic py-0.5">
                          No viewers joined yet. Share the invite link above!
                        </p>
                      )
                    ) : (
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                        {joinees.map((j) => {
                          const topo = peerTopologyMap[j.id] || (isNetworkOnline && isConnected ? "relay" : "star_lan");
                          return (
                            <span
                              key={j.id}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-neutral-900 border border-neutral-800 rounded-xl text-xs font-bold text-neutral-200"
                            >
                              {j.avatar ? (
                                <img src={j.avatar} alt={j.identity} className="w-4 h-4 rounded-full" />
                              ) : (
                                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                              )}
                              <span className="truncate max-w-[120px]">{j.identity}</span>
                              <span
                                className={`text-[9px] px-1.5 py-0.2 rounded font-black uppercase ${
                                  topo === "star_lan"
                                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                    : "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                                }`}
                              >
                                {topo === "star_lan" ? "⭐ Star LAN" : "🌐 Relay"}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Offline Hotspot Notice */}
                  {(!isNetworkOnline || !isConnected) && (
                    <div className="p-2.5 bg-amber-950/40 border border-amber-800/60 rounded-2xl text-amber-200 text-xs text-left flex items-start gap-2">
                      <WifiOff className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div className="leading-tight">
                        <span className="font-bold text-[11px] text-amber-300 block">Offline Hotspot / Router Active</span>
                        <span className="text-[10px] text-amber-400/80">Stream will reach devices directly over your local Wi-Fi. 0 KB internet required.</span>
                      </div>
                    </div>
                  )}

                  {/* Broadcast Error Alert */}
                  {broadcastError && (
                    <div className="p-2.5 bg-rose-950/80 border border-rose-800 rounded-2xl text-rose-200 text-xs text-left flex items-start gap-2 animate-fadeIn">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <p className="leading-snug text-[11px]">{broadcastError}</p>
                    </div>
                  )}

                  {/* Circular Control Buttons Row: Mic, Camera Flip (if camera), FPS */}
                  <div className="flex items-center justify-center gap-4 py-1">
                    {/* Microphone Toggle (Icon-focused) */}
                    <div className="flex flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setIncludeMicOption(!includeMicOption)}
                        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                          includeMicOption
                            ? "bg-neutral-800 hover:bg-neutral-700 text-emerald-400 border border-neutral-700 shadow"
                            : "bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40"
                        }`}
                        title={includeMicOption ? "Microphone On (tap to mute)" : "Microphone Muted (tap to unmute)"}
                      >
                        {includeMicOption ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                      </button>
                      <span className="text-[10px] font-bold text-neutral-400">
                        {includeMicOption ? "Mic On" : "Muted"}
                      </span>
                    </div>

                    {/* Camera Flip Button (when in Camera mode) */}
                    {selectedBroadcastMode === "camera" && (
                      <div className="flex flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setSelectedCameraMode(selectedCameraMode === "environment" ? "user" : "environment")}
                          className="w-12 h-12 rounded-full bg-neutral-800 hover:bg-neutral-700 text-white border border-neutral-700 flex items-center justify-center transition-all shadow"
                          title={selectedCameraMode === "environment" ? "Using Back Camera" : "Using Front Camera"}
                        >
                          <RotateCw className="w-5 h-5" />
                        </button>
                        <span className="text-[10px] font-bold text-neutral-400">
                          {selectedCameraMode === "environment" ? "Back" : "Front"}
                        </span>
                      </div>
                    )}

                    {/* Quality / FPS Profile Toggle */}
                    <div className="flex flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setQualityMode(qualityMode === "clarity" ? "motion" : "clarity")}
                        className="w-12 h-12 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 flex items-center justify-center transition-all shadow"
                        title={qualityMode === "clarity" ? "Clarity: 10 FPS (Low Data)" : "Motion: 20 FPS"}
                      >
                        <Sliders className="w-5 h-5 text-indigo-400" />
                      </button>
                      <span className="text-[10px] font-bold text-neutral-400">
                        {qualityMode === "clarity" ? "10 FPS" : "20 FPS"}
                      </span>
                    </div>
                  </div>

                  {/* Single Clean Start Button */}
                  <button
                    onClick={() => {
                      if (selectedBroadcastMode === "screen") {
                        startScreenShare(includeMicOption);
                      } else {
                        startCameraShare(selectedCameraMode, includeMicOption);
                      }
                    }}
                    className="w-full py-3.5 bg-white hover:bg-neutral-200 text-black font-extrabold text-xs sm:text-sm uppercase tracking-wider rounded-2xl shadow-lg active:scale-98 transition-all flex items-center justify-center gap-2"
                  >
                    {selectedBroadcastMode === "screen" ? (
                      <>
                        <ScreenShare className="w-4 h-4 text-black" />
                        Start Screen Share
                      </>
                    ) : (
                      <>
                        <Camera className="w-4 h-4 text-black" />
                        Start Camera Broadcast
                      </>
                    )}
                  </button>
                </div>
              )
            ) : (
              /* STUDENT / VIEWER VIEW */
              remoteStream && isHostPresenting ? (
                <div className="relative w-full h-full flex items-center justify-center group">
                  {/* Instantly fitted video element (zero slow growth) */}
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    muted={isMuted}
                    width={480}
                    height={270}
                    className="w-full h-full object-contain rounded-2xl shadow-2xl border border-neutral-900 bg-black"
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />

                  {/* Stream Health Warning Overlay */}
                  {streamHealth === "interrupted" && (
                    <div className="absolute inset-0 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center text-white z-30 animate-fadeIn">
                      <div className="w-14 h-14 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 mb-3 animate-pulse">
                        <WifiOff className="w-7 h-7" />
                      </div>
                      <h3 className="text-base sm:text-lg font-bold">Connection to Teacher Interrupted</h3>
                      <p className="text-xs text-neutral-400 max-w-sm mt-1 leading-relaxed">
                        The video stream paused because the Wi-Fi connection dropped or was interrupted.
                      </p>
                      <button
                        onClick={retryStudentConnection}
                        className="mt-4 px-5 py-2.5 bg-neutral-100 hover:bg-white text-black font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all active:scale-95 flex items-center gap-2"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Reconnect Now
                      </button>
                    </div>
                  )}

                  {/* Buffering/Packet Pause Indicator */}
                  {streamHealth === "buffering" && (
                    <div className="absolute top-4 right-4 bg-amber-600/90 backdrop-blur text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow z-20 animate-pulse">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Stream Paused • Reconnecting...</span>
                    </div>
                  )}

                  {/* Presenter Minimalist Badge */}
                  <div className="absolute top-3 left-3 bg-black/75 backdrop-blur border border-white/10 text-white px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 shadow z-10">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                    <span className="truncate max-w-[130px] sm:max-w-[180px] font-medium">{hostName}</span>
                  </div>

                  {/* Floating Action Controls on Student Video (Raise Hand, Mute, PiP, Fullscreen) */}
                  <div className="absolute bottom-4 right-4 flex items-center gap-2 opacity-90 group-hover:opacity-100 transition-opacity bg-black/80 backdrop-blur p-1.5 rounded-2xl border border-neutral-800 z-10">
                    <button
                      onClick={handleRaiseHand}
                      disabled={handRaised}
                      className={`p-2 rounded-xl transition-all flex items-center gap-1.5 text-xs font-bold ${
                        handRaised
                          ? "bg-amber-500/30 text-amber-300 border border-amber-500/50"
                          : "text-neutral-300 hover:text-white hover:bg-neutral-800"
                      }`}
                      title={handRaised ? "Hand Raised! Teacher notified" : "Raise Hand"}
                    >
                      <Hand className={`w-4 h-4 ${handRaised ? "text-amber-400 animate-bounce" : "text-amber-400"}`} />
                      <span className="hidden sm:inline text-[11px]">{handRaised ? "Raised" : "Raise Hand"}</span>
                    </button>
                    <button
                      onClick={() => setIsMuted(!isMuted)}
                      className="p-2 text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-xl transition-colors"
                      title={isMuted ? "Unmute" : "Mute"}
                    >
                      {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
                    </button>
                    <button
                      onClick={togglePictureInPicture}
                      className={`p-2 rounded-xl transition-colors ${
                        isPiPActive ? "text-emerald-400 bg-neutral-800" : "text-neutral-300 hover:text-white hover:bg-neutral-800"
                      }`}
                      title="Picture-in-Picture mode (Floating window)"
                    >
                      <PictureInPicture className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleToggleFullscreen}
                      className="p-2 text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-xl transition-colors"
                      title="Fullscreen"
                    >
                      <Maximize className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                /* STUDENT WAITING / BROADCAST STOPPED STATE */
                <div className="max-w-xs sm:max-w-sm w-full bg-[#111111] border border-neutral-800 p-6 rounded-3xl text-center space-y-4 animate-fadeIn">
                  <div className="relative w-14 h-14 mx-auto">
                    <div className="w-14 h-14 bg-neutral-900 rounded-2xl flex items-center justify-center text-neutral-300 border border-neutral-700 shadow-inner">
                      {streamHealth === "ended" ? (
                        <Radio className="w-7 h-7 text-amber-400" />
                      ) : (
                        <ScreenShare className="w-7 h-7 animate-pulse text-emerald-400" />
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-base sm:text-lg font-black text-white">
                      {streamHealth === "ended" ? "Broadcast Paused" : "Classroom Ready"}
                    </h3>
                    <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                      {streamHealth === "ended"
                        ? `Waiting for ${hostName} to resume...`
                        : `Waiting for ${hostName} to broadcast...`}
                    </p>
                  </div>

                  <div className="pt-1 flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      onClick={handleRaiseHand}
                      disabled={handRaised}
                      className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-neutral-200 font-bold text-xs rounded-xl border border-neutral-700 inline-flex items-center gap-1.5 transition-all active:scale-95"
                    >
                      <Hand className={`w-3.5 h-3.5 ${handRaised ? "text-amber-400" : "text-neutral-400"}`} />
                      {handRaised ? "Hand Raised" : "Raise Hand"}
                    </button>

                    <button
                      onClick={handleShareInviteLink}
                      className="px-3.5 py-2 bg-neutral-900 hover:bg-neutral-800 text-neutral-200 font-bold text-xs rounded-xl border border-neutral-700 inline-flex items-center gap-1.5 transition-all active:scale-95"
                      title="Share direct join link with classmates"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5 text-indigo-400" />}
                      <span>{copiedLink ? "Copied" : "Share"}</span>
                    </button>

                    <button
                      onClick={retryStudentConnection}
                      className="px-3.5 py-2 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 text-xs rounded-xl border border-neutral-700 inline-flex items-center gap-1 transition-all"
                      title="Re-check stream connection"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Refresh</span>
                    </button>
                  </div>
                </div>
              )
            )}
          </div>

          {/* Bottom Presenter Toolbar (when host is live) - Iconic Google Meet Style */}
          {isHost && isScreenSharing && (
            <div className="h-16 bg-black/95 border-t border-neutral-850 flex items-center justify-between px-4 sm:px-6 shrink-0 z-10">
              <div className="flex items-center gap-2 sm:gap-3">
                {/* Microphone Toggle (Icon Button) */}
                <button
                  onClick={toggleMic}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    isMicActive
                      ? "bg-neutral-800 hover:bg-neutral-700 text-emerald-400 border border-neutral-700"
                      : "bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40"
                  }`}
                  title={isMicActive ? "Mute Microphone" : "Unmute Microphone"}
                >
                  {isMicActive ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                </button>

                {/* Flip Camera Button (when in Camera mode) */}
                {broadcastSource === "camera" && (
                  <button
                    onClick={switchCameraFacingMode}
                    className="w-10 h-10 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 flex items-center justify-center transition-all"
                    title="Flip camera"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                )}

                {/* Picture-in-Picture Toggle Button for Broadcaster */}
                <button
                  onClick={togglePictureInPicture}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    isPiPActive
                      ? "bg-emerald-600 text-white shadow"
                      : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700"
                  }`}
                  title="Picture-in-Picture (Floating monitor while using other apps)"
                >
                  <PictureInPicture className="w-4 h-4" />
                </button>

                {/* Real-time Stream Metrics */}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-900 border border-neutral-800 rounded-full text-neutral-300 text-xs font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{broadcastSource === "camera" ? `Cam • ${cameraFacingMode === "environment" ? "Back" : "Front"}` : "Screen • 1080p 15 FPS"}</span>
                </div>
              </div>

              <div>
                <button
                  onClick={stopBroadcast}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow transition-all active:scale-95 flex items-center gap-1.5"
                >
                  <X className="w-4 h-4" />
                  <span>Stop Broadcast</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Classroom Side Drawer / Bottom Sheet (Joinees & Q&A) */}
        {isDrawerOpen && (
          <div className="
            absolute md:relative inset-x-0 bottom-0 top-[48%] md:top-0 md:inset-auto
            w-full md:w-88 lg:w-96
            bg-[#0C0C0C] border-t md:border-t-0 md:border-l border-neutral-800
            flex flex-col shrink-0 z-30 shadow-2xl rounded-t-3xl md:rounded-none
            animate-slideUp md:animate-slideLeft
          ">
            {/* Top Tabs Bar: Joinees vs Q&A */}
            <div className="p-2 border-b border-neutral-800 flex items-center justify-between bg-[#111111] rounded-t-3xl md:rounded-none gap-2">
              <div className="flex bg-black/70 p-1 rounded-xl border border-neutral-800 flex-1">
                <button
                  type="button"
                  onClick={() => setDrawerTab("people")}
                  className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    drawerTab === "people"
                      ? "bg-white text-black shadow"
                      : "text-neutral-400 hover:text-white"
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Joinees ({effectiveParticipants.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDrawerTab("chat")}
                  className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    drawerTab === "chat"
                      ? "bg-white text-black shadow"
                      : "text-neutral-400 hover:text-white"
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Q&A</span>
                  {messages.length > 0 && (
                    <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-extrabold ${drawerTab === "chat" ? "bg-black text-white" : "bg-emerald-500 text-black"}`}>
                      {messages.length}
                    </span>
                  )}
                </button>
              </div>

              <button
                onClick={() => setIsDrawerOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors shrink-0"
                title="Close drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content: People / Joinees Tab */}
            {drawerTab === "people" ? (
              <div className="flex-1 p-3 sm:p-4 overflow-y-auto space-y-3">
                {/* Offline Warning if internet or signaling server is disconnected */}
                {(!isNetworkOnline || !isConnected) && (
                  <div className="p-2.5 bg-amber-950/40 border border-amber-800/60 rounded-2xl text-amber-200 text-xs flex items-center gap-2">
                    <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
                    <div className="leading-tight">
                      <p className="font-bold text-[11px] text-amber-300">Offline Local Wi-Fi Active</p>
                      <p className="text-[10px] text-amber-400/80 mt-0.5">Operating directly over router/hotspot with 0 KB internet.</p>
                    </div>
                  </div>
                )}

                {/* Connection Breakdown Summary Card */}
                {isHost ? (
                  isHostPresenting ? (
                    /* Broadcaster: Total breakdown of all live viewers while streaming */
                    <div className="p-3 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-sm space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 font-bold text-sm">
                            ⭐
                          </div>
                          <div>
                            <p className="font-extrabold text-xs text-white">Star Topology (Direct LAN)</p>
                            <p className="text-[10px] text-neutral-400">Same Wi-Fi • 0 KB internet used</p>
                          </div>
                        </div>
                        <div className="px-2.5 py-1 bg-amber-500/20 border border-amber-500/40 rounded-xl text-amber-300 font-extrabold text-xs">
                          {effectiveStarViewers} Watching
                        </div>
                      </div>

                      <div className="pt-2 border-t border-neutral-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-bold text-sm">
                            🌐
                          </div>
                          <div>
                            <p className="font-extrabold text-xs text-white">Cloud Relay (Internet)</p>
                            <p className="text-[10px] text-neutral-400">Different network / 4G / WAN</p>
                          </div>
                        </div>
                        <div className="px-2.5 py-1 bg-indigo-500/20 border border-indigo-500/40 rounded-xl text-indigo-300 font-extrabold text-xs">
                          {relayViewersCount} Watching
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Classroom Lobby: Broadcaster has not started streaming yet */
                    <div className="p-3 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-sm flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-bold text-sm">
                          👥
                        </div>
                        <div>
                          <p className="font-extrabold text-xs text-white">Classroom Audience</p>
                          <p className="text-[10px] text-neutral-400">
                            {effectiveParticipants.length - 1} attendee{effectiveParticipants.length - 1 !== 1 ? "s" : ""} waiting for broadcast
                          </p>
                        </div>
                      </div>
                      <div className="px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl font-bold text-xs">
                        Ready
                      </div>
                    </div>
                  )
                ) : (
                  /* Joinee: ONLY their personal connection status card (NO totals) */
                  <div className="p-3 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-7 h-7 rounded-xl flex items-center justify-center font-bold text-sm border ${
                            connectionTopology === "relay"
                              ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
                              : "bg-amber-500/20 border-amber-500/40 text-amber-300"
                          }`}
                        >
                          {connectionTopology === "relay" ? "🌐" : "⭐"}
                        </div>
                        <div>
                          <p className="font-extrabold text-xs text-white">Your Connection</p>
                          <p className="text-[10px] text-neutral-400">
                            {connectionTopology === "relay"
                              ? "Connected via Cloud Relay"
                              : "Direct local Wi-Fi • 0 KB data"}
                          </p>
                        </div>
                      </div>
                      <div
                        className={`px-2.5 py-1 rounded-xl text-xs font-black uppercase border ${
                          connectionTopology === "relay"
                            ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
                            : "bg-amber-500/20 border-amber-500/40 text-amber-300"
                        }`}
                      >
                        {connectionTopology === "relay" ? "Cloud Relay" : "Star LAN"}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between text-neutral-400 text-xxs font-bold uppercase tracking-wider px-1">
                  <span>In This Classroom ({effectiveParticipants.length})</span>
                  <span className="text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Live
                  </span>
                </div>

                {/* Host / Broadcaster Item */}
                {hostParticipant && (
                  <div className="flex items-center justify-between p-2.5 bg-neutral-900/90 border border-neutral-800 rounded-2xl shadow-sm">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="relative">
                        {hostParticipant.avatar ? (
                          <img src={hostParticipant.avatar} alt={hostParticipant.identity} className="w-8 h-8 rounded-full border border-neutral-700 bg-neutral-800" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-xs text-white">
                            {hostParticipant.identity.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border border-black" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs text-white truncate max-w-[130px]">
                            {hostParticipant.identity}
                          </span>
                          <span className="px-1.5 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[9px] font-black rounded-md uppercase">
                            Host
                          </span>
                          {isHost && (
                            <span className="px-1.5 py-0.5 bg-neutral-800 text-neutral-300 text-[9px] font-bold rounded-md">
                              You
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-neutral-400 block">
                          {isScreenSharing ? "Broadcasting Screen / Camera" : "Classroom Creator"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Joinees & Viewers Section */}
                <div className="pt-2">
                  <span className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider px-1 block mb-2">
                    Joinees & Viewers ({effectiveViewerCount})
                  </span>

                  {joinees.length === 0 ? (
                    effectiveViewerCount > 0 ? (
                      <div className="text-center py-6 text-neutral-500 text-xs bg-neutral-900/40 border border-neutral-800 rounded-2xl p-4">
                        <Users className="w-6 h-6 mx-auto text-emerald-400 mb-2" />
                        <p className="font-bold text-neutral-200">{effectiveViewerCount} Viewer(s) Connected</p>
                        <p className="text-[11px] text-neutral-400 mt-1">Exchanging peer identity over direct local Wi-Fi...</p>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-neutral-500 text-xs bg-neutral-900/40 border border-neutral-800 rounded-2xl p-4">
                        <Users className="w-6 h-6 mx-auto text-neutral-600 mb-2" />
                        <p className="font-bold text-neutral-300">No joinees yet</p>
                        <p className="text-[11px] text-neutral-500 mt-1">Share the invite link so attendees can join.</p>
                        <button
                          onClick={handleShareInviteLink}
                          className="mt-3 px-3.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all active:scale-95 shadow"
                        >
                          <Share2 className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Share Link</span>
                        </button>
                      </div>
                    )
                  ) : (
                    <div className="space-y-1.5">
                      {joinees.map((p) => {
                        const isMe = p.id === mySessionId;
                        const hasHandRaised = activeHandRaises.has(p.identity);
                        return (
                          <div
                            key={p.id}
                            className={`flex items-center justify-between p-2.5 rounded-2xl border transition-all ${
                              hasHandRaised
                                ? "bg-amber-950/40 border-amber-500/50 shadow-sm"
                                : "bg-neutral-900/60 border-neutral-800/80 hover:bg-neutral-900"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="relative">
                                {p.avatar ? (
                                  <img src={p.avatar} alt={p.identity} className="w-8 h-8 rounded-full border border-neutral-700 bg-neutral-800" />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center font-bold text-xs text-neutral-300">
                                    {p.identity.slice(0, 2).toUpperCase()}
                                  </div>
                                )}
                                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border border-black" />
                              </div>
                              <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-xs text-white truncate max-w-[130px]">
                                      {p.identity}
                                    </span>
                                    {isMe && (
                                      <span className="px-1.5 py-0.5 bg-neutral-800 text-neutral-300 text-[9px] font-bold rounded-md">
                                        You
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                  {isHost ? (
                                    /* Broadcaster sees student status */
                                    isHostPresenting ? (
                                      <>
                                        <span
                                          className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${
                                            (peerTopologyMap[p.id] || (isNetworkOnline && isConnected ? "relay" : "star_lan")) === "star_lan"
                                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                              : "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                                          }`}
                                        >
                                          {(peerTopologyMap[p.id] || (isNetworkOnline && isConnected ? "relay" : "star_lan")) === "star_lan"
                                            ? "⭐ Star LAN"
                                            : "🌐 Cloud Relay"}
                                        </span>
                                        <span className="text-[9px] text-neutral-400">
                                          {(peerTopologyMap[p.id] || (isNetworkOnline && isConnected ? "relay" : "star_lan")) === "star_lan"
                                            ? "0 KB Internet"
                                            : "Using Internet"}
                                        </span>
                                      </>
                                    ) : (
                                      <span className="text-[10px] text-neutral-400 font-medium flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                        Ready in Lobby
                                      </span>
                                    )
                                  ) : isMe ? (
                                    /* Joinee sees ONLY their own connection status */
                                    <>
                                      <span
                                        className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${
                                          connectionTopology === "relay"
                                            ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                                            : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                        }`}
                                      >
                                        {connectionTopology === "relay"
                                          ? "🌐 Cloud Relay"
                                          : "⭐ Star LAN (Offline)"}
                                      </span>
                                      <span className="text-[9px] text-neutral-400">
                                        {connectionTopology === "relay"
                                          ? "Using Internet"
                                          : "0 KB Internet"}
                                      </span>
                                    </>
                                  ) : (
                                    /* Joinee viewing other students: NO topology shown, only student label */
                                    <span className="text-[9px] text-neutral-500 font-medium">
                                      Student • In Class
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Hand Raised indicator if active */}
                            {hasHandRaised && (
                              <div className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full text-[10px] font-black animate-pulse shrink-0">
                                <Hand className="w-3 h-3 text-amber-400 fill-current" />
                                <span>Hand Up</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Content: Q&A Chat Tab */
              <>
                {/* Chat Messages Timeline */}
                <div className="flex-1 p-3 sm:p-4 overflow-y-auto space-y-3">
                  {messages.length === 0 ? (
                    <div className="text-center py-8 sm:py-12 text-neutral-500 text-xs">
                      <p className="font-semibold text-neutral-400">No questions yet</p>
                      <p className="text-[10px] mt-1 text-neutral-500">Ask a question or paste code snippets for the teacher.</p>
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isMe = m.senderId === mySessionId;
                      return (
                        <div key={m.messageId} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                          <span className="text-[10px] font-bold text-neutral-400 mb-0.5 px-1">
                            {m.senderName}
                          </span>
                          <div
                            className={`px-3.5 py-2 rounded-2xl text-xs leading-relaxed max-w-[88%] shadow-sm break-words ${
                              isMe
                                ? "bg-neutral-200 text-black font-medium rounded-tr-none"
                                : "bg-[#1A1A1A] text-neutral-200 border border-neutral-800 rounded-tl-none"
                            }`}
                          >
                            <TextMessageBody text={m.text || ""} isMe={isMe} />
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={chatBottomRef} />
                </div>

                {/* Chat Input Box */}
                <form onSubmit={handleSendChatMessage} className="p-3 border-t border-neutral-800 bg-[#111111] flex items-center gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask question or paste code..."
                    className="flex-1 px-3.5 py-2 bg-black border border-neutral-700 text-white rounded-xl text-xs outline-none focus:border-emerald-500 transition-colors placeholder:text-neutral-500"
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim()}
                    className="px-4 py-2 bg-white hover:bg-neutral-200 disabled:opacity-40 text-black font-extrabold text-xs rounded-xl transition-all active:scale-95 shadow-sm"
                  >
                    Send
                  </button>
                </form>
              </>
            )}
          </div>
        )}
      </div>

      {/* Confirm Leave Modal */}
      {showConfirmLeave && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111111] border border-neutral-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl animate-scaleUp text-white">
            <h3 className="text-base font-bold mb-2">Leave Classroom?</h3>
            <p className="text-xs text-neutral-400 mb-6 leading-relaxed">
              You will disconnect from the local screen broadcast.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmLeave(false)}
                className="flex-1 py-2.5 bg-neutral-900 hover:bg-neutral-800 font-bold text-xs text-neutral-300 rounded-xl transition-colors border border-neutral-800"
              >
                Cancel
              </button>
              <button
                onClick={onLeaveClick}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 font-bold text-xs text-white rounded-xl transition-colors"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
