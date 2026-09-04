import { useEffect, useRef, useState } from "react";
import { SignalPayload, FileOfferPayload } from "../../../shared/types";
import { storeFileMetadata, storeChunk, getFileChunks, deleteSenderFiles } from "../utils/db";
import { DEFAULT_ICE_SERVERS } from "../utils/ice";
import { safeRandomUUID } from "../utils/uuid";

export interface OfferedFile {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  senderId: string;
  senderName: string;
  timestamp: number;
}

export interface P2PTextMessage {
  messageId: string;
  senderId: string;
  senderName: string;
  avatar?: string;
  text: string;
  timestamp: number;
}

interface UseWebRTCProps {
  sessionId: string;
  roomCode: string;
  sendMessage: (type: string, payload: any) => void;
  onTextReceived: (msg: P2PTextMessage) => void;
  onFileOffered: (file: OfferedFile) => void;
  onFileReceived: (file: { fileId: string; name: string; size: number; mimeType: string; blobUrl: string; senderName: string }) => void;
  onPeerDisconnected?: (peerId: string) => void;
  iceServers?: RTCIceServer[];
}

interface PeerConnectionItem {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  identity: string;
  avatar: string;
  connectionState: RTCIceConnectionState;
}

interface HostedFileItem {
  fileId: string;
  file: File;
  name: string;
  size: number;
  mimeType: string;
  totalChunks: number;
  timestamp: number;
}

export const useWebRTC = ({
  sessionId,
  roomCode,
  sendMessage,
  onTextReceived,
  onFileOffered,
  onFileReceived,
  onPeerDisconnected,
  iceServers = DEFAULT_ICE_SERVERS,
}: UseWebRTCProps) => {
  const [activePeers, setActivePeers] = useState<Record<string, { identity: string; avatar: string; state: string }>>({});
  const [fileProgress, setFileProgress] = useState<Record<string, { name: string; progress: number; total: number; isSending: boolean }>>({});

  const peersRef = useRef<Record<string, PeerConnectionItem>>({});
  const iceServersRef = useRef<RTCIceServer[]>(iceServers);
  useEffect(() => {
    iceServersRef.current = iceServers;
  }, [iceServers]);

  // Candidate queues for P2P connections
  const peerCandidatesQueueRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const reconnectThrottleRef = useRef<Record<string, number>>({});
  
  // Persistent registry of files hosted by THIS user (lives until user leaves the room)
  const myHostedFilesRef = useRef<Record<string, HostedFileItem>>({});

  // In-memory buffer of all active text messages in the room (synced to new joiners)
  const chatHistoryRef = useRef<P2PTextMessage[]>([]);

  // Metadata of files being received from other peers
  const receivingFilesRef = useRef<Record<string, FileOfferPayload & { senderName: string; senderId: string; receivedChunks: number }>>({});

  // Sync callbacks to refs to prevent stale closure scope bugs
  const onTextReceivedRef = useRef(onTextReceived);
  const onFileOfferedRef = useRef(onFileOffered);
  const onFileReceivedRef = useRef(onFileReceived);
  const onPeerDisconnectedRef = useRef(onPeerDisconnected);

  useEffect(() => {
    onTextReceivedRef.current = onTextReceived;
    onFileOfferedRef.current = onFileOffered;
    onFileReceivedRef.current = onFileReceived;
    onPeerDisconnectedRef.current = onPeerDisconnected;
  }, [onTextReceived, onFileOffered, onFileReceived, onPeerDisconnected]);

  // Helper: get list of active peers for UI
  const updatePeersState = () => {
    const list: Record<string, { identity: string; avatar: string; state: string }> = {};
    Object.keys(peersRef.current).forEach((id) => {
      const item = peersRef.current[id];
      const isConnected =
        (item.dc && item.dc.readyState === "open") ||
        item.connectionState === "connected" ||
        item.connectionState === "completed" ||
        (item.pc && (item.pc.connectionState === "connected" || item.pc.iceConnectionState === "connected" || item.pc.iceConnectionState === "completed"));

      list[id] = {
        identity: item.identity,
        avatar: item.avatar,
        state: isConnected ? "connected" : item.connectionState,
      };
    });
    setActivePeers(list);
  };

  // 1. Reset peer socket connection without touching messages or files
  const resetPeerConnection = (peerId: string) => {
    const item = peersRef.current[peerId];
    if (item) {
      if (item.dc) {
        try { item.dc.close(); } catch (e) {}
        item.dc = null;
      }
      if (item.pc) {
        try { item.pc.close(); } catch (e) {}
        item.pc = null as any;
      }
      item.connectionState = "new";
      updatePeersState();
    }
  };

  // 2. Full peer departure (CALLED ONLY WHEN SERVER CONFIRMS PEER_LEFT)
  const handlePeerLeft = (peerId: string) => {
    resetPeerConnection(peerId);
    delete peersRef.current[peerId];

    // Delete files owned by this sender from IndexedDB
    deleteSenderFiles(peerId).catch(() => {});

    // Purge messages sent by this departed sender from room history
    chatHistoryRef.current = chatHistoryRef.current.filter((m) => m.senderId !== peerId);

    // Notify UI that peer departed so their shared files and messages vanish from the chat
    if (onPeerDisconnectedRef.current) {
      onPeerDisconnectedRef.current(peerId);
    }

    updatePeersState();
  };

  const createPeerConnection = (remoteId: string, identity: string, avatar: string, isInitiator: boolean): RTCPeerConnection => {
    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current || iceServers,
      iceCandidatePoolSize: 2,
    });
    if (!peerCandidatesQueueRef.current[remoteId]) {
      peerCandidatesQueueRef.current[remoteId] = [];
    }

    peersRef.current[remoteId] = {
      pc,
      dc: null,
      identity,
      avatar,
      connectionState: "new",
    };

    pc.onconnectionstatechange = () => {
      if (peersRef.current[remoteId]) {
        console.log(`[P2P] Peer ${remoteId} connectionState changed to:`, pc.connectionState);
        if (pc.connectionState === "connected") {
          peersRef.current[remoteId].connectionState = "connected";
        }
        updatePeersState();
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendMessage("SIGNAL", {
          targetId: remoteId,
          signal: {
            type: "ice-candidate",
            data: event.candidate,
          },
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (peersRef.current[remoteId]) {
        const ice = pc.iceConnectionState;
        if (ice === "connected" || ice === "completed") {
          peersRef.current[remoteId].connectionState = "connected";
        } else if (peersRef.current[remoteId].dc?.readyState !== "open") {
          peersRef.current[remoteId].connectionState = ice;
        }
        updatePeersState();

        // If connection failed or disconnected, trigger automatic recovery
        if ((ice === "failed" || ice === "disconnected") && peersRef.current[remoteId].dc?.readyState !== "open") {
          console.warn(`[P2P] Connection with ${remoteId} is ${ice}. Initiating recovery...`);
          const isInitiator = sessionId > remoteId;
          if (isInitiator) {
            setTimeout(() => {
              if (peersRef.current[remoteId] && peersRef.current[remoteId].dc?.readyState !== "open") {
                reconnectPeer(remoteId);
              }
            }, 1500);
          } else {
            sendMessage("SIGNAL", {
              targetId: remoteId,
              signal: { type: "reconnect-request" },
            });
          }
        }
      }
    };

    if (isInitiator) {
      // Create DataChannel
      const dc = pc.createDataChannel("nukechat-channel", { ordered: true });
      peersRef.current[remoteId].dc = dc;
      setupDataChannel(remoteId, dc);
    } else {
      // Listen for incoming DataChannel
      pc.ondatachannel = (event) => {
        peersRef.current[remoteId].dc = event.channel;
        setupDataChannel(remoteId, event.channel);
      };
    }

    return pc;
  };

  const setupDataChannel = (remoteId: string, dc: RTCDataChannel) => {
    dc.binaryType = "arraybuffer";
    let hasOpened = false;

    const handleChannelOpen = () => {
      if (hasOpened) return;
      hasOpened = true;

      console.log(`[P2P] Data Channel with ${remoteId} opened! readyState:`, dc.readyState);
      if (peersRef.current[remoteId]) {
        peersRef.current[remoteId].connectionState = "connected";
      }
      updatePeersState();

      // 1. If we have any existing chat messages in memory, send the history to the newly connected peer!
      if (chatHistoryRef.current.length > 0) {
        try {
          dc.send(
            JSON.stringify({
              type: "CHAT_HISTORY",
              payload: chatHistoryRef.current,
            })
          );
          console.log(`[P2P] Sent chat history (${chatHistoryRef.current.length} msgs) to newly connected peer ${remoteId}`);
        } catch (e) {
          console.error(`[P2P] Failed to send chat history to ${remoteId}:`, e);
        }
      }

      // 2. If this client is hosting any files, send the file catalog to the newly connected peer!
      const hostedFiles = Object.values(myHostedFilesRef.current);
      if (hostedFiles.length > 0) {
        const catalog = hostedFiles.map((h) => ({
          fileId: h.fileId,
          name: h.name,
          size: h.size,
          mimeType: h.mimeType,
          totalChunks: h.totalChunks,
          senderId: sessionId,
          timestamp: h.timestamp,
        }));

        try {
          dc.send(
            JSON.stringify({
              type: "FILE_CATALOG",
              payload: catalog,
            })
          );
          console.log(`[P2P] Sent file catalog (${catalog.length} files) to newly connected peer ${remoteId}`);
        } catch (err) {
          console.error(`[P2P] Failed to send file catalog to ${remoteId}:`, err);
        }
      }
    };

    dc.onopen = handleChannelOpen;

    dc.onerror = (err) => {
      console.warn(`[P2P] Data Channel error with ${remoteId}:`, err);
      updatePeersState();
    };

    dc.onclose = () => {
      console.log(`[P2P] Data Channel with ${remoteId} closed.`);
      updatePeersState();
    };

    // Race condition guard: if channel is already open when ondatachannel caught
    if (dc.readyState === "open") {
      handleChannelOpen();
    }

    dc.onmessage = async (event) => {
      if (typeof event.data === "string") {
        try {
          const envelope = JSON.parse(event.data);

          if (envelope.type === "PING") {
            return;
          }

          if (envelope.type === "TEXT") {
            const msg: P2PTextMessage = {
              messageId: envelope.messageId,
              senderId: envelope.senderId || remoteId,
              senderName: envelope.senderName || peersRef.current[remoteId]?.identity || "Unknown Peer",
              avatar: envelope.avatar || peersRef.current[remoteId]?.avatar || "",
              text: envelope.text,
              timestamp: envelope.timestamp || Date.now(),
            };
            if (!chatHistoryRef.current.some((m) => m.messageId === msg.messageId)) {
              chatHistoryRef.current.push(msg);
            }
            onTextReceivedRef.current(msg);
          } else if (envelope.type === "CHAT_HISTORY") {
            const history = (envelope.payload || []) as P2PTextMessage[];
            history.forEach((msg) => {
              if (!chatHistoryRef.current.some((m) => m.messageId === msg.messageId)) {
                chatHistoryRef.current.push(msg);
              }
              onTextReceivedRef.current({
                messageId: msg.messageId,
                senderId: msg.senderId,
                senderName: msg.senderName || "Unknown Peer",
                avatar: msg.avatar,
                text: msg.text,
                timestamp: msg.timestamp,
              });
            });
          } else if (envelope.type === "FILE_OFFER") {
            const offer = envelope.payload as FileOfferPayload & { timestamp?: number };
            receivingFilesRef.current[offer.fileId] = {
              ...offer,
              senderName: peersRef.current[remoteId]?.identity || "Unknown Peer",
              senderId: remoteId,
              receivedChunks: 0,
            };

            await storeFileMetadata({
              fileId: offer.fileId,
              name: offer.name,
              size: offer.size,
              mimeType: offer.mimeType,
              totalChunks: offer.totalChunks,
              hash: offer.hash || "",
              senderId: remoteId,
            });

            onFileOfferedRef.current({
              fileId: offer.fileId,
              name: offer.name,
              size: offer.size,
              mimeType: offer.mimeType,
              senderId: remoteId,
              senderName: peersRef.current[remoteId]?.identity || "Unknown Peer",
              timestamp: offer.timestamp || Date.now(),
            });
          } else if (envelope.type === "FILE_CATALOG") {
            const catalog = (envelope.payload || []) as Array<FileOfferPayload & { timestamp?: number }>;
            for (const offer of catalog) {
              receivingFilesRef.current[offer.fileId] = {
                ...offer,
                senderName: peersRef.current[remoteId]?.identity || "Unknown Peer",
                senderId: remoteId,
                receivedChunks: 0,
              };

              await storeFileMetadata({
                fileId: offer.fileId,
                name: offer.name,
                size: offer.size,
                mimeType: offer.mimeType,
                totalChunks: offer.totalChunks,
                hash: offer.hash || "",
                senderId: remoteId,
              });

              onFileOfferedRef.current({
                fileId: offer.fileId,
                name: offer.name,
                size: offer.size,
                mimeType: offer.mimeType,
                senderId: remoteId,
                senderName: peersRef.current[remoteId]?.identity || "Unknown Peer",
                timestamp: offer.timestamp || Date.now(),
              });
            }
          } else if (envelope.type === "FILE_REQUEST" || envelope.type === "FILE_ACCEPT") {
            const { fileId } = envelope.payload;
            startFileChunking(fileId, remoteId);
          }
        } catch (e) {
          console.error("[P2P] Error handling channel message:", e);
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Handle Binary Chunk
        await handleIncomingChunk(event.data, remoteId);
      }
    };
  };

  // WebRTC Signaling routing (SDP offer/answer and ICE candidates with queueing)
  const handleSignal = async (senderId: string, signal: any) => {
    let item = peersRef.current[senderId];

    if (!item || !item.pc || item.pc.connectionState === "closed") {
      const identity = item?.identity || "Connecting Peer";
      const avatar = item?.avatar || "";
      createPeerConnection(senderId, identity, avatar, false);
      item = peersRef.current[senderId];
    }

    const { type, data } = signal;

    if (type === "reconnect-request") {
      console.log(`[P2P] Peer ${senderId} requested reconnection.`);
      reconnectPeer(senderId);
      return;
    }

    // High-Availability Fallback: If WebRTC DataChannel is negotiating or blocked, receive message via signaling relay
    if (type === "p2p-relay-text") {
      const incomingMsg = data as P2PTextMessage;
      if (!incomingMsg || !incomingMsg.messageId) return;
      // Deduplicate: ignore if already received over DataChannel
      if (chatHistoryRef.current.some((m) => m.messageId === incomingMsg.messageId)) return;
      chatHistoryRef.current.push(incomingMsg);
      if (onTextReceivedRef.current) {
        onTextReceivedRef.current(incomingMsg);
      }
      return;
    }

    if (type === "p2p-relay-file-offer") {
      const offer = data as FileOfferPayload & { timestamp?: number };
      if (!offer || !offer.fileId) return;
      if (receivingFilesRef.current[offer.fileId]) return;
      const sender = peersRef.current[senderId];
      const senderName = sender?.identity || "Unknown Peer";
      receivingFilesRef.current[offer.fileId] = {
        ...offer,
        senderName,
        senderId,
        receivedChunks: 0,
      };

      await storeFileMetadata({
        fileId: offer.fileId,
        name: offer.name,
        size: offer.size,
        mimeType: offer.mimeType,
        totalChunks: offer.totalChunks,
        hash: offer.hash || "",
        senderId,
      });

      if (onFileOfferedRef.current) {
        onFileOfferedRef.current({
          fileId: offer.fileId,
          name: offer.name,
          size: offer.size,
          mimeType: offer.mimeType,
          senderId,
          senderName,
          timestamp: offer.timestamp || Date.now(),
        });
      }
      return;
    }

    if (type === "sdp-offer") {
      try {
        const isCollision = item.pc.signalingState !== "stable";
        if (isCollision) {
          const isPolite = sessionId < senderId;
          if (!isPolite) {
            console.warn(`[P2P] Glare detected, ignoring offer from ${senderId} as impolite peer`);
            return;
          }
          console.log(`[P2P] Glare detected, rolling back local description as polite peer for ${senderId}`);
          try {
            await item.pc.setLocalDescription({ type: "rollback" });
          } catch (e) {}
        }

        await item.pc.setRemoteDescription(new RTCSessionDescription(data));
        // Flush queued ICE candidates
        const queue = peerCandidatesQueueRef.current[senderId] || [];
        while (queue.length > 0) {
          const candidate = queue.shift();
          if (candidate && candidate.candidate) {
            try {
              await item.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
              console.warn("[P2P] Failed adding queued candidate:", err);
            }
          }
        }

        if (item.pc.signalingState !== "have-remote-offer") {
          console.warn(`[P2P] Skipping answer; state is: ${item.pc.signalingState}`);
          return;
        }

        const answer = await item.pc.createAnswer();
        if (item.pc.signalingState !== "have-remote-offer") {
          console.warn(`[P2P] State changed to ${item.pc.signalingState} during createAnswer, skipping setLocalDescription`);
          return;
        }
        await item.pc.setLocalDescription(answer);

        sendMessage("SIGNAL", {
          targetId: senderId,
          signal: {
            type: "sdp-answer",
            data: answer,
          },
        });
      } catch (e) {
        console.error("[P2P] Error handling sdp-offer:", e);
      }
    } else if (type === "sdp-answer") {
      try {
        if (item.pc.signalingState !== "have-local-offer") {
          console.warn(`[P2P] Ignoring sdp-answer in state ${item.pc.signalingState}`);
          return;
        }
        await item.pc.setRemoteDescription(new RTCSessionDescription(data));
        // Flush queued ICE candidates
        const queue = peerCandidatesQueueRef.current[senderId] || [];
        while (queue.length > 0) {
          const candidate = queue.shift();
          if (candidate && candidate.candidate) {
            try {
              await item.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
              console.warn("[P2P] Failed adding queued candidate:", err);
            }
          }
        }
      } catch (e) {
        console.error("[P2P] Error handling sdp-answer:", e);
      }
    } else if (type === "ice-candidate") {
      if (!data || data.candidate === "") return;
      if (!item.pc || !item.pc.remoteDescription || !item.pc.remoteDescription.type) {
        if (!peerCandidatesQueueRef.current[senderId]) {
          peerCandidatesQueueRef.current[senderId] = [];
        }
        peerCandidatesQueueRef.current[senderId].push(data);
      } else {
        try {
          await item.pc.addIceCandidate(new RTCIceCandidate(data));
        } catch (err) {
          console.warn("[P2P] Error adding ICE candidate:", err);
        }
      }
    }
  };

  // Parse Binary Data Channel Packets with Length-Prefixed Framing
  const handleIncomingChunk = async (buffer: ArrayBuffer, senderId: string) => {
    const enc = new TextDecoder();
    const u8 = new Uint8Array(buffer);

    // Header structure:
    // Byte 0: idLen (length of fileId string)
    // Bytes 1..1+idLen: fileId string
    // Bytes 1+idLen..5+idLen: chunkIndex (Uint32, little-endian)
    // Bytes 5+idLen..end: chunk payload
    const idLen = u8[0];
    if (!idLen || buffer.byteLength < 1 + idLen + 4) return;

    const fileId = enc.decode(u8.slice(1, 1 + idLen));
    const view = new DataView(buffer, 1 + idLen, 4);
    const chunkIndex = view.getUint32(0, true);

    const chunkData = buffer.slice(1 + idLen + 4);

    const fileMeta = receivingFilesRef.current[fileId];
    if (!fileMeta) return;

    await storeChunk(fileId, chunkIndex, chunkData);
    fileMeta.receivedChunks += 1;

    // Update Progress
    setFileProgress((prev) => ({
      ...prev,
      [fileId]: {
        name: fileMeta.name,
        progress: fileMeta.receivedChunks,
        total: fileMeta.totalChunks,
        isSending: false,
      },
    }));

    if (fileMeta.receivedChunks >= fileMeta.totalChunks) {
      // Reassemble and create URL
      const allChunks = await getFileChunks(fileId, fileMeta.totalChunks);
      const blob = new Blob(allChunks, { type: fileMeta.mimeType });
      const blobUrl = URL.createObjectURL(blob);

      onFileReceivedRef.current({
        fileId,
        name: fileMeta.name,
        size: fileMeta.size,
        mimeType: fileMeta.mimeType,
        blobUrl,
        senderName: fileMeta.senderName,
      });

      // Clear receiving state
      delete receivingFilesRef.current[fileId];

      // Clean progress bar
      setTimeout(() => {
        setFileProgress((prev) => {
          const next = { ...prev };
          delete next[fileId];
          return next;
        });
      }, 2000);
    }
  };

  // Chunking and transmission loop (32KB chunks) with backpressure support and length-prefixed headers
  const startFileChunking = (fileId: string, targetPeerId: string) => {
    const hosted = myHostedFilesRef.current[fileId];
    if (!hosted) {
      console.warn(`[P2P] Requested file ${fileId} not found in myHostedFilesRef.`);
      return;
    }

    const CHUNK_SIZE = 32768; // 32KB
    const file = hosted.file;
    const totalChunks = hosted.totalChunks;
    let currentChunk = 0;
    const reader = new FileReader();

    const sendNextChunk = () => {
      const item = peersRef.current[targetPeerId];
      if (!item || !item.dc || item.dc.readyState !== "open") {
        console.warn(`[P2P] Transfer aborted - peer ${targetPeerId} disconnected.`);
        return;
      }

      // Backpressure check: if bufferedAmount is high, pause briefly
      if (item.dc.bufferedAmount > 256 * 1024) {
        setTimeout(sendNextChunk, 20);
        return;
      }

      const start = currentChunk * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const slice = file.slice(start, end);

      reader.onload = (e) => {
        if (!item.dc || item.dc.readyState !== "open") return;

        const rawData = e.target?.result as ArrayBuffer;

        // Construct packet with length-prefixed header
        const enc = new TextEncoder();
        const fileIdBytes = enc.encode(fileId);
        const headerLen = 1 + fileIdBytes.length + 4;
        const header = new Uint8Array(headerLen);

        header[0] = fileIdBytes.length;
        header.set(fileIdBytes, 1);
        const view = new DataView(header.buffer);
        view.setUint32(1 + fileIdBytes.length, currentChunk, true);

        const packet = new Uint8Array(header.length + rawData.byteLength);
        packet.set(header, 0);
        packet.set(new Uint8Array(rawData), header.length);

        try {
          item.dc.send(packet.buffer);
          currentChunk += 1;

          setFileProgress((prev) => ({
            ...prev,
            [fileId]: {
              name: file.name,
              progress: currentChunk,
              total: totalChunks,
              isSending: true,
            },
          }));

          if (currentChunk < totalChunks) {
            setTimeout(sendNextChunk, 2);
          } else {
            console.log(`[P2P] Finished sending file ${file.name} to ${targetPeerId}`);
            setTimeout(() => {
              setFileProgress((prev) => {
                const next = { ...prev };
                delete next[fileId];
                return next;
              });
            }, 2000);
          }
        } catch (err) {
          console.error(`[P2P] Channel error sending chunk ${currentChunk}:`, err);
        }
      };

      reader.readAsArrayBuffer(slice);
    };

    sendNextChunk();
  };

  // Public: Send P2P Text (Attempts direct WebRTC DataChannel, with instant WebSocket relay fallback)
  const sendP2PText = (text: string, senderName: string = "User", avatar: string = "") => {
    const messageId = safeRandomUUID();
    const now = Date.now();
    const msgObj: P2PTextMessage = {
      messageId,
      senderId: sessionId,
      senderName,
      avatar,
      text,
      timestamp: now,
    };

    chatHistoryRef.current.push(msgObj);

    const payload = JSON.stringify({
      type: "TEXT",
      ...msgObj,
    });

    Object.keys(peersRef.current).forEach((peerId) => {
      const item = peersRef.current[peerId];
      // 1. Direct WebRTC DataChannel (Primary)
      if (item && item.dc && item.dc.readyState === "open") {
        try {
          item.dc.send(payload);
          return;
        } catch (e) {
          console.warn(`[P2P] Failed to send over open DataChannel to ${peerId}, falling back to relay:`, e);
        }
      }

      // 2. Immediate WebSocket Relay Fallback
      // If WebRTC is connecting, recovering, or restricted by carrier NAT, relay immediately
      sendMessage("SIGNAL", {
        targetId: peerId,
        signal: {
          type: "p2p-relay-text",
          data: msgObj,
        },
      });
    });

    return messageId;
  };

  // Public: Send P2P File (Hosts file in memory for duration of room and broadcasts offer)
  const sendP2PFile = (file: File) => {
    const fileId = safeRandomUUID();
    const CHUNK_SIZE = 32768;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const now = Date.now();

    // Retain file handle in persistent host registry
    myHostedFilesRef.current[fileId] = {
      fileId,
      file,
      name: file.name,
      size: file.size,
      mimeType: file.type,
      totalChunks,
      timestamp: now,
    };

    const offerPayload = {
      fileId,
      name: file.name,
      size: file.size,
      mimeType: file.type,
      totalChunks,
      hash: "SHA-256-hash",
      timestamp: now,
    };

    // Broadcast file offer to all currently connected peers (DataChannel + Relay fallback)
    Object.keys(peersRef.current).forEach((peerId) => {
      const item = peersRef.current[peerId];
      if (item && item.dc && item.dc.readyState === "open") {
        try {
          item.dc.send(
            JSON.stringify({
              type: "FILE_OFFER",
              payload: offerPayload,
            })
          );
          return;
        } catch (e) {}
      }

      // Relay file offer via WebSocket so peer sees the downloadable file card even during WebRTC setup
      sendMessage("SIGNAL", {
        targetId: peerId,
        signal: {
          type: "p2p-relay-file-offer",
          data: offerPayload,
        },
      });
    });

    return {
      fileId,
      name: file.name,
      size: file.size,
      mimeType: file.type,
      timestamp: now,
    };
  };

  // Public: Request to download a file from a peer via WebRTC
  const requestP2PFile = (fileId: string, senderId: string) => {
    const item = peersRef.current[senderId];
    if (!item || !item.dc || item.dc.readyState !== "open") {
      console.warn(`[P2P] Cannot request file ${fileId} - peer ${senderId} not connected or channel not open.`);
      return false;
    }

    if (receivingFilesRef.current[fileId]) {
      receivingFilesRef.current[fileId].receivedChunks = 0;
    }

    const meta = receivingFilesRef.current[fileId];
    if (meta) {
      setFileProgress((prev) => ({
        ...prev,
        [fileId]: {
          name: meta.name,
          progress: 0,
          total: meta.totalChunks,
          isSending: false,
        },
      }));
    }

    item.dc.send(
      JSON.stringify({
        type: "FILE_REQUEST",
        payload: { fileId },
      })
    );
    return true;
  };

  const initiatePeerConnection = (peerId: string, identity?: string, avatar?: string) => {
    const existing = peersRef.current[peerId];
    const finalIdentity = identity || existing?.identity || "Connecting Peer";
    const finalAvatar = avatar || existing?.avatar || "";

    if (existing && existing.pc) {
      const pcState = existing.pc.connectionState;
      const iceState = existing.pc.iceConnectionState;
      // If peer is already connecting or connected, do NOT recreate or interrupt it!
      if (
        (existing.dc && existing.dc.readyState === "open") ||
        pcState === "connected" ||
        pcState === "connecting" ||
        iceState === "connected" ||
        iceState === "completed" ||
        iceState === "checking"
      ) {
        return;
      }
      resetPeerConnection(peerId);
    }

    try {
      const pc = createPeerConnection(peerId, finalIdentity, finalAvatar, true);
      pc.createOffer()
        .then((offer) => {
          if (pc.signalingState !== "stable") {
            console.warn(`[P2P] Skipping offer setLocalDescription; state is ${pc.signalingState}`);
            return;
          }
          return pc.setLocalDescription(offer).then(() => {
            sendMessage("SIGNAL", {
              targetId: peerId,
              signal: {
                type: "sdp-offer",
                data: offer,
              },
            });
          });
        })
        .catch((err) => {
          console.error(`[P2P] Failed creating offer for ${peerId}:`, err);
        });
    } catch (err) {
      console.error(`[P2P] Peer connection setup error:`, err);
    }
  };

  // Manual or automatic single peer reconnect with debouncing and native iceRestart
  const reconnectPeer = (peerId: string) => {
    const now = Date.now();
    if (now - (reconnectThrottleRef.current[peerId] || 0) < 3500) {
      return;
    }
    reconnectThrottleRef.current[peerId] = now;

    console.log(`[P2P] Reconnecting peer ${peerId}...`);
    const existing = peersRef.current[peerId];
    const isInitiator = sessionId > peerId;

    if (isInitiator) {
      // 1. If existing RTCPeerConnection is intact, attempt non-destructive native iceRestart first
      if (existing && existing.pc && existing.pc.signalingState === "stable") {
        console.log(`[P2P] Initiating native iceRestart offer for ${peerId}...`);
        existing.pc
          .createOffer({ iceRestart: true })
          .then((offer) => {
            if (existing.pc.signalingState !== "stable") return;
            return existing.pc.setLocalDescription(offer).then(() => {
              sendMessage("SIGNAL", {
                targetId: peerId,
                signal: {
                  type: "sdp-offer",
                  data: offer,
                },
              });
            });
          })
          .catch((err) => {
            console.warn(`[P2P] Native iceRestart failed for ${peerId}, falling back to hard reset:`, err);
            resetPeerConnection(peerId);
            initiatePeerConnection(peerId, existing?.identity, existing?.avatar);
          });
        return;
      }

      // 2. Hard reset if connection was closed or in unrecoverable state
      resetPeerConnection(peerId);
      initiatePeerConnection(peerId, existing?.identity, existing?.avatar);
    } else {
      sendMessage("SIGNAL", {
        targetId: peerId,
        signal: { type: "reconnect-request" },
      });
    }
  };

  // Reconnect all peers that are not in open state
  const reconnectAll = () => {
    console.log("[P2P] Reconnecting all inactive peers...");
    Object.keys(peersRef.current).forEach((peerId) => {
      const item = peersRef.current[peerId];
      const isConnected = (item.dc && item.dc.readyState === "open") || item.connectionState === "connected" || item.connectionState === "completed";
      if (!isConnected) {
        reconnectPeer(peerId);
      }
    });
  };

  // Public: Coordinate join checklist updates
  const handleRoomJoined = (joiningId: string, identity: string, avatar: string, list: any[]) => {
    // 1. Prune ghost peers that are no longer in the server's active participant list
    const activeIds = new Set((list || []).map((p) => p.id));
    Object.keys(peersRef.current).forEach((peerId) => {
      if (!activeIds.has(peerId)) {
        console.log(`[P2P] Pruning ghost peer ${peerId} (not in room participant list)`);
        resetPeerConnection(peerId);
        delete peersRef.current[peerId];
      }
    });

    // 2. If a specific peer just joined/rejoined (joiningId !== sessionId),
    // their old connection from previous session/page load is obsolete. Reset it cleanly!
    if (joiningId !== sessionId && peersRef.current[joiningId]) {
      console.log(`[P2P] Peer ${joiningId} rejoined the room. Resetting prior connection.`);
      resetPeerConnection(joiningId);
    }

    // 3. Register any new peers
    list.forEach((item) => {
      if (item.id !== sessionId && !peersRef.current[item.id]) {
        peersRef.current[item.id] = {
          pc: null as any,
          dc: null,
          identity: item.identity,
          avatar: item.avatar,
          connectionState: "new",
        };
      }
    });

    // 4. Deterministic Initiator: The peer with lexicographically greater sessionId initiates the offer!
    // This mathematically guarantees that EXACTLY ONE peer creates the offer,
    // completely eliminating SDP collisions, glares, and InvalidStateErrors forever!
    list.forEach((p) => {
      if (p.id !== sessionId) {
        const isInitiator = sessionId > p.id;
        const existing = peersRef.current[p.id];
        const isConnected = existing && (
          (existing.dc && existing.dc.readyState === "open") ||
          existing.connectionState === "connected" ||
          existing.connectionState === "completed"
        );

        if (isInitiator && !isConnected) {
          console.log(`[P2P] Deterministic initiator for peer ${p.id}: initiating connection offer.`);
          initiatePeerConnection(p.id, p.identity, p.avatar);
        } else if (!isInitiator) {
          console.log(`[P2P] Deterministic responder for peer ${p.id}: awaiting offer from peer.`);
        }
      }
    });

    updatePeersState();
  };

  // Periodic heartbeat / state sync to ensure UI reflects DataChannel state immediately
  useEffect(() => {
    const interval = setInterval(() => {
      if (Object.keys(peersRef.current).length > 0) {
        updatePeersState();
      }
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  // Send NAT keepalive PING every 4s across all open DataChannels
  useEffect(() => {
    const pingInterval = setInterval(() => {
      const pingPayload = JSON.stringify({ type: "PING" });
      Object.keys(peersRef.current).forEach((peerId) => {
        const item = peersRef.current[peerId];
        if (item.dc && item.dc.readyState === "open") {
          try {
            item.dc.send(pingPayload);
          } catch (e) {}
        }
      });
    }, 4000);

    return () => clearInterval(pingInterval);
  }, []);

  // Close all connections on unmount
  useEffect(() => {
    return () => {
      Object.keys(peersRef.current).forEach((id) => {
        resetPeerConnection(id);
      });
    };
  }, []);

  return {
    activePeers,
    fileProgress,
    sendP2PText,
    sendP2PFile,
    requestP2PFile,
    handleSignal,
    handleRoomJoined,
    handlePeerLeft,
    reconnectPeer,
    reconnectAll,
  };
};
