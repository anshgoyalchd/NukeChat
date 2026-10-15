import { useState, useRef, useEffect, useCallback } from "react";
import { DEFAULT_ICE_SERVERS } from "../utils/ice";
import {
  createOfferQrString,
  createAnswerQrString,
  parsePairingQr,
  getOptimalCameraDeviceId,
  getAvailableBackCameras,
} from "../utils/offlinePairing";

export type BroadcastSource = "screen" | "camera" | null;
export type StreamHealth = "idle" | "live" | "buffering" | "interrupted" | "ended";

interface UseLocalMeetProps {
  roomCode?: string;
  sessionId: string;
  hostId: string;
  sendMessage: (type: string, payload: any) => void;
  iceServers?: RTCIceServer[];
  participants?: Array<{ id: string; identity: string; avatar: string }>;
  identityName?: string;
  avatarUrl?: string;
  onDirectChatMessage?: (msg: any) => void;
  isConnected?: boolean;
  isLocalDaemon?: boolean;
  backendUrl?: string;
  onWanRestored?: () => void;
}

export const useLocalMeet = ({
  roomCode = "meet",
  sessionId,
  hostId,
  sendMessage,
  iceServers = DEFAULT_ICE_SERVERS,
  participants = [],
  identityName = "User",
  avatarUrl,
  onDirectChatMessage,
  isConnected = false,
  isLocalDaemon = false,
  backendUrl = import.meta.env.VITE_BACKEND_URL || "https://nuke-chat-backend.ansh-goyalchd.workers.dev",
  onWanRestored,
}: UseLocalMeetProps) => {
  const isHost = sessionId === hostId;
  const onWanRestoredRef = useRef(onWanRestored);
  useEffect(() => {
    onWanRestoredRef.current = onWanRestored;
  }, [onWanRestored]);

  // Local media for Host
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [broadcastSource, setBroadcastSource] = useState<BroadcastSource>(null);
  const [cameraFacingMode, setCameraFacingMode] = useState<"environment" | "user">("environment");
  const [qualityMode, setQualityMode] = useState<"clarity" | "motion">("clarity");
  const [activeViewersCount, setActiveViewersCount] = useState(0);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);

  // Star Topology Tracking: Viewers watching offline through direct Star LAN vs Cloud Relay
  const [peerTopologyMap, setPeerTopologyMap] = useState<Record<string, "star_lan" | "relay">>({});
  const [starViewersCount, setStarViewersCount] = useState(0);
  const [relayViewersCount, setRelayViewersCount] = useState(0);
  const [connectionTopology, setConnectionTopology] = useState<"star_lan" | "relay" | null>(null);
  const [internetState, setInternetState] = useState<"online" | "offline">(
    typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline"
  );
  const internetStateRef = useRef<"online" | "offline">(
    typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline"
  );

  // Automatically synchronize star and relay viewer counts whenever topology map changes
  useEffect(() => {
    let star = 0;
    let relay = 0;
    Object.values(peerTopologyMap).forEach((topo) => {
      if (topo === "star_lan") star++;
      else if (topo === "relay") relay++;
    });
    setStarViewersCount(star);
    setRelayViewersCount(relay);
  }, [peerTopologyMap]);

  // Remote media for Students
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isHostPresenting, setIsHostPresenting] = useState(false);
  const [streamHealth, setStreamHealth] = useState<StreamHealth>("idle");

  // References
  const localStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const activeCameraStreamRef = useRef<MediaStream | null>(null);
  const activeScreenStreamRef = useRef<MediaStream | null>(null);
  const audioMixerContextRef = useRef<AudioContext | null>(null);
  const reconnectTimerRef = useRef<any>(null);
  const retryStudentConnectionRef = useRef<() => void>(() => {});

  // Host maintains connection to each student
  const studentPeersRef = useRef<Record<string, RTCPeerConnection>>({});
  const offlineOfferPeerRef = useRef<RTCPeerConnection | null>(null);

  // Expose WebRTC debug telemetry for automated verification
  if (typeof window !== "undefined") {
    if (isHost) {
      (window as any)._debugHostPcState = () => {
        const peers = Object.entries(studentPeersRef.current).map(([id, pc]) => ({
          id,
          ice: pc.iceConnectionState,
          conn: pc.connectionState,
          sig: pc.signalingState,
          senders: pc.getSenders().map((s) => s.track?.kind),
        }));
        return { isHost: true, peers };
      };
    } else {
      (window as any)._debugJoineePcState = () => {
        const pc = hostPeerRef.current;
        return {
          isHost: false,
          ice: pc?.iceConnectionState,
          conn: pc?.connectionState,
          sig: pc?.signalingState,
          receivers: pc?.getReceivers().map((r) => ({ kind: r.track?.kind, readyState: r.track?.readyState })),
        };
      };
    }
  }

  // LAN DataChannels and Discovered Participants for offline Wi-Fi mode
  const [lanParticipants, setLanParticipants] = useState<Array<{ id: string; identity: string; avatar: string }>>([]);
  const lanParticipantsRef = useRef<Record<string, { id: string; identity: string; avatar: string }>>({});
  const studentDataChannelsRef = useRef<Record<string, RTCDataChannel>>({});
  const hostDataChannelRef = useRef<RTCDataChannel | null>(null);
  const onDirectChatMessageRef = useRef(onDirectChatMessage);
  useEffect(() => {
    onDirectChatMessageRef.current = onDirectChatMessage;
  }, [onDirectChatMessage]);

  // Student maintains single connection to Host
  const hostPeerRef = useRef<RTCPeerConnection | null>(null);

  // Ice servers ref to ensure latest TURN configuration is always used
  const iceServersRef = useRef<RTCIceServer[]>(iceServers);
  useEffect(() => {
    iceServersRef.current = iceServers;
  }, [iceServers]);

  // ICE Candidate Queues to prevent dropped candidates during signaling
  const hostCandidatesQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const studentCandidatesQueueRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const handleSignalRef = useRef<((senderId: string, signal: any) => Promise<void>) | null>(null);

  // Universal Signal Sender: Sends via WebSocket AND direct LAN DataChannel (P2P offline fallback!)
  const sendSignalToPeer = useCallback(
    (targetId: string, signal: any) => {
      // 1. Send via WebSocket
      try {
        sendMessage("SIGNAL", {
          targetId,
          signal,
        });
      } catch (e) {}

      // 2. Also send over direct WebRTC DataChannel if open (enables offline signaling without internet!)
      try {
        if (isHost) {
          const dc = studentDataChannelsRef.current[targetId];
          if (dc && dc.readyState === "open") {
            dc.send(JSON.stringify({ type: "SIGNAL", signal }));
          }
        } else {
          const dc = hostDataChannelRef.current;
          if (dc && dc.readyState === "open") {
            dc.send(JSON.stringify({ type: "SIGNAL", signal }));
          }
        }
      } catch (e) {}
    },
    [sendMessage, isHost]
  );

  // Helper to reliably stop all tracks in a MediaStream so device lights (camera/mic) turn off
  const stopStreamTracks = (stream: MediaStream | null) => {
    if (!stream) return;
    try {
      stream.getTracks().forEach((track) => {
        try {
          track.onended = null;
          track.onmute = null;
          track.onunmute = null;
          track.stop();
          track.enabled = false;
        } catch (e) {}
      });
    } catch (e) {}
  };

  // Keep localStreamRef synchronized
  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  // Clean a student connection (Host side) with Star LAN peer preservation
  const cleanStudentPeer = useCallback(
    (studentId: string, force = false) => {
      const isDirectLan = peerTopologyMap[studentId] === "star_lan";
      // If this is a direct Star LAN peer or pending offline peer, preserve it!
      if ((studentId.startsWith("offline-peer-") || isDirectLan) && !force) {
        return;
      }

      const pc = studentPeersRef.current[studentId];
      if (pc) {
        pc.close();
        delete studentPeersRef.current[studentId];
        delete studentCandidatesQueueRef.current[studentId];
        if (studentDataChannelsRef.current[studentId]) {
          try {
            studentDataChannelsRef.current[studentId].close();
          } catch (e) {}
          delete studentDataChannelsRef.current[studentId];
        }
        delete lanParticipantsRef.current[studentId];
        setLanParticipants(Object.values(lanParticipantsRef.current));
        setPeerTopologyMap((prev) => {
          const next = { ...prev };
          delete next[studentId];
          return next;
        });
        setActiveViewersCount(Object.keys(studentPeersRef.current).length);
      }
    },
    [peerTopologyMap]
  );

  // Synchronize studentPeersRef with authoritative participants list
  useEffect(() => {
    if (!isHost || !participants || participants.length === 0) return;
    // When offline, preserve active direct LAN peers!
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    const currentParticipantIds = new Set(participants.map((p) => p.id));
    Object.keys(studentPeersRef.current).forEach((studentId) => {
      if (studentId.startsWith("offline-peer-")) return;
      if (peerTopologyMap[studentId] === "star_lan") return;
      if (!currentParticipantIds.has(studentId)) {
        cleanStudentPeer(studentId);
      }
    });
  }, [isHost, participants, cleanStudentPeer, peerTopologyMap]);

  // Setup host-side LAN DataChannel for offline metadata & chat exchange
  const setupHostDataChannel = useCallback((studentId: string, dc: RTCDataChannel) => {
    studentDataChannelsRef.current[studentId] = dc;

    dc.onopen = () => {
      console.log(`[LocalMeet] Direct LAN DataChannel opened with student ${studentId}`);
      try {
        dc.send(
          JSON.stringify({
            type: "PEER_IDENTITY",
            senderId: sessionId,
            identity: identityName || "Teacher",
            avatar: avatarUrl || "",
            isHost: true,
          })
        );
      } catch (e) {}
    };

    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "PEER_IDENTITY") {
          console.log(`[LocalMeet] Discovered student over direct LAN: ${msg.identity} (${studentId})`);
          lanParticipantsRef.current[studentId] = {
            id: studentId,
            identity: msg.identity || "Student",
            avatar: msg.avatar || "",
          };
          setLanParticipants(Object.values(lanParticipantsRef.current));
        } else if (msg.type === "CHAT" || msg.type === "HAND_RAISE") {
          if (onDirectChatMessageRef.current) {
            onDirectChatMessageRef.current(msg);
          }
          // Relay to all other students over direct LAN DataChannels
          Object.keys(studentDataChannelsRef.current).forEach((sid) => {
            if (sid !== studentId) {
              const otherDc = studentDataChannelsRef.current[sid];
              if (otherDc && otherDc.readyState === "open") {
                try {
                  otherDc.send(event.data);
                } catch (e) {}
              }
            }
          });
        } else if (msg.type === "SIGNAL" && msg.signal) {
          if (handleSignalRef.current) {
            handleSignalRef.current(studentId, msg.signal);
          }
        }
      } catch (err) {}
    };

    dc.onclose = () => {
      delete studentDataChannelsRef.current[studentId];
      delete lanParticipantsRef.current[studentId];
      setLanParticipants(Object.values(lanParticipantsRef.current));
    };
  }, [sessionId, identityName, avatarUrl]);

  // Helper to determine whether a connection is Star Topology (Direct LAN) or Cloud Relay
  const checkPeerTopology = useCallback(async (pc: RTCPeerConnection): Promise<"star_lan" | "relay"> => {
    try {
      const stats = await pc.getStats();
      let activePair: any = null;
      let selectedPairId: string | null = null;
      const candidates = new Map<string, any>();

      stats.forEach((report) => {
        if (report.type === "transport" && report.selectedCandidatePairId) {
          selectedPairId = report.selectedCandidatePairId;
        }
        if (report.type === "candidate-pair") {
          if (report.selected || report.nominated) {
            activePair = report;
          } else if (!activePair && report.state === "succeeded") {
            activePair = report;
          }
        }
        if (report.type === "local-candidate" || report.type === "remote-candidate") {
          candidates.set(report.id, report);
        }
      });

      if (selectedPairId && stats.get(selectedPairId)) {
        activePair = stats.get(selectedPairId);
      }

      if (activePair) {
        const local = candidates.get(activePair.localCandidateId);
        const remote = candidates.get(activePair.remoteCandidateId);

        const localType = (local?.candidateType || "").toLowerCase();
        const remoteType = (remote?.candidateType || "").toLowerCase();
        const localIp = local?.ip || local?.address;
        const remoteIp = remote?.ip || remote?.address;

        const isPrivateIp = (ip?: string): boolean => {
          if (!ip) return false;
          const clean = ip.trim().replace(/^::ffff:/, "").toLowerCase();
          return (
            clean.startsWith("192.168.") ||
            clean.startsWith("10.") ||
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(clean) ||
            clean.endsWith(".local") ||
            clean === "127.0.0.1" ||
            clean === "localhost" ||
            clean.startsWith("fe80:") ||
            clean.startsWith("fc00:") ||
            clean.startsWith("fd")
          );
        };

        // 1. If either side is using a TURN relay or STUN server-reflexive candidate,
        // it traveled through an external cloud server over the internet.
        if (
          localType === "relay" ||
          remoteType === "relay" ||
          localType === "srflx" ||
          remoteType === "srflx"
        ) {
          return "relay";
        }

        // 2. Direct LAN connection (Star Topology):
        // If both sides are host candidates, they connect directly on the local network adapter
        if (localType === "host" && remoteType === "host") {
          return "star_lan";
        }

        // 3. If both IPs are private LAN IPs
        if (isPrivateIp(localIp) && isPrivateIp(remoteIp)) {
          return "star_lan";
        }

        // 4. If either candidate has an explicit public WAN IP
        if ((localIp && !isPrivateIp(localIp)) || (remoteIp && !isPrivateIp(remoteIp))) {
          return "relay";
        }

        // 5. If localType is host and neither candidate used internet relay/srflx:
        if (localType === "host") {
          return "star_lan";
        }

        return "relay";
      }
    } catch (e) {}

    return "star_lan";
  }, []);

  // HOST: Create connection to a student with TURN relay & pre-gathering pool
  const createHostToStudentConnection = useCallback((studentId: string): RTCPeerConnection => {
    if (studentPeersRef.current[studentId]) {
      cleanStudentPeer(studentId);
    }

    const isOffline = !isConnected || isLocalDaemon || (typeof navigator !== "undefined" && !navigator.onLine);
    const effectiveIce = isOffline ? [] : (iceServersRef.current || iceServers);
    const pc = new RTCPeerConnection({
      iceServers: effectiveIce,
      iceCandidatePoolSize: 2,
    });
    studentPeersRef.current[studentId] = pc;
    studentCandidatesQueueRef.current[studentId] = [];
    setActiveViewersCount(Object.keys(studentPeersRef.current).length);

    // Create direct LAN DataChannel for offline identity exchange, chat, and hand-raise
    try {
      const dc = pc.createDataChannel("localmeet-sync", { ordered: true });
      setupHostDataChannel(studentId, dc);
    } catch (e) {}

    // Attach active tracks if currently presenting (always video first, then audio for m-line consistency)
    if (localStreamRef.current) {
      const vTrack = localStreamRef.current.getVideoTracks()[0];
      const aTrack = localStreamRef.current.getAudioTracks()[0];
      if (vTrack) {
        try { pc.addTrack(vTrack, localStreamRef.current); } catch (e) {}
      }
      if (aTrack) {
        try { pc.addTrack(aTrack, localStreamRef.current); } catch (e) {}
      }
    }

    // Send ICE candidates immediately
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[LocalMeet] Host generated ICE candidate for ${studentId}:`, event.candidate.candidate);
        sendSignalToPeer(studentId, {
          type: "ice-candidate",
          data: event.candidate,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[LocalMeet] Host peer connection to student ${studentId} state:`, pc.iceConnectionState);
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        checkPeerTopology(pc).then((topo) => {
          setPeerTopologyMap((prev) => ({ ...prev, [studentId]: topo }));
        });
      } else if (pc.iceConnectionState === "failed") {
        console.warn(`[LocalMeet] ICE connection failed for student ${studentId}. Waiting 6s grace period...`);
        setTimeout(() => {
          if (studentPeersRef.current[studentId]?.iceConnectionState === "failed") {
            cleanStudentPeer(studentId);
          }
        }, 6000);
      } else if (pc.iceConnectionState === "closed") {
        cleanStudentPeer(studentId);
      }
    };

    return pc;
  }, [iceServers, sendMessage, cleanStudentPeer, setupHostDataChannel, checkPeerTopology]);

  // Setup student-side LAN DataChannel for offline metadata & chat exchange
  const setupStudentDataChannel = useCallback((dc: RTCDataChannel) => {
    hostDataChannelRef.current = dc;

    dc.onopen = () => {
      console.log("[LocalMeet] Student LAN DataChannel opened with Host");
      try {
        dc.send(
          JSON.stringify({
            type: "PEER_IDENTITY",
            senderId: sessionId,
            identity: identityName || "Student",
            avatar: avatarUrl || "",
            isHost: false,
          })
        );
      } catch (e) {}
    };

    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "PEER_IDENTITY") {
          console.log(`[LocalMeet] Student received Host identity over direct LAN: ${msg.identity}`);
          lanParticipantsRef.current[hostId] = {
            id: hostId,
            identity: msg.identity || "Teacher",
            avatar: msg.avatar || "",
          };
          setLanParticipants(Object.values(lanParticipantsRef.current));
        } else if (msg.type === "CHAT" || msg.type === "HAND_RAISE") {
          if (onDirectChatMessageRef.current) {
            onDirectChatMessageRef.current(msg);
          }
        } else if (msg.type === "SIGNAL" && msg.signal) {
          if (handleSignalRef.current) {
            handleSignalRef.current(hostId, msg.signal);
          }
        }
      } catch (err) {}
    };

    dc.onclose = () => {
      hostDataChannelRef.current = null;
    };
  }, [sessionId, hostId, identityName, avatarUrl]);

  // STUDENT: Create connection to the Host with health & failure monitoring
  const createStudentToHostConnection = useCallback((): RTCPeerConnection => {
    if (hostPeerRef.current) {
      hostPeerRef.current.close();
    }

    const isOffline = !isConnected || isLocalDaemon || (typeof navigator !== "undefined" && !navigator.onLine);
    const effectiveIce = isOffline ? [] : (iceServersRef.current || iceServers);
    const pc = new RTCPeerConnection({
      iceServers: effectiveIce,
      iceCandidatePoolSize: 2,
    });
    hostPeerRef.current = pc;
    hostCandidatesQueueRef.current = [];

    // Listen for Host's direct LAN DataChannel
    pc.ondatachannel = (event) => {
      setupStudentDataChannel(event.channel);
    };

    // Send ICE candidates immediately
    pc.onicecandidate = (event) => {
      if (event.candidate && hostId) {
        console.log(`[LocalMeet] Student generated ICE candidate for host:`, event.candidate.candidate);
        sendSignalToPeer(hostId, {
          type: "ice-candidate",
          data: event.candidate,
        });
      }
    };

    // Connection Health Monitor
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log("[LocalMeet] Student ICE state changed:", state);

      if (state === "connected" || state === "completed") {
        setStreamHealth("live");
        checkPeerTopology(pc).then((topo) => {
          setConnectionTopology(topo);
        });
      } else if (state === "failed") {
        console.warn("[LocalMeet] ICE connection failed with Host, triggering reconnect...");
        setStreamHealth("interrupted");
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          retryStudentConnectionRef.current();
        }, 1500);
      } else if (state === "disconnected") {
        console.warn("[LocalMeet] ICE connection temporarily disconnected, waiting 6000ms before retry...");
        setStreamHealth("buffering");
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          if (hostPeerRef.current?.iceConnectionState === "disconnected" || hostPeerRef.current?.iceConnectionState === "failed") {
            retryStudentConnectionRef.current();
          }
        }, 6000);
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log("[LocalMeet] Student PeerConnection state:", state);
      if (state === "connected") {
        setStreamHealth("live");
      } else if (state === "failed") {
        setStreamHealth("interrupted");
      }
    };

    pc.ontrack = (event) => {
      console.log("[LocalMeet] Student received remote track:", event.track.kind, event.track.id);
      
      setRemoteStream((prev) => {
        const newStream = new MediaStream();
        if (prev) {
          prev.getTracks().forEach((t) => {
            if (t.kind !== event.track.kind) {
              newStream.addTrack(t);
            } else if (t.id !== event.track.id) {
              try { t.stop(); } catch (e) {}
            }
          });
        }
        newStream.addTrack(event.track);
        return newStream;
      });

      setIsHostPresenting(true);
      setStreamHealth("live");

      event.track.onmute = () => {
        console.log("[LocalMeet] Remote track muted (idle screen or paused frames)");
      };

      event.track.onunmute = () => {
        console.log("[LocalMeet] Remote track active");
        setIsHostPresenting(true);
        setStreamHealth("live");
        setRemoteStream((prev) => {
          if (!prev || !prev.getTracks().some((t) => t.id === event.track.id)) {
            const s = prev ? new MediaStream(prev.getTracks()) : new MediaStream();
            s.addTrack(event.track);
            return s;
          }
          return prev;
        });
      };

      event.track.onended = () => {
        console.warn("[LocalMeet] Remote track ended by host");
        setStreamHealth("ended");
        setIsHostPresenting(false);
        setRemoteStream(null);
      };
    };

    return pc;
  }, [iceServers, hostId, sendMessage, setupStudentDataChannel, checkPeerTopology, isHost]);

  // Broadcast messages over direct LAN DataChannels (100% offline)
  const broadcastDirectMessage = useCallback(
    (msg: any) => {
      const jsonStr = JSON.stringify(msg);
      if (isHost) {
        Object.values(studentDataChannelsRef.current).forEach((dc) => {
          if (dc && dc.readyState === "open") {
            try {
              dc.send(jsonStr);
            } catch (e) {}
          }
        });
      } else {
        if (hostDataChannelRef.current && hostDataChannelRef.current.readyState === "open") {
          try {
            hostDataChannelRef.current.send(jsonStr);
          } catch (e) {}
        }
      }
    },
    [isHost]
  );

  // Negotiate offer from Host to a specific student
  const sendOfferToStudent = useCallback(async (studentId: string, pc: RTCPeerConnection, iceRestart = false) => {
    try {
      // Prioritize universally supported video codecs (VP8 / H.264)
      if ("getTransceivers" in pc) {
        pc.getTransceivers().forEach((transceiver) => {
          if (
            transceiver.receiver &&
            transceiver.receiver.track &&
            transceiver.receiver.track.kind === "video" &&
            (window as any).RTCRtpReceiver?.getCapabilities
          ) {
            const caps = (window as any).RTCRtpReceiver.getCapabilities("video");
            if (caps?.codecs) {
              const preferred = caps.codecs.filter((c: any) =>
                c.mimeType.toLowerCase() === "video/vp8" || c.mimeType.toLowerCase() === "video/h264"
              );
              if (preferred.length > 0 && transceiver.setCodecPreferences) {
                try {
                  transceiver.setCodecPreferences(preferred);
                } catch (e) {}
              }
            }
          }
        });
      }

      // Ensure active local presentation tracks are attached in consistent m-line order (video then audio)
      if (localStreamRef.current) {
        const transceivers = "getTransceivers" in pc ? pc.getTransceivers() : [];
        const senders = pc.getSenders();
        const sortedTracks = [...localStreamRef.current.getTracks()].sort((a, b) =>
          a.kind === "video" ? -1 : b.kind === "video" ? 1 : 0
        );
        sortedTracks.forEach((track) => {
          const transceiver = transceivers.find(
            (t) =>
              t.receiver?.track?.kind === track.kind ||
              (t.sender.track && t.sender.track.kind === track.kind)
          );
          const existingSender = transceiver
            ? transceiver.sender
            : senders.find((s) => (s.track && s.track.kind === track.kind) || (s as any).kind === track.kind);

          if (existingSender) {
            existingSender.replaceTrack(track).catch(() => {});
          } else {
            try {
              pc.addTrack(track, localStreamRef.current!);
            } catch (e) {}
          }
        });
      }

      const offer = await pc.createOffer({ iceRestart });
      let sdp = offer.sdp || "";
      if (sdp.includes("a=rtpmap:111 opus/48000/2") && !sdp.includes("stereo=1")) {
        sdp = sdp.replace(
          "a=rtpmap:111 opus/48000/2",
          "a=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000"
        );
      }
      const finalOffer = { type: offer.type, sdp };
      await pc.setLocalDescription(finalOffer);

      sendSignalToPeer(studentId, {
        type: "sdp-offer",
        data: finalOffer,
      });
    } catch (err) {
      console.error(`[LocalMeet] Error creating offer for student ${studentId}:`, err);
    }
  }, [sendSignalToPeer]);

  // Public: Retry Connection (for students if connection was interrupted)
  const retryStudentConnection = useCallback(() => {
    if (isHost) return;
    console.log("[LocalMeet] Attempting to reconnect to host:", hostId);
    setStreamHealth("buffering");
    setRemoteStream(null);
    setIsHostPresenting(false);
    if (hostId) {
      createStudentToHostConnection();
      sendSignalToPeer(hostId, {
        type: "reconnect-request",
      });
    }
  }, [isHost, hostId, createStudentToHostConnection, sendSignalToPeer]);

  useEffect(() => {
    retryStudentConnectionRef.current = retryStudentConnection;
  }, [retryStudentConnection]);

  // Sync offline room to Cloudflare DO when online
  const syncOfflineRoomToCloud = useCallback(async () => {
    const isOfflineCreated =
      typeof localStorage !== "undefined" &&
      localStorage.getItem(`nukechat_offline_meet_${roomCode}`) === "true";
    if (isOfflineCreated && isHost) {
      try {
        const hostKey =
          typeof localStorage !== "undefined"
            ? localStorage.getItem(`nukechat_host_key_${roomCode}`)
            : null;
        console.log(`[LocalMeet] Synchronizing offline room ${roomCode} with Cloudflare DO...`);
        const res = await fetch(`${backendUrl}/api/room/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomCode,
            hostKey,
            hostId: sessionId,
            type: "meet",
            expiresAt: Date.now() + 2 * 3600 * 1000,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (data && data.success) {
          console.log(`[LocalMeet] Successfully registered/synchronized offline room ${roomCode} with Cloudflare DO!`);
          localStorage.removeItem(`nukechat_offline_meet_${roomCode}`);
        } else {
          console.warn("[LocalMeet] Cloudflare DO sync response:", data);
        }
      } catch (e) {
        console.warn("[LocalMeet] Auto-registration of offline room deferred:", e);
      }
    }
  }, [isHost, roomCode, sessionId, backendUrl]);

  // Unified WAN Restored handler (called by active probe or window event)
  const handleWanRestored = useCallback(async () => {
    console.log("[LocalMeet] Internet/WAN restored! Reconnecting cloud signaling & remote peers...");
    internetStateRef.current = "online";
    setInternetState("online");

    // 1. If room was started offline, silently publish it to Cloudflare DO so global peers can join
    await syncOfflineRoomToCloud();

    // 2. Trigger WebSocket reconnection to cloud
    if (onWanRestoredRef.current) {
      try {
        onWanRestoredRef.current();
      } catch (e) {
        console.warn("[LocalMeet] Error invoking onWanRestored:", e);
      }
    }

    // 3. Host: Restart ICE for any remote peers that stalled while WAN was down (keep star_lan peers uninterrupted!)
    if (isHost && localStreamRef.current) {
      for (const studentId of Object.keys(studentPeersRef.current)) {
        // Direct Star LAN peers are already fine on local LAN; only remote relay peers need iceRestart
        if (peerTopologyMap[studentId] !== "star_lan") {
          const pc = studentPeersRef.current[studentId];
          if (pc && pc.signalingState !== "closed") {
            console.log(`[LocalMeet] Triggering ICE restart for remote student ${studentId}`);
            await sendOfferToStudent(studentId, pc, true /* iceRestart */);
          }
        }
      }
    }

    // 4. Student: If remote, retry connection to host
    if (!isHost && hostPeerRef.current && connectionTopology !== "star_lan") {
      retryStudentConnectionRef.current();
    }
  }, [isHost, syncOfflineRoomToCloud, peerTopologyMap, connectionTopology, sendOfferToStudent]);

  // Unified WAN Lost handler (called by active probe or window event)
  const handleWanLost = useCallback(() => {
    console.log("[LocalMeet] Internet/WAN disconnected. Star LAN peers remain active without interruption.");
    internetStateRef.current = "offline";
    setInternetState("offline");
    if (!isHost && connectionTopology !== "star_lan") {
      setStreamHealth("interrupted");
    }
  }, [isHost, connectionTopology]);

  // Active WAN probe & browser event listeners
  useEffect(() => {
    let isMounted = true;
    let consecutiveFailures = 0;

    const checkWan = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${backendUrl}/api/ping?t=${Date.now()}`, {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
        });
        clearTimeout(timeoutId);

        if (!isMounted) return;

        if (res.ok) {
          consecutiveFailures = 0;
          if (internetStateRef.current !== "online") {
            console.log("[LocalMeet] Active WAN probe: internet available!");
            handleWanRestored();
          }
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        if (!isMounted) return;
        consecutiveFailures++;
        if (consecutiveFailures >= 2 && internetStateRef.current !== "offline") {
          console.log("[LocalMeet] Active WAN probe: internet disconnected. Star LAN preserved.");
          handleWanLost();
        }
      }
    };

    const intervalId = setInterval(checkWan, 3500);

    const onWindowOnline = () => {
      checkWan();
    };
    const onWindowOffline = () => {
      handleWanLost();
    };

    window.addEventListener("online", onWindowOnline);
    window.addEventListener("offline", onWindowOffline);

    // Initial check on mount
    checkWan();

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      window.removeEventListener("online", onWindowOnline);
      window.removeEventListener("offline", onWindowOffline);
    };
  }, [backendUrl, handleWanRestored, handleWanLost]);

  // Handle incoming signaling messages with candidate queueing
  const handleSignal = useCallback(async (senderId: string, signal: any) => {
    const { type, data } = signal;

    if (isHost) {
      // HOST receives signals from students
      if (type === "reconnect-request") {
        console.log(`[LocalMeet] Student ${senderId} requested reconnection`);
        let pc = studentPeersRef.current[senderId];
        // If student explicitly requested reconnection, their connection was likely reset/recreated.
        // If our current PC is closed, failed, or stuck in non-stable signaling, recreate it cleanly:
        if (!pc || pc.signalingState !== "stable" || pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
          pc = createHostToStudentConnection(senderId);
        }
        await sendOfferToStudent(senderId, pc, true);
        return;
      }

      let pc = studentPeersRef.current[senderId];
      if (!pc) return;

      if (type === "sdp-answer") {
        try {
          if (pc.signalingState !== "have-local-offer") {
            console.log(`[LocalMeet] Skipping stale sdp-answer from ${senderId} (state is ${pc.signalingState})`);
            return;
          }
          await pc.setRemoteDescription(new RTCSessionDescription(data));
          // Drain queued ICE candidates for this student, prioritizing direct LAN host candidates first
          const queue = studentCandidatesQueueRef.current[senderId] || [];
          queue.sort((a, b) => (a.candidate?.includes("typ host") ? -1 : 1));
          while (queue.length > 0) {
            const candidate = queue.shift();
            if (candidate) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (err) {
                console.warn(`[LocalMeet] Failed adding queued student candidate:`, err);
              }
            }
          }
        } catch (e: any) {
          if (e?.message?.includes("m-lines")) {
            console.warn(`[LocalMeet] Student ${senderId} sent answer for superseded offer; awaiting current answer.`);
          } else {
            console.error(`[LocalMeet] Error setting remote description on host for student ${senderId}:`, e);
          }
        }
      } else if (type === "ice-candidate") {
        if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
          if (!studentCandidatesQueueRef.current[senderId]) {
            studentCandidatesQueueRef.current[senderId] = [];
          }
          if (data && data.candidate && data.candidate.includes("typ host")) {
            studentCandidatesQueueRef.current[senderId].unshift(data);
          } else {
            studentCandidatesQueueRef.current[senderId].push(data);
          }
        } else {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data));
          } catch (e) {
            console.warn(`[LocalMeet] Error adding student ICE candidate:`, e);
          }
        }
      }
    } else {
      // STUDENT receives signals from Host
      if (type === "broadcast-stopped") {
        console.log("[LocalMeet] Host broadcast stopped signal received");
        setIsHostPresenting(false);
        setStreamHealth("ended");
        setRemoteStream(null);
        return;
      }

      if (type === "broadcast-started") {
        console.log("[LocalMeet] Host broadcast started/resumed signal received.");
        setIsHostPresenting(true);
        setStreamHealth("live");

        // Check if existing peer connection has active receiver tracks
        const pc = hostPeerRef.current;
        if (pc) {
          const liveTracks = pc.getReceivers()
            .map((r) => r.track)
            .filter((t): t is MediaStreamTrack => Boolean(t && t.readyState !== "ended"));
          const hasVideoTrack = liveTracks.some((t) => t.kind === "video");
          if (hasVideoTrack) {
            console.log(`[LocalMeet] Auto-restored remoteStream with ${liveTracks.length} live tracks from existing connection`);
            setRemoteStream(new MediaStream(liveTracks));
            return;
          }
        }

        // Wait a grace period (1200ms) for in-flight sdp-offer from host's pushTracksToAllStudents
        // before requesting a renegotiation/reconnection
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          const currentPc = hostPeerRef.current;
          const currentLiveTracks = currentPc?.getReceivers()
            .map((r) => r.track)
            .filter((t): t is MediaStreamTrack => Boolean(t && t.readyState !== "ended")) || [];
          if (!currentLiveTracks.some((t) => t.kind === "video")) {
            console.log("[LocalMeet] No live video track arrived after grace period. Auto-requesting host broadcast stream...");
            retryStudentConnectionRef.current();
          }
        }, 1200);
        return;
      }

      let pc = hostPeerRef.current;
      if (!pc) {
        pc = createStudentToHostConnection();
      }
      if (!pc) return;

      if (type === "sdp-offer") {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data));
          // Drain queued ICE candidates from host, prioritizing direct LAN host candidates first
          hostCandidatesQueueRef.current.sort((a, b) => (a.candidate?.includes("typ host") ? -1 : 1));
          while (hostCandidatesQueueRef.current.length > 0) {
            const candidate = hostCandidatesQueueRef.current.shift();
            if (candidate) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (err) {
                console.warn("[LocalMeet] Failed adding queued host candidate:", err);
              }
            }
          }

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          sendSignalToPeer(senderId, {
            type: "sdp-answer",
            data: answer,
          });

          // Check if pc already has live receiver tracks (in case ontrack didn't fire due to existing transceiver)
          const liveTracks = pc.getReceivers()
            .map((r) => r.track)
            .filter((t): t is MediaStreamTrack => Boolean(t && t.readyState === "live"));
          if (liveTracks.length > 0) {
            console.log(`[LocalMeet] Attached ${liveTracks.length} live tracks after sdp-offer`);
            setRemoteStream((prev) => {
              const stream = prev || new MediaStream();
              liveTracks.forEach((t) => {
                if (!stream.getTracks().some((existing) => existing.id === t.id)) {
                  stream.addTrack(t);
                }
              });
              return stream;
            });
            setIsHostPresenting(true);
            setStreamHealth("live");
          }
        } catch (e) {
          console.error("[LocalMeet] Error handling sdp-offer on student:", e);
        }
      } else if (type === "ice-candidate") {
        if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
          if (data && data.candidate && data.candidate.includes("typ host")) {
            hostCandidatesQueueRef.current.unshift(data);
          } else {
            hostCandidatesQueueRef.current.push(data);
          }
        } else {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data));
          } catch (e) {
            console.warn("[LocalMeet] Error adding host ICE candidate:", e);
          }
        }
      }
    }
  }, [isHost, createHostToStudentConnection, createStudentToHostConnection, sendOfferToStudent, sendSignalToPeer]);

  useEffect(() => {
    handleSignalRef.current = handleSignal;
  }, [handleSignal]);

  // Seamless track transmission to all connected students
  const pushTracksToAllStudents = useCallback((stream: MediaStream | null) => {
    const videoTrack = stream ? stream.getVideoTracks()[0] || null : null;
    const audioTrack = stream ? stream.getAudioTracks()[0] || null : null;

    Object.keys(studentPeersRef.current).forEach(async (studentId) => {
      const pc = studentPeersRef.current[studentId];
      if (!pc || pc.signalingState === "closed") return;

      const senders = pc.getSenders();
      const transceivers = "getTransceivers" in pc ? pc.getTransceivers() : [];
      const videoTransceiver = transceivers.find(
        (t) =>
          t.receiver?.track?.kind === "video" ||
          (t.sender.track && t.sender.track.kind === "video")
      );
      const audioTransceiver = transceivers.find(
        (t) =>
          t.receiver?.track?.kind === "audio" ||
          (t.sender.track && t.sender.track.kind === "audio")
      );

      const videoSender = videoTransceiver
        ? videoTransceiver.sender
        : senders.find((s) => (s.track && s.track.kind === "video") || (s as any).kind === "video");
      const audioSender = audioTransceiver
        ? audioTransceiver.sender
        : senders.find((s) => (s.track && s.track.kind === "audio") || (s as any).kind === "audio");

      let needsRenegotiation = false;

      // 1. Video Sender: Replace track seamlessly without tearing down ICE connection
      if (videoSender) {
        try {
          await videoSender.replaceTrack(videoTrack);
        } catch (e) {
          console.warn("[LocalMeet] Error replacing video track:", e);
          needsRenegotiation = true;
        }
      } else if (videoTrack) {
        try {
          pc.addTrack(videoTrack, stream!);
          needsRenegotiation = true;
        } catch (e) {}
      }

      // 2. Audio Sender: Replace track seamlessly
      if (audioSender) {
        try {
          await audioSender.replaceTrack(audioTrack);
        } catch (e) {
          needsRenegotiation = true;
        }
      } else if (audioTrack) {
        try {
          pc.addTrack(audioTrack, stream!);
          needsRenegotiation = true;
        } catch (e) {}
      }

      // Optimize video degradation preference for screen sharing across mobile / WAN
      if (videoSender && "setParameters" in videoSender) {
        try {
          const params = videoSender.getParameters();
          if (params.encodings && params.encodings.length > 0) {
            params.degradationPreference = "maintain-resolution";
            await videoSender.setParameters(params);
          }
        } catch (e) {}
      }

      // If new tracks were attached that require SDP renegotiation:
      if (needsRenegotiation) {
        const isConnected = pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed";
        await sendOfferToStudent(studentId, pc, !isConnected);
      }
    });
  }, [sendOfferToStudent]);

  // HOST: Start Screen Share (properly cleans up any existing camera stream first!)
  const startScreenShare = async (includeMic: boolean = true) => {
    if (!isHost) return;
    setBroadcastError(null);

    // Stop any previous camera hardware stream so the camera light turns off!
    stopStreamTracks(activeCameraStreamRef.current);
    activeCameraStreamRef.current = null;
    stopStreamTracks(activeScreenStreamRef.current);
    activeScreenStreamRef.current = null;
    stopStreamTracks(localStreamRef.current);
    localStreamRef.current = null;

    // Check if getDisplayMedia is supported on this browser
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getDisplayMedia !== "function"
    ) {
      setBroadcastError(
        "Screen sharing is not supported by this mobile browser. Tap 'Broadcast Camera' to stream your blackboard/notes, or open NukeChat from a laptop/PC to share your desktop screen."
      );
      return;
    }

    try {
      let screen: MediaStream;
      try {
        screen = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { max: qualityMode === "clarity" ? 10 : 20, ideal: qualityMode === "clarity" ? 10 : 20 },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      } catch (audioConstraintErr) {
        // Fallback for browsers that only accept boolean audio: true
        screen = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { max: qualityMode === "clarity" ? 10 : 20, ideal: qualityMode === "clarity" ? 10 : 20 },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: true,
        });
      }

      activeScreenStreamRef.current = screen;
      const tracks: MediaStreamTrack[] = [...screen.getVideoTracks()];

      const screenAudioTracks = screen.getAudioTracks();
      const hasScreenAudio = screenAudioTracks.length > 0;

      // Close any previous audio mixer context
      if (audioMixerContextRef.current) {
        try {
          audioMixerContextRef.current.close();
        } catch (e) {}
        audioMixerContextRef.current = null;
      }

      let micStream: MediaStream | null = null;
      if (includeMic) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          micStreamRef.current = micStream;
          setIsMicActive(true);
        } catch (micErr) {
          console.warn("[LocalMeet] Mic unavailable, proceeding without mic:", micErr);
          setIsMicActive(false);
        }
      } else {
        setIsMicActive(false);
      }

      let audioTrackToAdd: MediaStreamTrack | null = null;

      if (hasScreenAudio && micStream && micStream.getAudioTracks().length > 0) {
        // Both screen/video audio AND microphone are active -> mix with Web Audio API
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioContextClass({ sampleRate: 48000 });
          audioMixerContextRef.current = audioCtx;

          if (audioCtx.state === "suspended") {
            try {
              await audioCtx.resume();
            } catch (e) {}
          }

          const dest = audioCtx.createMediaStreamDestination();
          const screenSource = audioCtx.createMediaStreamSource(new MediaStream([screenAudioTracks[0]]));
          screenSource.connect(dest);

          const micSource = audioCtx.createMediaStreamSource(micStream);
          micSource.connect(dest);

          if (audioCtx.state === "running") {
            audioTrackToAdd = dest.stream.getAudioTracks()[0];
            console.log("[LocalMeet] Successfully mixed screen audio and microphone via WebAudio API");
          } else {
            console.warn("[LocalMeet] AudioContext suspended, falling back to direct screen audio track");
            audioTrackToAdd = screenAudioTracks[0];
          }
        } catch (mixErr) {
          console.warn("[LocalMeet] WebAudio mixing failed, using direct screen audio track:", mixErr);
          audioTrackToAdd = screenAudioTracks[0];
        }
      } else if (hasScreenAudio) {
        // Pure digital screen/tab audio (e.g. YouTube / video file playback)
        console.log("[LocalMeet] Using pristine digital screen audio track (zero WebAudio degradation)");
        audioTrackToAdd = screenAudioTracks[0];
      } else if (micStream && micStream.getAudioTracks().length > 0) {
        // Microphone audio only
        console.log("[LocalMeet] Using microphone audio track");
        audioTrackToAdd = micStream.getAudioTracks()[0];
      }

      if (audioTrackToAdd) {
        tracks.push(audioTrackToAdd);
      }

      const combinedStream = new MediaStream(tracks);

      // Handle user clicking native "Stop sharing" bar
      screen.getVideoTracks()[0].onended = () => {
        stopBroadcast();
      };

      setLocalStream(combinedStream);
      localStreamRef.current = combinedStream;
      setIsScreenSharing(true);
      setBroadcastSource("screen");
      setIsHostPresenting(true);

      pushTracksToAllStudents(combinedStream);

      // Notify all students that broadcast has started/resumed so joinees auto-receive stream
      const allStudentIds = new Set([
        ...Object.keys(studentPeersRef.current),
        ...participants.filter((p) => p.id !== sessionId).map((p) => p.id),
        ...Object.keys(lanParticipantsRef.current).filter((id) => id !== sessionId),
      ]);
      allStudentIds.forEach((studentId) => {
        sendSignalToPeer(studentId, {
          type: "broadcast-started",
          data: { source: "screen" },
        });
      });
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        return;
      }
      if (err.name === "NotSupportedError" || err.message?.includes("not supported")) {
        setBroadcastError(
          "Screen sharing is not supported on this mobile device. You can use Camera Mode below to stream your whiteboard/notes, or use a laptop/desktop computer."
        );
      } else {
        setBroadcastError(`Failed to start screen share: ${err.message || "Unknown error"}`);
      }
    }
  };

  // Helper to reliably acquire camera stream across mobile devices (Android Chrome, iOS Safari, desktop)
  const getCameraStream = async (facing: "environment" | "user"): Promise<MediaStream> => {
    const isUser = facing === "user";
    const optimalDeviceId = !isUser ? await getOptimalCameraDeviceId("environment") : undefined;

    // 1. Primary: ideal facingMode with optional optimal back camera sensor
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facing },
          ...(optimalDeviceId ? { deviceId: { ideal: optimalDeviceId } } : {}),
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { max: 20, ideal: 15 },
        },
        audio: false,
      };
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err1) {
      console.warn(`[LocalMeet] Primary camera constraints failed for ${facing}:`, err1);
    }

    // 2. Direct facingMode constraint (standard mobile OS camera routing)
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    } catch (err2) {
      console.warn(`[LocalMeet] Direct facingMode failed for ${facing}:`, err2);
    }

    // 3. Exact facingMode
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: facing } },
        audio: false,
      });
    } catch (err3) {
      console.warn(`[LocalMeet] Exact facingMode failed for ${facing}:`, err3);
    }

    // 4. Fallback to any available video sensor
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  };

  // HOST: Start Camera Broadcast (properly cleans up any previous screen stream first!)
  const startCameraShare = async (
    facingMode: "environment" | "user" = "environment",
    includeMic: boolean = true
  ) => {
    if (!isHost) return;
    setBroadcastError(null);

    // Stop any previous camera or screen streams first
    stopStreamTracks(activeCameraStreamRef.current);
    activeCameraStreamRef.current = null;
    stopStreamTracks(activeScreenStreamRef.current);
    activeScreenStreamRef.current = null;
    stopStreamTracks(localStreamRef.current);
    localStreamRef.current = null;

    try {
      const cameraStream = await getCameraStream(facingMode);
      activeCameraStreamRef.current = cameraStream;

      // Lock optical zoom to 1.0x if available (prevent defaulting to 0.5x ultra-wide sensor)
      const track = cameraStream.getVideoTracks()[0];
      if (track && (track as any).getCapabilities) {
        try {
          const caps = (track as any).getCapabilities();
          if (caps.zoom && typeof (track as any).applyConstraints === "function") {
            const minZoom = typeof caps.zoom.min === "number" ? caps.zoom.min : 1.0;
            await (track as any).applyConstraints({
              advanced: [{ zoom: Math.max(1.0, minZoom) }],
            });
          }
        } catch (e) {}
      }

      // Handle track stop
      cameraStream.getVideoTracks()[0].onended = () => {
        stopBroadcast();
      };

      let micStream: MediaStream | null = null;
      if (includeMic) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          micStreamRef.current = micStream;
          setIsMicActive(true);
        } catch (micErr) {
          console.warn("[LocalMeet] Mic unavailable, proceeding with camera only:", micErr);
          setIsMicActive(false);
        }
      } else {
        setIsMicActive(false);
      }

      const tracks: MediaStreamTrack[] = [...cameraStream.getVideoTracks()];
      if (micStream && micStream.getAudioTracks().length > 0) {
        tracks.push(micStream.getAudioTracks()[0]);
      }

      const combinedStream = new MediaStream(tracks);

      setLocalStream(combinedStream);
      localStreamRef.current = combinedStream;
      setIsScreenSharing(true);
      setBroadcastSource("camera");
      setCameraFacingMode(facingMode);
      setIsHostPresenting(true);

      pushTracksToAllStudents(combinedStream);

      // Notify all students that broadcast has started/resumed so joinees auto-receive stream
      const allStudentIds = new Set([
        ...Object.keys(studentPeersRef.current),
        ...participants.filter((p) => p.id !== sessionId).map((p) => p.id),
        ...Object.keys(lanParticipantsRef.current).filter((id) => id !== sessionId),
      ]);
      allStudentIds.forEach((studentId) => {
        sendSignalToPeer(studentId, {
          type: "broadcast-started",
          data: { source: "camera" },
        });
      });
    } catch (err: any) {
      setBroadcastError(`Camera permission denied or camera unavailable: ${err.message || "Please allow camera access."}`);
    }
  };

  // Switch camera between front and back while broadcasting (preserves audio & replaces video track seamlessly)
  const switchCameraFacingMode = async () => {
    if (!isHost || broadcastSource !== "camera") return;
    setBroadcastError(null);

    const nextMode: "environment" | "user" = cameraFacingMode === "environment" ? "user" : "environment";
    console.log(`[LocalMeet] Switching camera facingMode from ${cameraFacingMode} to ${nextMode}...`);

    // 1. Find existing video and audio tracks
    const oldVideoTrack =
      activeCameraStreamRef.current?.getVideoTracks()[0] ||
      localStreamRef.current?.getVideoTracks()[0];

    // 2. Cleanly stop old video track so mobile camera HAL releases the hardware sensor
    if (oldVideoTrack) {
      oldVideoTrack.onended = null;
      oldVideoTrack.onmute = null;
      oldVideoTrack.onunmute = null;
      try {
        oldVideoTrack.stop();
        oldVideoTrack.enabled = false;
      } catch (e) {}
    }

    // 3. Small pause (80ms) for mobile OS camera HAL to release previous sensor
    await new Promise((resolve) => setTimeout(resolve, 80));

    // 4. Acquire new camera stream with next facing mode
    let newCameraStream: MediaStream;
    try {
      newCameraStream = await getCameraStream(nextMode);
    } catch (err: any) {
      console.error("[LocalMeet] Camera switch error:", err);
      setBroadcastError(`Camera switch failed: ${err.message || "Device unavailable"}`);
      try {
        newCameraStream = await getCameraStream(cameraFacingMode);
      } catch (recoverErr) {
        return;
      }
    }

    const newVideoTrack = newCameraStream.getVideoTracks()[0];
    if (!newVideoTrack) return;

    newVideoTrack.onended = () => {
      stopBroadcast();
    };

    // 5. Preserve existing microphone track so student audio NEVER drops or glitches!
    const existingAudioTrack =
      localStreamRef.current?.getAudioTracks()[0] ||
      micStreamRef.current?.getAudioTracks()[0];

    const tracksToKeep: MediaStreamTrack[] = [newVideoTrack];
    if (existingAudioTrack && existingAudioTrack.readyState === "live") {
      tracksToKeep.push(existingAudioTrack);
    }

    const newCombinedStream = new MediaStream(tracksToKeep);
    activeCameraStreamRef.current = newCombinedStream;
    setLocalStream(newCombinedStream);
    localStreamRef.current = newCombinedStream;
    setCameraFacingMode(nextMode);

    // 6. Seamlessly replace video track on all connected student peers via WebRTC replaceTrack
    pushTracksToAllStudents(newCombinedStream);

    console.log(`[LocalMeet] Camera successfully switched to ${nextMode}`);
  };

  // Cycle through available back camera lenses (e.g. 1x, 2x, 0.5x)
  const cycleCameraLens = async () => {
    if (!isHost || broadcastSource !== "camera") return;
    const backCameras = await getAvailableBackCameras();
    if (backCameras.length <= 1) return;
    const currentTrack = activeCameraStreamRef.current?.getVideoTracks()[0];
    const currentDeviceId = currentTrack?.getSettings()?.deviceId;
    const currentIndex = backCameras.findIndex((c) => c.deviceId === currentDeviceId);
    const nextIndex = (currentIndex + 1) % backCameras.length;
    const nextDevice = backCameras[nextIndex];

    try {
      if (currentTrack) {
        currentTrack.onended = null;
        currentTrack.stop();
      }
      await new Promise((r) => setTimeout(r, 80));

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: { ideal: nextDevice.deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { max: 20, ideal: 15 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const newVTrack = stream.getVideoTracks()[0];
      if (!newVTrack) return;
      newVTrack.onended = () => stopBroadcast();

      const existingAudio = localStreamRef.current?.getAudioTracks()[0] || micStreamRef.current?.getAudioTracks()[0];
      const newStream = new MediaStream([newVTrack, ...(existingAudio && existingAudio.readyState === "live" ? [existingAudio] : [])]);
      activeCameraStreamRef.current = newStream;
      setLocalStream(newStream);
      localStreamRef.current = newStream;
      pushTracksToAllStudents(newStream);
    } catch (e) {}
  };

  // HOST: Stop Broadcast (explicitly stops ALL hardware tracks on all streams)
  const stopBroadcast = () => {
    // Close WebAudio mixer context if active
    if (audioMixerContextRef.current) {
      try {
        audioMixerContextRef.current.close();
      } catch (e) {}
      audioMixerContextRef.current = null;
    }

    stopStreamTracks(activeCameraStreamRef.current);
    activeCameraStreamRef.current = null;
    stopStreamTracks(activeScreenStreamRef.current);
    activeScreenStreamRef.current = null;
    stopStreamTracks(localStreamRef.current);
    localStreamRef.current = null;
    stopStreamTracks(micStreamRef.current);
    micStreamRef.current = null;

    setLocalStream(null);
    setIsScreenSharing(false);
    setIsMicActive(false);
    setBroadcastSource(null);
    setIsHostPresenting(false);

    // Notify each student that broadcast has stopped so their screen unfreezes and resets immediately
    const allStudentIds = new Set([
      ...Object.keys(studentPeersRef.current),
      ...participants.filter((p) => p.id !== sessionId).map((p) => p.id),
      ...Object.keys(lanParticipantsRef.current).filter((id) => id !== sessionId),
    ]);
    allStudentIds.forEach((studentId) => {
      sendSignalToPeer(studentId, {
        type: "broadcast-stopped",
      });
    });

    pushTracksToAllStudents(null);
  };

  // HOST: Toggle Microphone (mutates .enabled on mic track so VIDEO and SCREEN AUDIO are NEVER interrupted)
  const toggleMic = async () => {
    if (!isHost) return;

    // 1. If micStream already exists, toggle its track .enabled state!
    if (micStreamRef.current && micStreamRef.current.getAudioTracks().length > 0) {
      const nextState = !isMicActive;
      micStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = nextState;
      });
      // If no mixer context is running (pure mic audio), also sync localStream's audio tracks
      if (!audioMixerContextRef.current && localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((t) => {
          t.enabled = nextState;
        });
      }
      setIsMicActive(nextState);
      return;
    }

    // 2. If no micStream existed (e.g. started sharing screen without mic), request microphone access
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = mic;
      const micTrack = mic.getAudioTracks()[0];
      micTrack.enabled = true;
      setIsMicActive(true);

      const screenAudioTracks = activeScreenStreamRef.current?.getAudioTracks() || [];
      const hasScreenAudio = screenAudioTracks.length > 0;

      if (hasScreenAudio) {
        // Screen audio is already playing -> mix screen audio + newly enabled mic with Web Audio API!
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioContextClass();
          audioMixerContextRef.current = audioCtx;
          if (audioCtx.state === "suspended") {
            audioCtx.resume().catch(() => {});
          }

          const dest = audioCtx.createMediaStreamDestination();
          const screenSource = audioCtx.createMediaStreamSource(new MediaStream([screenAudioTracks[0]]));
          screenSource.connect(dest);

          const micSource = audioCtx.createMediaStreamSource(mic);
          micSource.connect(dest);

          const mixedTrack = dest.stream.getAudioTracks()[0];

          if (localStreamRef.current) {
            localStreamRef.current.getAudioTracks().forEach((t) => {
              localStreamRef.current?.removeTrack(t);
            });
            localStreamRef.current.addTrack(mixedTrack);
          }
          await pushTracksToAllStudents(localStreamRef.current);
          return;
        } catch (mixErr) {
          console.warn("[LocalMeet] Error mixing mic into existing screen audio:", mixErr);
        }
      }

      // If no screen audio exists (pure mic), attach micTrack directly
      if (localStreamRef.current) {
        localStreamRef.current.addTrack(micTrack);
      }
      await pushTracksToAllStudents(localStreamRef.current);
    } catch (err) {
      console.error("[LocalMeet] Failed to access mic:", err);
    }
  };

  // When a student joins or rejoins the room
  const handleRoomJoined = useCallback(
    (joiningId: string, _identity: string, _avatar: string, participantsList: any[]) => {
      if (isHost) {
        participantsList.forEach((p) => {
          if (p.id !== sessionId) {
            const pc = studentPeersRef.current[p.id];
            const isConnected = pc && (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed");
            const isStale =
              !pc ||
              pc.signalingState === "closed" ||
              pc.iceConnectionState === "failed" ||
              pc.iceConnectionState === "disconnected";

            // If the student is already connected and streaming, NEVER tear down their connection!
            if (isConnected) {
              return;
            }

            // If peer does not exist, or is stale, OR this is the student that just joined/reconnected:
            if (isStale || p.id === joiningId) {
              console.log(`[LocalMeet] Establishing connection & sending broadcast offer to student ${p.id}`);
              const freshPc = createHostToStudentConnection(p.id);
              sendOfferToStudent(p.id, freshPc, isStale);
            }
          }
        });
      } else {
        // STUDENT: Only initiate connection if THIS client itself just joined and is not yet connected
        const currentPc = hostPeerRef.current;
        const isConnected = currentPc && (currentPc.iceConnectionState === "connected" || currentPc.iceConnectionState === "completed");
        if (joiningId === sessionId && hostId && !isConnected) {
          createStudentToHostConnection();
          sendSignalToPeer(hostId, {
            type: "reconnect-request",
          });
        }
      }
    },
    [isHost, sessionId, hostId, createHostToStudentConnection, sendOfferToStudent, createStudentToHostConnection, sendSignalToPeer]
  );

  // When hostId is discovered or changes, connect immediately and request stream
  useEffect(() => {
    if (!isHost && hostId) {
      const currentPc = hostPeerRef.current;
      const isConnected =
        currentPc &&
        (currentPc.iceConnectionState === "connected" ||
          currentPc.iceConnectionState === "completed" ||
          currentPc.connectionState === "connected");
      if (isConnected) {
        console.log("[LocalMeet] Already connected to host. Preserving active stream.");
        return;
      }
      console.log("[LocalMeet] Host discovered as", hostId, "- requesting broadcast stream");
      createStudentToHostConnection();
      sendSignalToPeer(hostId, {
        type: "reconnect-request",
      });
    }
  }, [isHost, hostId, createStudentToHostConnection, sendSignalToPeer]);

  // When Host rejoins or new participants appear without a connection, establish connection
  useEffect(() => {
    if (isHost && participants) {
      participants.forEach((p) => {
        if (p.id !== sessionId) {
          let pc = studentPeersRef.current[p.id];
          if (!pc || pc.signalingState === "closed") {
            pc = createHostToStudentConnection(p.id);
            sendOfferToStudent(p.id, pc);
          }
        }
      });
    }
  }, [isHost, participants, sessionId, createHostToStudentConnection, sendOfferToStudent]);

  // When a peer leaves
  const handlePeerLeft = useCallback((departedId: string) => {
    if (isHost) {
      cleanStudentPeer(departedId);
    } else if (departedId === hostId) {
      // Host left the classroom
      setIsHostPresenting(false);
      setStreamHealth("ended");
      setRemoteStream(null);
      if (hostPeerRef.current) {
        hostPeerRef.current.close();
        hostPeerRef.current = null;
      }
    }
  }, [isHost, hostId, cleanStudentPeer]);

  // Periodically refresh peer topologies for all active student connections (Host side)
  useEffect(() => {
    if (!isHost) return;

    const interval = setInterval(async () => {
      const studentIds = Object.keys(studentPeersRef.current);
      if (studentIds.length === 0) {
        setStarViewersCount(0);
        setRelayViewersCount(0);
        setPeerTopologyMap({});
        return;
      }

      const updatedMap: Record<string, "star_lan" | "relay"> = {};
      let stars = 0;
      let relays = 0;

      for (const sid of studentIds) {
        const pc = studentPeersRef.current[sid];
        if (pc && (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed")) {
          const topo = await checkPeerTopology(pc);
          updatedMap[sid] = topo;
          if (topo === "star_lan") {
            stars += 1;
          } else {
            relays += 1;
          }
        }
      }

      setPeerTopologyMap(updatedMap);
      setStarViewersCount(stars);
      setRelayViewersCount(relays);
    }, 4000);

    return () => clearInterval(interval);
  }, [isHost, checkPeerTopology]);

  // Student checks connection topology to Host
  useEffect(() => {
    if (isHost) return;

    const interval = setInterval(async () => {
      const pc = hostPeerRef.current;
      if (pc && (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed")) {
        const topo = await checkPeerTopology(pc);
        setConnectionTopology(topo);
      } else {
        setConnectionTopology(null);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [isHost, checkPeerTopology]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopBroadcast();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      Object.values(studentPeersRef.current).forEach((pc) => pc.close());
      if (hostPeerRef.current) {
        hostPeerRef.current.close();
      }
    };
  }, []);

  // 1. Host generates QR code string for offline attendee pairing (Zero-Daemon)
  const generateOfflineOfferQr = useCallback(async (targetPeerId = "offline-peer-1"): Promise<string> => {
    // When offline, use empty iceServers so WebRTC gathers local LAN host candidates immediately without STUN timeout
    const pc = new RTCPeerConnection({
      iceServers: [],
    });
    offlineOfferPeerRef.current = pc;
    studentPeersRef.current[targetPeerId] = pc;
    studentCandidatesQueueRef.current[targetPeerId] = [];

    try {
      const dc = pc.createDataChannel("localmeet-sync", { ordered: true });
      setupHostDataChannel(targetPeerId, dc);
    } catch (e) {}

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        setPeerTopologyMap((prev) => ({ ...prev, [targetPeerId]: "star_lan" }));
        setActiveViewersCount(Object.keys(studentPeersRef.current).length);
      }
    };

    const candidateLines: string[] = [];
    const gatheringDonePromise = new Promise<void>((resolve) => {
      pc.onicecandidate = (event) => {
        if (event.candidate && event.candidate.candidate) {
          candidateLines.push(`a=${event.candidate.candidate}`);
          if (event.candidate.candidate.includes("typ host")) {
            setTimeout(() => resolve(), 80);
          }
        } else if (!event.candidate) {
          resolve();
        }
      };

      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") {
          resolve();
        }
      };

      setTimeout(() => resolve(), 800);
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await gatheringDonePromise;

    let finalOfferSdp = pc.localDescription?.sdp || offer.sdp || "";
    if (candidateLines.length > 0) {
      for (const line of candidateLines) {
        if (!finalOfferSdp.includes(line.trim())) {
          finalOfferSdp += line.trim() + "\r\n";
        }
      }
    }
    return createOfferQrString(roomCode, sessionId, finalOfferSdp);
  }, [roomCode, sessionId, setupHostDataChannel]);

  // 2. Student applies Host's Offer QR and generates Answer QR string (Zero-Daemon)
  const applyOfflineOfferAndGenerateAnswerQr = useCallback(
    async (rawQrString: string): Promise<string | null> => {
      try {
        const parsed = await parsePairingQr(rawQrString);
        if (!parsed || parsed.type !== "offer") {
          console.warn("[LocalMeet] Invalid Offer QR code scanned.");
          return null;
        }

        if (hostPeerRef.current) {
          hostPeerRef.current.close();
        }

        const pc = new RTCPeerConnection({
          iceServers: [],
        });
        hostPeerRef.current = pc;

        pc.ondatachannel = (event) => {
          setupStudentDataChannel(event.channel);
        };

        pc.ontrack = (event) => {
          let stream = (event.streams && event.streams[0]) || null;
          if (!stream) {
            stream = new MediaStream([event.track]);
          }
          setRemoteStream((prev) => {
            if (!prev) return stream;
            const exists = prev.getTracks().some((t) => t.id === event.track.id);
            if (!exists) prev.addTrack(event.track);
            return new MediaStream(prev.getTracks());
          });
          setIsHostPresenting(true);
          setStreamHealth("live");
        };

        pc.oniceconnectionstatechange = () => {
          if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
            setStreamHealth("live");
            setConnectionTopology("star_lan");
          }
        };

        const candidateLines: string[] = [];
        const gatheringDonePromise = new Promise<void>((resolve) => {
          pc.onicecandidate = (event) => {
            if (event.candidate && event.candidate.candidate) {
              candidateLines.push(`a=${event.candidate.candidate}`);
              if (event.candidate.candidate.includes("typ host")) {
                setTimeout(() => resolve(), 80);
              }
            } else if (!event.candidate) {
              resolve();
            }
          };

          pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === "complete") {
              resolve();
            }
          };

          setTimeout(() => resolve(), 800);
        });

        await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: parsed.sdp }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await gatheringDonePromise;

        let finalAnswerSdp = pc.localDescription?.sdp || answer.sdp || "";
        if (candidateLines.length > 0) {
          for (const line of candidateLines) {
            if (!finalAnswerSdp.includes(line.trim())) {
              finalAnswerSdp += line.trim() + "\r\n";
            }
          }
        }
        return createAnswerQrString(roomCode, sessionId, finalAnswerSdp);
      } catch (err: any) {
        console.error("[LocalMeet] applyOfflineOfferAndGenerateAnswerQr error:", err);
        return null;
      }
    },
    [roomCode, sessionId, setupStudentDataChannel]
  );

  // 3. Host applies Student's Answer QR string to complete handshake (Zero-Daemon)
  const applyOfflineAnswerQr = useCallback(
    async (rawQrString: string): Promise<boolean> => {
      try {
        const parsed = await parsePairingQr(rawQrString);
        if (!parsed || parsed.type !== "answer") {
          console.warn("[LocalMeet] Invalid Answer QR code scanned:", parsed?.type);
          return false;
        }

        // Find the pending peer connection waiting for an answer
        const pendingPeer =
          offlineOfferPeerRef.current ||
          studentPeersRef.current["offline-peer-1"] ||
          Object.values(studentPeersRef.current).find((p) => p.signalingState === "have-local-offer") ||
          Object.values(studentPeersRef.current)[0];

        if (!pendingPeer) {
          console.warn("[LocalMeet] No pending host peer connection to apply answer to.");
          return false;
        }

        if (pendingPeer.signalingState !== "have-local-offer") {
          console.log("[LocalMeet] Pending peer state:", pendingPeer.signalingState);
          if (pendingPeer.signalingState === "stable") {
            return true;
          }
        }

        await pendingPeer.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: parsed.sdp }));
        const targetSid = parsed.studentId || "offline-peer-1";
        studentPeersRef.current[targetSid] = pendingPeer;
        if (studentDataChannelsRef.current["offline-peer-1"]) {
          studentDataChannelsRef.current[targetSid] = studentDataChannelsRef.current["offline-peer-1"];
        }
        setPeerTopologyMap((prev) => ({ ...prev, [targetSid]: "star_lan" }));
        setActiveViewersCount(Object.keys(studentPeersRef.current).length);
        return true;
      } catch (err: any) {
        console.error("[LocalMeet] applyOfflineAnswerQr failed:", err);
        return false;
      }
    },
    []
  );

  return {
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
    starViewersCount,
    relayViewersCount,
    peerTopologyMap,
    connectionTopology,
    startScreenShare,
    startCameraShare,
    switchCameraFacingMode,
    cycleCameraLens,
    stopBroadcast,
    toggleMic,
    retryStudentConnection,
    handleSignal,
    handleRoomJoined,
    handlePeerLeft,
    lanParticipants,
    broadcastDirectMessage,
    internetState,
    generateOfflineOfferQr,
    applyOfflineOfferAndGenerateAnswerQr,
    applyOfflineAnswerQr,
  };
};
