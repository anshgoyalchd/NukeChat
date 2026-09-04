import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Hand,
  MessageSquare,
  Users,
  Wifi,
  Share2,
  Copy,
  Check,
  Radio,
  Sparkles,
  AlertCircle,
  Volume2,
} from "lucide-react";

// Web Audio synthesizer for pleasant hand-raise notification chime (no external audio files needed)
function playNotificationChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

export default function App() {
  // Navigation & Role State
  const [role, setRole] = useState<"lobby" | "host" | "attendee">("lobby");
  const [roomCode, setRoomCode] = useState<string>("");
  const [inputCode, setInputCode] = useState<string>("");
  const [myIdentity, setMyIdentity] = useState<string>("");
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  // WebSocket & Signaling State
  const [wsConnected, setWsConnected] = useState(false);
  const [participants, setParticipants] = useState<any[]>([]);
  const [handsRaised, setHandsRaised] = useState<Set<string>>(new Set());
  const [myHandRaised, setMyHandRaised] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessageText, setNewMessageText] = useState("");
  const [isQAOpen, setIsQAOpen] = useState(false);
  const [isJoineesOpen, setIsJoineesOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Media & WebRTC State (Host)
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastType, setBroadcastType] = useState<"camera" | "screen" | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [streamQuality, setStreamQuality] = useState<"1080p" | "720p">("1080p");
  const hostVideoRef = useRef<HTMLVideoElement | null>(null);
  const hostStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  // Media & WebRTC State (Attendee)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const [isAutoplayBlocked, setIsAutoplayBlocked] = useState(false);
  const [isAttendeeMuted, setIsAttendeeMuted] = useState(false);
  const attendeeVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const wsRef = useRef<WebSocket | null>(null);

  // Sync host video element with local stream
  useEffect(() => {
    if (hostVideoRef.current && hostStreamRef.current) {
      hostVideoRef.current.srcObject = hostStreamRef.current;
      hostVideoRef.current.play().catch((err) => console.warn("Host play error:", err));
    }
  }, [isBroadcasting, broadcastType]);

  // Sync attendee video element with incoming stream
  useEffect(() => {
    if (attendeeVideoRef.current && remoteStreamRef.current) {
      attendeeVideoRef.current.srcObject = remoteStreamRef.current;
      attendeeVideoRef.current.play().catch((err) => {
        console.warn("[Attendee] Autoplay blocked:", err);
        setIsAutoplayBlocked(true);
      });
    }
  }, [remoteStream]);

  // 1. Initialize random identity
  useEffect(() => {
    const animals = ["Falcon", "Panda", "Otter", "Lion", "Eagle", "Fox", "Dolphin", "Wolf"];
    const adjectives = ["Brave", "Swift", "Silent", "Bright", "Cosmic", "Golden", "Rapid"];
    const rand = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${animals[Math.floor(Math.random() * animals.length)]} ${Math.floor(100 + Math.random() * 900)}`;
    setMyIdentity(rand);

    // Read URL parameters
    const params = new URLSearchParams(window.location.hash.replace("#/?", "").replace("#/", ""));
    const urlRoom = params.get("room") || "";
    const urlHost = params.get("host") === "true";

    if (urlRoom) {
      setRoomCode(urlRoom);
      setInputCode(urlRoom);
      if (urlHost) {
        setRole("host");
      } else {
        setRole("attendee");
      }
    }
  }, []);

  // 2. Auto-Discovery Helper (Probes standard hotspot gateways in parallel)
  const runAutoDiscovery = async () => {
    setIsDiscovering(true);
    setDiscoveryError(null);

    const candidates = [
      window.location.origin,
      "https://192-168-43-1.sslip.io:8443", // Android Hotspot
      "https://172-20-10-1.sslip.io:8443", // iPhone Hotspot
      "https://192-168-1-14.sslip.io:8443", // Local LAN
    ];

    for (const origin of candidates) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1200);
        const res = await fetch(`${origin}/api/discover`, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.roomCode) {
            setRoomCode(data.roomCode);
            setInputCode(data.roomCode);
            setIsDiscovering(false);
            setRole("attendee");
            return;
          }
        }
      } catch (e) {}
    }

    setIsDiscovering(false);
    setDiscoveryError("No offline host found automatically. Please ensure you are connected to the Hotspot Wi-Fi, or enter the 6-digit code.");
  };

  // 3. Connect to WebSocket Signaling Server
  useEffect(() => {
    if (role === "lobby" || !roomCode) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/offline?room=${roomCode}&isHost=${role === "host"}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      ws.send(
        JSON.stringify({
          type: "JOIN",
          room: roomCode,
          identity: myIdentity,
          isHost: role === "host",
        })
      );
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "ROOM_JOINED":
            setParticipants(msg.participants || []);
            if (msg.isBroadcasting && role === "attendee") {
              setIsBroadcasting(true);
              setBroadcastType(msg.broadcastType);
            }
            break;

          case "PEER_JOINED":
            setParticipants((prev) => [...prev.filter((p) => p.id !== msg.peer.id), msg.peer]);
            // If Host is broadcasting and new student joins, send offer to them
            if (role === "host" && hostStreamRef.current) {
              initiateStreamToPeer(msg.peer.id, hostStreamRef.current);
            }
            break;

          case "PEER_LEFT":
            setParticipants((prev) => prev.filter((p) => p.id !== msg.peerId));
            if (peerConnectionsRef.current[msg.peerId]) {
              try {
                peerConnectionsRef.current[msg.peerId].close();
              } catch (e) {}
              delete peerConnectionsRef.current[msg.peerId];
            }
            break;

          case "STREAM_STATUS":
            setIsBroadcasting(msg.payload.isBroadcasting);
            setBroadcastType(msg.payload.broadcastType);
            if (!msg.payload.isBroadcasting) {
              setRemoteStream(null);
              remoteStreamRef.current = null;
              if (attendeeVideoRef.current) {
                attendeeVideoRef.current.srcObject = null;
              }
            }
            break;

          case "HAND_RAISE_UPDATE":
            setHandsRaised((prev) => {
              const next = new Set(prev);
              if (msg.payload.raised) {
                next.add(msg.payload.sessionId);
                playNotificationChime();
              } else {
                next.delete(msg.payload.sessionId);
              }
              return next;
            });
            break;

          case "MESSAGE_BROADCAST":
            setMessages((prev) => [...prev, msg.payload]);
            break;

          case "SIGNAL":
            handleIncomingSignal(msg.senderId, msg.payload.signal);
            break;
        }
      } catch (err) {}
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [role, roomCode, myIdentity]);

  // Candidate queue for in-flight WebRTC negotiation
  const candidatesQueueRef = useRef<Record<string, any[]>>({});

  // 4. WebRTC Signaling Dispatcher
  const handleIncomingSignal = async (senderId: string, signal: any) => {
    let pc = peerConnectionsRef.current[senderId];

    if (!pc || pc.connectionState === "closed" || pc.connectionState === "failed") {
      pc = createPeerConnection(senderId);
      peerConnectionsRef.current[senderId] = pc;
    }

    if (signal.type === "offer") {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));

        // Flush queued ICE candidates
        const queue = candidatesQueueRef.current[senderId] || [];
        while (queue.length > 0) {
          const c = queue.shift();
          if (c) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            } catch (e) {}
          }
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        wsRef.current?.send(
          JSON.stringify({
            type: "SIGNAL",
            targetId: senderId,
            signal: pc.localDescription,
          })
        );
      } catch (err) {
        console.error("Error handling offer:", err);
      }
    } else if (signal.type === "answer") {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        // Flush queued ICE candidates
        const queue = candidatesQueueRef.current[senderId] || [];
        while (queue.length > 0) {
          const c = queue.shift();
          if (c) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            } catch (e) {}
          }
        }
      } catch (err) {
        console.error("Error handling answer:", err);
      }
    } else if (signal.candidate !== undefined) {
      if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
        if (!candidatesQueueRef.current[senderId]) {
          candidatesQueueRef.current[senderId] = [];
        }
        candidatesQueueRef.current[senderId].push(signal);
      } else {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal));
        } catch (e) {}
      }
    }
  };

  const createPeerConnection = (targetId: string): RTCPeerConnection => {
    // 100% Direct LAN (Star Topology) ICE configuration with zero internet
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.cloudflare.com:3478" },
        { urls: "stun:stun.l.google.com:19302" },
      ],
      iceCandidatePoolSize: 0,
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "SIGNAL",
            targetId,
            signal: event.candidate,
          })
        );
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[P2P/LAN] Peer ${targetId} connectionState: ${pc.connectionState}`);
    };

    // Attendee captures remote stream with multi-browser stream/track fallback
    pc.ontrack = (event) => {
      console.log("[P2P/LAN] ontrack received:", event.track.kind, event.streams);
      let targetStream: MediaStream;
      if (event.streams && event.streams[0]) {
        targetStream = event.streams[0];
      } else {
        targetStream = remoteStreamRef.current || new MediaStream();
        targetStream.addTrack(event.track);
      }

      remoteStreamRef.current = targetStream;
      setRemoteStream(new MediaStream(targetStream.getTracks()));

      if (attendeeVideoRef.current) {
        attendeeVideoRef.current.srcObject = targetStream;
        attendeeVideoRef.current.play().catch((err) => {
          console.warn("[P2P/LAN] Autoplay blocked by browser policy:", err);
          setIsAutoplayBlocked(true);
        });
      }
    };

    return pc;
  };

  const initiateStreamToPeer = async (peerId: string, stream: MediaStream) => {
    try {
      let pc = peerConnectionsRef.current[peerId];
      if (pc && pc.connectionState !== "closed" && pc.connectionState !== "failed") {
        // Replace active tracks smoothly
        const senders = pc.getSenders();
        stream.getTracks().forEach((track) => {
          const sender = senders.find((s) => s.track?.kind === track.kind);
          if (sender) {
            sender.replaceTrack(track);
          } else {
            pc.addTrack(track, stream);
          }
        });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        wsRef.current?.send(
          JSON.stringify({
            type: "SIGNAL",
            targetId: peerId,
            signal: pc.localDescription,
          })
        );
        return;
      }

      if (pc) {
        try {
          pc.close();
        } catch (e) {}
      }

      pc = createPeerConnection(peerId);
      peerConnectionsRef.current[peerId] = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      wsRef.current?.send(
        JSON.stringify({
          type: "SIGNAL",
          targetId: peerId,
          signal: pc.localDescription,
        })
      );
    } catch (err) {
      console.error("Failed to initiate stream to peer:", peerId, err);
    }
  };

  // 5. Host Broadcasting Actions
  const startBroadcast = async (type: "camera" | "screen") => {
    try {
      let stream: MediaStream;

      if (type === "screen") {
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });
        } catch (audioErr) {
          console.warn("Screen share with audio failed or cancelled, falling back to video only:", audioErr);
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
          });
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: true,
        });
      }

      hostStreamRef.current = stream;
      setIsBroadcasting(true);
      setBroadcastType(type);

      // Explicitly set on host video element immediately if mounted
      if (hostVideoRef.current) {
        hostVideoRef.current.srcObject = stream;
        hostVideoRef.current.play().catch((e) => console.warn("Host play failed:", e));
      }

      // Notify classroom via WebSocket
      wsRef.current?.send(
        JSON.stringify({
          type: "BROADCAST_STATUS",
          payload: { isBroadcasting: true, broadcastType: type },
        })
      );

      // Connect all active student peer connections
      participants.forEach((p) => {
        if (!p.isHost && p.id) {
          initiateStreamToPeer(p.id, stream);
        }
      });

      // Handle user stopping stream via browser native UI ("Stop sharing" bar)
      stream.getVideoTracks()[0].onended = () => {
        stopBroadcast();
      };
    } catch (err: any) {
      alert(`Could not start ${type}: ${err.message || "Permission denied"}`);
    }
  };

  const stopBroadcast = () => {
    if (hostStreamRef.current) {
      hostStreamRef.current.getTracks().forEach((t) => t.stop());
      hostStreamRef.current = null;
    }
    if (hostVideoRef.current) {
      hostVideoRef.current.srcObject = null;
    }
    setIsBroadcasting(false);
    setBroadcastType(null);

    wsRef.current?.send(
      JSON.stringify({
        type: "BROADCAST_STATUS",
        payload: { isBroadcasting: false, broadcastType: null },
      })
    );
  };

  // 6. Interactive Classroom Actions (Hand-Raise & Q&A)
  const toggleHandRaise = () => {
    const next = !myHandRaised;
    setMyHandRaised(next);
    wsRef.current?.send(
      JSON.stringify({
        type: "HAND_RAISE",
        payload: { raised: next },
      })
    );
  };

  const sendQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessageText.trim() || !wsRef.current) return;

    wsRef.current.send(
      JSON.stringify({
        type: "MESSAGE_SENT",
        payload: { text: newMessageText.trim() },
      })
    );
    setNewMessageText("");
  };

  const copyInviteLink = () => {
    const url = `${window.location.origin}/#/?room=${roomCode}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // -------------------------------------------------------------
  // RENDER: 1. Lobby & Subnet Discovery Screen
  // -------------------------------------------------------------
  if (role === "lobby") {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-6 md:p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-black uppercase mb-3">
              <Wifi className="w-3.5 h-3.5" />
              100% Offline Star LAN
            </div>
            <h1 className="text-3xl font-black tracking-tight">OfflineMeet</h1>
            <p className="text-neutral-400 text-xs mt-1">High-definition classroom broadcasting with 0 KB internet consumption.</p>
          </div>

          {/* Auto-Discover Action */}
          <div className="space-y-4">
            <button
              onClick={runAutoDiscovery}
              disabled={isDiscovering}
              className="w-full py-3.5 px-4 bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-sm uppercase tracking-wider rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              {isDiscovering ? (
                <>
                  <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  <span>Probing Hotspot Wi-Fi...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Auto-Detect Classroom Host</span>
                </>
              )}
            </button>

            {discoveryError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-xl flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{discoveryError}</span>
              </div>
            )}

            <div className="relative flex items-center justify-center py-2">
              <div className="border-t border-neutral-800 w-full" />
              <span className="bg-neutral-900 px-3 text-[10px] text-neutral-500 font-bold uppercase tracking-widest absolute">or enter code</span>
            </div>

            {/* Manual Code Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (inputCode.trim().length === 6) {
                  setRoomCode(inputCode.trim());
                  setRole("attendee");
                }
              }}
              className="space-y-3"
            >
              <input
                type="text"
                maxLength={6}
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.replace(/\D/g, ""))}
                placeholder="6-Digit Code"
                className="w-full text-center text-2xl font-mono font-black tracking-widest py-3 bg-neutral-950 border border-neutral-800 rounded-2xl text-amber-400 focus:outline-none focus:border-amber-500 transition-colors"
              />
              <button
                type="submit"
                disabled={inputCode.trim().length !== 6}
                className="w-full py-3 px-4 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-2xl transition-all"
              >
                Join As Student
              </button>
            </form>

            {/* Host Launcher */}
            <div className="pt-2 text-center">
              <button
                onClick={() => {
                  const newCode = Math.floor(100000 + Math.random() * 900000).toString();
                  setRoomCode(newCode);
                  setRole("host");
                }}
                className="text-xs text-neutral-400 hover:text-white font-semibold transition-colors"
              >
                I am the Teacher / Presenter (Start Broadcast) ↗
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDER: 2. Host / Attendee Classroom Interface
  // -------------------------------------------------------------
  const isHost = role === "host";
  const effectiveViewers = Math.max(0, participants.length - (isHost ? 1 : 0));

  return (
    <div className="h-screen max-h-screen w-screen bg-black text-white flex flex-col select-none overflow-hidden">
      {/* Top Header Bar */}
      <header className="h-14 px-4 border-b border-neutral-800/80 bg-neutral-950/80 backdrop-blur flex items-center justify-between shrink-0 z-20">
        {/* Left: Brand & Network Badge */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center font-black text-amber-400 text-sm">
            ⚡
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-sm tracking-tight">{isHost ? "Classroom Stage" : "OfflineMeet"}</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 font-black text-[10px] uppercase">
                Direct LAN
              </span>
            </div>
          </div>
        </div>

        {/* Center: Room Code Pill */}
        <div className="flex items-center gap-2">
          <div className="px-3 py-1 bg-neutral-900 border border-neutral-800 rounded-xl flex items-center gap-2">
            <span className="text-[10px] text-neutral-400 font-bold uppercase">Room</span>
            <span className="text-sm font-mono font-black text-amber-400">{roomCode}</span>
            <button onClick={copyInviteLink} className="text-neutral-400 hover:text-white transition-colors">
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Right: Actions (Roster & Q&A) */}
        <div className="flex items-center gap-2">
          {/* Hand Raise Counter */}
          {handsRaised.size > 0 && (
            <button
              onClick={() => setIsJoineesOpen(true)}
              className="px-2.5 py-1 bg-amber-500/20 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-black flex items-center gap-1.5 animate-pulse"
            >
              <Hand className="w-3.5 h-3.5" />
              <span>{handsRaised.size}</span>
            </button>
          )}

          {/* Attendees Button */}
          <button
            onClick={() => setIsJoineesOpen(!isJoineesOpen)}
            className="px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl text-xs font-bold text-neutral-200 flex items-center gap-1.5 transition-all"
          >
            <Users className="w-3.5 h-3.5 text-neutral-400" />
            <span>{effectiveViewers}</span>
          </button>

          {/* Q&A Button */}
          <button
            onClick={() => setIsQAOpen(!isQAOpen)}
            className="px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl text-xs font-bold text-neutral-200 flex items-center gap-1.5 transition-all relative"
          >
            <MessageSquare className="w-3.5 h-3.5 text-neutral-400" />
            <span>Q&A</span>
            {messages.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-indigo-500 absolute -top-0.5 -right-0.5 animate-ping" />
            )}
          </button>
        </div>
      </header>

      {/* Main Presentation Stage */}
      <main className="flex-1 min-h-0 flex flex-col items-center justify-center p-4 relative overflow-hidden">
        {isHost ? (
          /* Host Broadcasting Stage */
          <div className="w-full h-full max-w-6xl max-h-[78vh] bg-neutral-900/60 border border-neutral-800 rounded-3xl overflow-hidden relative flex flex-col items-center justify-center shadow-2xl">
            {isBroadcasting ? (
              <video
                ref={(el) => {
                  hostVideoRef.current = el;
                  if (el && hostStreamRef.current) {
                    el.srcObject = hostStreamRef.current;
                    el.play().catch((e) => console.warn("Host play error:", e));
                  }
                }}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-contain bg-black rounded-2xl"
              />
            ) : (
              <div className="text-center p-8 max-w-md">
                <div className="w-16 h-16 rounded-3xl bg-neutral-800/80 border border-neutral-700/80 flex items-center justify-center mx-auto mb-4 text-neutral-400">
                  <Radio className="w-8 h-8 text-amber-400" />
                </div>
                <h2 className="text-xl font-black mb-1">Classroom Ready</h2>
                <p className="text-neutral-400 text-xs mb-6">
                  {effectiveViewers} student{effectiveViewers !== 1 ? "s" : ""} waiting in Star LAN lobby. Select a source to begin 1080p broadcast.
                </p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => startBroadcast("screen")}
                    className="px-5 py-3 bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs uppercase tracking-wider rounded-2xl shadow-lg transition-all active:scale-95 flex items-center gap-2"
                  >
                    <Monitor className="w-4 h-4" />
                    <span>Share Screen</span>
                  </button>
                  <button
                    onClick={() => startBroadcast("camera")}
                    className="px-5 py-3 bg-neutral-800 hover:bg-neutral-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-2xl shadow-lg transition-all active:scale-95 flex items-center gap-2"
                  >
                    <Video className="w-4 h-4" />
                    <span>Start Camera</span>
                  </button>
                </div>
              </div>
            )}

            {/* Floating Broadcaster Controls Bar */}
            {isBroadcasting && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-neutral-950/90 border border-neutral-800 backdrop-blur px-4 py-2 rounded-2xl flex items-center gap-3 shadow-2xl">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-400 px-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                  <span>ON AIR ({broadcastType?.toUpperCase()})</span>
                </div>
                <div className="h-4 w-[1px] bg-neutral-800" />
                <button
                  onClick={stopBroadcast}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition-all"
                >
                  Stop Stream
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Attendee Live Player Stage */
          <div className="w-full h-full max-w-6xl max-h-[78vh] bg-neutral-900/60 border border-neutral-800 rounded-3xl overflow-hidden relative flex flex-col items-center justify-center shadow-2xl">
            {remoteStream ? (
              <div className="w-full h-full relative flex items-center justify-center bg-black">
                <video
                  ref={(el) => {
                    attendeeVideoRef.current = el;
                    if (el && remoteStreamRef.current) {
                      el.srcObject = remoteStreamRef.current;
                      el.play().catch((err) => {
                        console.warn("[Attendee] Autoplay blocked:", err);
                        setIsAutoplayBlocked(true);
                      });
                    }
                  }}
                  autoPlay
                  playsInline
                  muted={isAttendeeMuted}
                  className="w-full h-full object-contain bg-black"
                />

                {/* Autoplay Blocked Banner */}
                {isAutoplayBlocked && (
                  <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 z-20">
                    <button
                      onClick={() => {
                        if (attendeeVideoRef.current) {
                          attendeeVideoRef.current.muted = false;
                          attendeeVideoRef.current
                            .play()
                            .then(() => {
                              setIsAutoplayBlocked(false);
                              setIsAttendeeMuted(false);
                            })
                            .catch(() => {
                              attendeeVideoRef.current!.muted = true;
                              attendeeVideoRef.current!.play();
                              setIsAttendeeMuted(true);
                              setIsAutoplayBlocked(false);
                            });
                        }
                      }}
                      className="px-6 py-3.5 bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-sm uppercase tracking-wider rounded-2xl shadow-2xl transition-all active:scale-95 flex items-center gap-2.5 animate-bounce"
                    >
                      <Volume2 className="w-5 h-5" />
                      <span>Click to Play Broadcast</span>
                    </button>
                    <p className="text-neutral-400 text-xs mt-3">Browser requires interaction to begin stream audio</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center p-8 max-w-md">
                <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto mb-4 text-amber-400">
                  <Wifi className="w-8 h-8 animate-pulse" />
                </div>
                <h2 className="text-xl font-black mb-1">Waiting for Host Broadcast</h2>
                <p className="text-neutral-400 text-xs mb-4">
                  Connected directly over Star LAN. As soon as the teacher shares their screen or camera, your stream will start automatically.
                </p>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>0 KB Internet Data Used</span>
                </div>
              </div>
            )}

            {/* Attendee Floating Action Controls */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-neutral-950/90 border border-neutral-800 backdrop-blur px-4 py-2 rounded-2xl flex items-center gap-3 shadow-2xl z-10">
              <button
                onClick={toggleHandRaise}
                className={`px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center gap-2 transition-all ${
                  myHandRaised
                    ? "bg-amber-500 text-black shadow-lg animate-pulse"
                    : "bg-neutral-800 hover:bg-neutral-700 text-white"
                }`}
              >
                <Hand className="w-4 h-4" />
                <span>{myHandRaised ? "Hand Raised ✋" : "Raise Hand"}</span>
              </button>

              {remoteStream && (
                <button
                  onClick={() => {
                    if (attendeeVideoRef.current) {
                      const next = !attendeeVideoRef.current.muted;
                      attendeeVideoRef.current.muted = next;
                      setIsAttendeeMuted(next);
                    }
                  }}
                  className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                    isAttendeeMuted
                      ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                      : "bg-neutral-800 hover:bg-neutral-700 text-neutral-200"
                  }`}
                  title={isAttendeeMuted ? "Unmute Audio" : "Mute Audio"}
                >
                  <Volume2 className="w-4 h-4" />
                  <span>{isAttendeeMuted ? "Muted" : "Sound On"}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Slide-Over Joinees Drawer */}
      {isJoineesOpen && (
        <div className="fixed inset-y-0 right-0 w-80 bg-neutral-950 border-l border-neutral-800 z-30 p-4 flex flex-col shadow-2xl">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
            <h3 className="font-extrabold text-sm">Classroom Roster ({participants.length})</h3>
            <button onClick={() => setIsJoineesOpen(false)} className="text-xs text-neutral-400 hover:text-white">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto py-3 space-y-2">
            {participants.map((p) => {
              const isHandUp = handsRaised.has(p.id);
              return (
                <div
                  key={p.id}
                  className={`p-2.5 rounded-xl border flex items-center justify-between ${
                    isHandUp ? "bg-amber-500/10 border-amber-500/40" : "bg-neutral-900 border-neutral-800"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-neutral-800 flex items-center justify-center text-xs font-bold">
                      {p.identity ? p.identity[0] : "A"}
                    </div>
                    <span className="text-xs font-bold truncate">{p.identity || p.name}</span>
                  </div>
                  {isHandUp && <span className="text-amber-400 text-sm">✋</span>}
                  {p.isHost && (
                    <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 text-[9px] font-black rounded uppercase">Host</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Slide-Over Q&A Drawer */}
      {isQAOpen && (
        <div className="fixed inset-y-0 right-0 w-80 bg-neutral-950 border-l border-neutral-800 z-30 p-4 flex flex-col shadow-2xl">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
            <h3 className="font-extrabold text-sm">Q&A Chat ({messages.length})</h3>
            <button onClick={() => setIsQAOpen(false)} className="text-xs text-neutral-400 hover:text-white">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto py-3 space-y-3">
            {messages.length === 0 ? (
              <p className="text-xs text-neutral-500 text-center py-8">No questions asked yet.</p>
            ) : (
              messages.map((m) => (
                <div key={m.messageId} className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
                  <div className="flex items-center justify-between text-[10px] text-neutral-400 mb-1">
                    <span className="font-bold text-neutral-200">{m.senderName}</span>
                    <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <p className="text-xs text-neutral-100">{m.text}</p>
                </div>
              ))
            )}
          </div>
          <form onSubmit={sendQuestion} className="pt-3 border-t border-neutral-800 flex gap-2">
            <input
              type="text"
              value={newMessageText}
              onChange={(e) => setNewMessageText(e.target.value)}
              placeholder="Ask a question..."
              className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
            />
            <button type="submit" className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold">
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
