import { useState, useRef, useEffect, useCallback } from "react";
import { DEFAULT_ICE_SERVERS } from "../utils/ice";

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
}: UseLocalMeetProps) => {
  const isHost = sessionId === hostId;

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
  const reconnectTimerRef = useRef<any>(null);
  const retryStudentConnectionRef = useRef<() => void>(() => {});

  // Host maintains connection to each student
  const studentPeersRef = useRef<Record<string, RTCPeerConnection>>({});

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

  // Helper to reliably stop all tracks in a MediaStream so device lights (camera/mic) turn off
  const stopStreamTracks = (stream: MediaStream | null) => {
    if (!stream) return;
    try {
      stream.getTracks().forEach((track) => {
        try {
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
      // If this is a direct Star LAN peer and internet was lost, preserve it!
      if (isDirectLan && typeof navigator !== "undefined" && !navigator.onLine && !force) {
        console.log(`[LocalMeet] Preserving direct Star LAN peer ${studentId} while offline.`);
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

    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current || iceServers,
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

    // Attach active tracks if currently presenting
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // Prioritize direct LAN connection (Star Topology) first over public internet
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const isHostCandidate = event.candidate.candidate.includes("typ host");
        if (isHostCandidate) {
          // Priority 1: Direct LAN Star Topology (no internet). Send IMMEDIATELY!
          sendMessage("SIGNAL", {
            targetId: studentId,
            signal: {
              type: "ice-candidate",
              data: event.candidate,
            },
          });
        } else {
          // Non-host (srflx/relay): Delay by 1000ms to give priority to direct LAN host pairing.
          // After 1000ms, always send so WAN/Cellular peers connect smoothly without hanging.
          setTimeout(() => {
            const currentPc = studentPeersRef.current[studentId];
            if (currentPc && currentPc.signalingState !== "closed") {
              sendMessage("SIGNAL", {
                targetId: studentId,
                signal: {
                  type: "ice-candidate",
                  data: event.candidate,
                },
              });
            }
          }, 1000);
        }
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

    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current || iceServers,
      iceCandidatePoolSize: 2,
    });
    hostPeerRef.current = pc;
    hostCandidatesQueueRef.current = [];

    // Listen for Host's direct LAN DataChannel
    pc.ondatachannel = (event) => {
      setupStudentDataChannel(event.channel);
    };

    // Pre-allocate receive transceivers for audio and video
    try {
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
    } catch (e) {}

    pc.onicecandidate = (event) => {
      if (event.candidate && hostId) {
        const isHostCandidate = event.candidate.candidate.includes("typ host");
        if (isHostCandidate) {
          // Priority 1: Direct LAN Star Topology (no internet). Send IMMEDIATELY!
          sendMessage("SIGNAL", {
            targetId: hostId,
            signal: {
              type: "ice-candidate",
              data: event.candidate,
            },
          });
        } else {
          // Non-host candidate: delay by 1000ms to allow direct local connection first!
          setTimeout(() => {
            if (hostPeerRef.current && hostPeerRef.current.signalingState !== "closed") {
              sendMessage("SIGNAL", {
                targetId: hostId,
                signal: {
                  type: "ice-candidate",
                  data: event.candidate,
                },
              });
            }
          }, 1000);
        }
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
        }, 1000);
      } else if (state === "disconnected") {
        console.warn("[LocalMeet] ICE connection temporarily disconnected, waiting 1000ms before retry...");
        setStreamHealth("buffering");
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          if (hostPeerRef.current?.iceConnectionState === "disconnected" || hostPeerRef.current?.iceConnectionState === "failed") {
            retryStudentConnectionRef.current();
          }
        }, 1000);
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
      let stream = (event.streams && event.streams[0]) || null;
      if (!stream) {
        stream = new MediaStream([event.track]);
      }
      setRemoteStream((prev) => {
        if (!prev) return stream;
        const exists = prev.getTracks().some((t) => t.id === event.track.id);
        if (!exists) {
          prev.addTrack(event.track);
        }
        return new MediaStream(prev.getTracks());
      });
      setIsHostPresenting(true);

      let muteTimeout: any = null;

      event.track.onmute = () => {
        console.warn("[LocalMeet] Remote track muted, scheduling recovery timer...");
        setStreamHealth("buffering");
        if (muteTimeout) clearTimeout(muteTimeout);
        // If track stays muted for >4 seconds on cellular / WAN, request fresh connection
        muteTimeout = setTimeout(() => {
          if (event.track.muted && !isHost) {
            console.warn("[LocalMeet] Track muted for >4s on WAN, requesting ICE reconnect...");
            retryStudentConnectionRef.current();
          }
        }, 4000);
      };

      event.track.onunmute = () => {
        if (muteTimeout) clearTimeout(muteTimeout);
        console.log("[LocalMeet] Remote track resumed");
        setStreamHealth("live");
      };

      event.track.onended = () => {
        if (muteTimeout) clearTimeout(muteTimeout);
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

      const offer = await pc.createOffer({ iceRestart });
      await pc.setLocalDescription(offer);

      sendMessage("SIGNAL", {
        targetId: studentId,
        signal: {
          type: "sdp-offer",
          data: offer,
        },
      });
    } catch (err) {
      console.error(`[LocalMeet] Error creating offer for student ${studentId}:`, err);
    }
  }, [sendMessage]);

  // Public: Retry Connection (for students if connection was interrupted)
  const retryStudentConnection = useCallback(() => {
    if (isHost) return;
    console.log("[LocalMeet] Attempting to reconnect to host:", hostId);
    setStreamHealth("buffering");
    if (hostId) {
      createStudentToHostConnection();
      sendMessage("SIGNAL", {
        targetId: hostId,
        signal: {
          type: "reconnect-request",
        },
      });
    }
  }, [isHost, hostId, createStudentToHostConnection, sendMessage]);

  useEffect(() => {
    retryStudentConnectionRef.current = retryStudentConnection;
  }, [retryStudentConnection]);

  // Listen for browser online/offline events to manage hybrid transitions and ICE restart
  useEffect(() => {
    const handleOnline = async () => {
      console.log("[LocalMeet] Internet restored! Reconnecting cloud signaling & remote peers...");
      setInternetState("online");

      // 1. If room was started offline, silently publish it to Cloudflare DO so global peers can join
      const isOfflineCreated = typeof localStorage !== "undefined" && localStorage.getItem(`nukechat_offline_meet_${roomCode}`) === "true";
      if (isOfflineCreated && isHost) {
        try {
          const backendUrl = import.meta.env.VITE_BACKEND_URL || "https://nuke-chat-backend.anshgoyalchd.workers.dev";
          const res = await fetch(`${backendUrl}/api/room/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              publicCode: roomCode,
              hostKey: localStorage.getItem(`nukechat_host_key_${roomCode}`),
              type: "meet",
              visibility: "private",
              expiresInMinutes: 120,
            }),
          });
          const data = await res.json();
          if (data.success) {
            console.log("[LocalMeet] Successfully registered offline room with Cloudflare DO!");
            localStorage.removeItem(`nukechat_offline_meet_${roomCode}`);
          }
        } catch (e) {
          console.warn("[LocalMeet] Failed to auto-register room on cloud:", e);
        }
      }

      // 2. Host: Restart ICE for any remote peers that stalled while WAN was down
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

      // 3. Student: If remote, retry connection to host
      if (!isHost && hostPeerRef.current) {
        retryStudentConnectionRef.current();
      }
    };

    const handleOffline = () => {
      console.log("[LocalMeet] Internet disconnected. Star LAN peers remain active.");
      setInternetState("offline");
      if (!isHost && connectionTopology !== "star_lan") {
        setStreamHealth("interrupted");
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [isHost, roomCode, peerTopologyMap, connectionTopology, sendOfferToStudent]);

  // Handle incoming signaling messages with candidate queueing
  const handleSignal = useCallback(async (senderId: string, signal: any) => {
    const { type, data } = signal;

    if (isHost) {
      // HOST receives signals from students
      if (type === "reconnect-request") {
        console.log(`[LocalMeet] Student ${senderId} requested reconnection with iceRestart`);
        let pc = studentPeersRef.current[senderId];
        if (!pc || pc.signalingState === "closed") {
          pc = createHostToStudentConnection(senderId);
        }
        await sendOfferToStudent(senderId, pc, true);
        return;
      }

      let pc = studentPeersRef.current[senderId];
      if (!pc) return;

      if (type === "sdp-answer") {
        try {
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
        } catch (e) {
          console.error(`[LocalMeet] Error setting remote description on host for student ${senderId}:`, e);
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

          sendMessage("SIGNAL", {
            targetId: senderId,
            signal: {
              type: "sdp-answer",
              data: answer,
            },
          });
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
  }, [isHost, createHostToStudentConnection, createStudentToHostConnection, sendOfferToStudent, sendMessage]);

  // Seamless track transmission to all connected students
  const pushTracksToAllStudents = useCallback((stream: MediaStream | null) => {
    const videoTrack = stream ? stream.getVideoTracks()[0] || null : null;
    const audioTrack = stream ? stream.getAudioTracks()[0] || null : null;

    Object.keys(studentPeersRef.current).forEach(async (studentId) => {
      const pc = studentPeersRef.current[studentId];
      if (!pc || pc.signalingState === "closed") return;

      const senders = pc.getSenders();
      const videoSender = senders.find(
        (s) => (s.track && s.track.kind === "video") || (!s.track && (s as any).kind === "video")
      );
      const audioSender = senders.find(
        (s) => (s.track && s.track.kind === "audio") || (!s.track && (s as any).kind === "audio")
      );

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
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { max: qualityMode === "clarity" ? 10 : 20, ideal: qualityMode === "clarity" ? 10 : 20 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: true,
      });

      activeScreenStreamRef.current = screen;
      const tracks: MediaStreamTrack[] = [...screen.getVideoTracks()];

      // Initialize microphone track directly into the stream
      try {
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        micStreamRef.current = mic;
        const audioTrack = mic.getAudioTracks()[0];
        audioTrack.enabled = includeMic;
        setIsMicActive(includeMic);
        tracks.push(audioTrack);
      } catch (micErr) {
        console.warn("[LocalMeet] Mic unavailable, proceeding with screen only.", micErr);
        setIsMicActive(false);
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
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { max: 20, ideal: 15 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      };

      const cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      activeCameraStreamRef.current = cameraStream;

      // Handle track stop
      cameraStream.getVideoTracks()[0].onended = () => {
        stopBroadcast();
      };

      // Set audio enabled status without removing track
      if (cameraStream.getAudioTracks().length > 0) {
        const audioTrack = cameraStream.getAudioTracks()[0];
        audioTrack.enabled = includeMic;
        setIsMicActive(includeMic);
        micStreamRef.current = new MediaStream([audioTrack]);
      } else {
        setIsMicActive(false);
      }

      setLocalStream(cameraStream);
      localStreamRef.current = cameraStream;
      setIsScreenSharing(true);
      setBroadcastSource("camera");
      setCameraFacingMode(facingMode);
      setIsHostPresenting(true);

      pushTracksToAllStudents(cameraStream);
    } catch (err: any) {
      setBroadcastError(`Camera permission denied or camera unavailable: ${err.message || "Please allow camera access."}`);
    }
  };

  // Switch camera between front and back while broadcasting
  const switchCameraFacingMode = async () => {
    if (!isHost || broadcastSource !== "camera") return;
    const nextMode = cameraFacingMode === "environment" ? "user" : "environment";
    await startCameraShare(nextMode, isMicActive);
  };

  // HOST: Stop Broadcast (explicitly stops ALL hardware tracks on all streams)
  const stopBroadcast = () => {
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
    Object.keys(studentPeersRef.current).forEach((studentId) => {
      sendMessage("SIGNAL", {
        targetId: studentId,
        signal: {
          type: "broadcast-stopped",
        },
      });
    });

    pushTracksToAllStudents(null);
  };

  // HOST: Toggle Microphone (mutates .enabled on audio track so VIDEO is NEVER interrupted)
  const toggleMic = async () => {
    if (!isHost) return;

    // 1. If audio track already exists on local stream, mutate .enabled!
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        const nextState = !isMicActive;
        audioTracks.forEach((t) => {
          t.enabled = nextState;
        });
        setIsMicActive(nextState);
        return;
      }
    }

    // 2. If no audio track existed, request mic and add it as a new track WITHOUT touching video
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = mic;
      const audioTrack = mic.getAudioTracks()[0];
      audioTrack.enabled = true;
      setIsMicActive(true);

      if (localStreamRef.current) {
        localStreamRef.current.addTrack(audioTrack);
      }

      // Add audio track to each connected student without removing video sender
      Object.keys(studentPeersRef.current).forEach(async (studentId) => {
        const pc = studentPeersRef.current[studentId];
        if (!pc || pc.signalingState === "closed") return;
        try {
          pc.addTrack(audioTrack, localStreamRef.current!);
          await sendOfferToStudent(studentId, pc);
        } catch (e) {}
      });
    } catch (err) {
      console.error("[LocalMeet] Failed to access mic:", err);
    }
  };

  // When a student joins the room
  const handleRoomJoined = useCallback((joiningId: string, _identity: string, _avatar: string, participantsList: any[]) => {
    if (isHost) {
      participantsList.forEach((p) => {
        if (p.id !== sessionId && !studentPeersRef.current[p.id]) {
          const pc = createHostToStudentConnection(p.id);
          sendOfferToStudent(p.id, pc);
        }
      });
    } else {
      if (hostId && !hostPeerRef.current) {
        createStudentToHostConnection();
      }
    }
  }, [isHost, sessionId, hostId, createHostToStudentConnection, sendOfferToStudent, createStudentToHostConnection]);

  // When hostId changes (e.g. Host reclaims room), connect to returning host
  useEffect(() => {
    if (!isHost && hostId) {
      createStudentToHostConnection();
    }
  }, [isHost, hostId, createStudentToHostConnection]);

  // When Host rejoins, initialize connection offers to all waiting students
  useEffect(() => {
    if (isHost && participants) {
      participants.forEach((p) => {
        if (p.id !== sessionId && !studentPeersRef.current[p.id]) {
          const pc = createHostToStudentConnection(p.id);
          sendOfferToStudent(p.id, pc);
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
    }, 1000);

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
    }, 1000);

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
    stopBroadcast,
    toggleMic,
    retryStudentConnection,
    handleSignal,
    handleRoomJoined,
    handlePeerLeft,
    lanParticipants,
    broadcastDirectMessage,
    internetState,
  };
};
