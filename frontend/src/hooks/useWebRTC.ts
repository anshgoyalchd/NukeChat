import { useEffect, useRef, useState, useCallback } from "react";
import { WsEnvelope, SignalPayload, FileOfferPayload } from "../../../shared/types";
import { storeFileMetadata, storeChunk, getFileChunks, deleteSenderFiles } from "../utils/db";

interface UseWebRTCProps {
  sessionId: string;
  roomCode: string;
  sendMessage: (type: string, payload: any) => void;
  onTextReceived: (msg: { messageId: string; senderId: string; senderName: string; text: string; timestamp: number }) => void;
  onFileReceived: (file: { fileId: string; name: string; size: number; mimeType: string; blobUrl: string; senderName: string }) => void;
  iceServers?: RTCIceServer[];
}

interface PeerConnectionItem {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  identity: string;
  avatar: string;
  connectionState: RTCIceConnectionState;
}

export const useWebRTC = ({
  sessionId,
  roomCode,
  sendMessage,
  onTextReceived,
  onFileReceived,
  iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ],
}: UseWebRTCProps) => {
  const [activePeers, setActivePeers] = useState<Record<string, { identity: string; avatar: string; state: string }>>({});
  const [fileProgress, setFileProgress] = useState<Record<string, { name: string; progress: number; total: number; isSending: boolean }>>({});
  
  const peersRef = useRef<Record<string, PeerConnectionItem>>({});
  const activeFilesRef = useRef<Record<string, { file: File; currentChunk: number; totalChunks: number; targetPeerId: string }>>({});
  const receivingFilesRef = useRef<Record<string, FileOfferPayload & { senderName: string; receivedChunks: number }>>({});

  // Sync callbacks to refs to prevent stale closure scope bugs
  const onTextReceivedRef = useRef(onTextReceived);
  const onFileReceivedRef = useRef(onFileReceived);

  useEffect(() => {
    onTextReceivedRef.current = onTextReceived;
    onFileReceivedRef.current = onFileReceived;
  }, [onTextReceived, onFileReceived]);

  // Update peer connections configuration when iceServers updates
  useEffect(() => {
    Object.keys(peersRef.current).forEach((peerId) => {
      const item = peersRef.current[peerId];
      if (item.pc) {
        try {
          item.pc.setConfiguration({ iceServers });
          console.log(`[P2P] Updated iceServers configuration for peer ${peerId}`);
        } catch (e) {
          console.error(`[P2P] Failed to update iceServers configuration for peer ${peerId}:`, e);
        }
      }
    });
  }, [iceServers]);

  // Helper: get list of active peers for UI
  const updatePeersState = () => {
    const list: Record<string, { identity: string; avatar: string; state: string }> = {};
    Object.keys(peersRef.current).forEach((id) => {
      const item = peersRef.current[id];
      list[id] = {
        identity: item.identity,
        avatar: item.avatar,
        state: item.connectionState,
      };
    });
    setActivePeers(list);
  };

  const cleanPeer = (peerId: string) => {
    const item = peersRef.current[peerId];
    if (item) {
      if (item.dc) item.dc.close();
      item.pc.close();
      delete peersRef.current[peerId];
    }
    // Delete files owned by this sender from IndexedDB
    deleteSenderFiles(peerId);
    updatePeersState();
  };

  const createPeerConnection = (remoteId: string, identity: string, avatar: string, isInitiator: boolean): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers });
    
    peersRef.current[remoteId] = {
      pc,
      dc: null,
      identity,
      avatar,
      connectionState: "new",
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
        peersRef.current[remoteId].connectionState = pc.iceConnectionState;
        updatePeersState();
        
        if (
          pc.iceConnectionState === "failed" ||
          pc.iceConnectionState === "disconnected" ||
          pc.iceConnectionState === "closed"
        ) {
          // Grace period check or immediate cleanup
          setTimeout(() => {
            if (peersRef.current[remoteId] && 
               (peersRef.current[remoteId].pc.iceConnectionState === "failed" || 
                peersRef.current[remoteId].pc.iceConnectionState === "disconnected")) {
              cleanPeer(remoteId);
            }
          }, 5000); // 5-second connection grace period
        }
      }
    };

    if (isInitiator) {
      // Create DataChannel
      const dc = pc.createDataChannel("nukechat-channel", { ordered: true });
      setupDataChannel(remoteId, dc);
      peersRef.current[remoteId].dc = dc;
    } else {
      // Listen for incoming DataChannel
      pc.ondatachannel = (event) => {
        setupDataChannel(remoteId, event.channel);
        peersRef.current[remoteId].dc = event.channel;
      };
    }

    return pc;
  };

  const setupDataChannel = (remoteId: string, dc: RTCDataChannel) => {
    dc.binaryType = "arraybuffer";

    dc.onopen = () => {
      console.log(`[P2P] Data Channel with ${remoteId} opened! readyState:`, dc.readyState);
      updatePeersState();
    };

    dc.onclose = () => {
      console.log(`[P2P] Data Channel with ${remoteId} closed.`);
      updatePeersState();
    };

    dc.onmessage = async (event) => {
      console.log(`[P2P] Received message from ${remoteId}, type:`, typeof event.data);
      if (typeof event.data === "string") {
        // Handle JSON payload
        try {
          const envelope = JSON.parse(event.data);
          console.log("[P2P] Parsed envelope:", envelope);
          
          if (envelope.type === "TEXT") {
            onTextReceivedRef.current({
              messageId: envelope.messageId,
              senderId: remoteId,
              senderName: peersRef.current[remoteId]?.identity || "Unknown Peer",
              text: envelope.text,
              timestamp: envelope.timestamp,
            });
          }
          else if (envelope.type === "FILE_OFFER") {
            const offer = envelope.payload as FileOfferPayload;
            receivingFilesRef.current[offer.fileId] = {
              ...offer,
              senderName: peersRef.current[remoteId]?.identity || "Unknown Peer",
              receivedChunks: 0,
            };

            await storeFileMetadata({
              fileId: offer.fileId,
              name: offer.name,
              size: offer.size,
              mimeType: offer.mimeType,
              totalChunks: offer.totalChunks,
              hash: offer.hash,
              senderId: remoteId,
            });

            // Send acceptance back automatically to trigger chunk streaming
            dc.send(JSON.stringify({
              type: "FILE_ACCEPT",
              payload: { fileId: offer.fileId },
            }));
          }
          else if (envelope.type === "FILE_ACCEPT") {
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

  // WebRTC Signaling routing (SDP offer/answer and ICE candidates)
  const handleSignal = async (senderId: string, signal: any) => {
    let item = peersRef.current[senderId];
    
    if (!item || !item.pc) {
      // If we don't have a connection or pc is not initialized yet, create it as the Answerer
      const identity = item?.identity || "Connecting Peer";
      const avatar = item?.avatar || "";
      createPeerConnection(senderId, identity, avatar, false);
      item = peersRef.current[senderId];
    }

    const { type, data } = signal;

    if (type === "sdp-offer") {
      await item.pc.setRemoteDescription(new RTCSessionDescription(data));
      const answer = await item.pc.createAnswer();
      await item.pc.setLocalDescription(answer);
      
      sendMessage("SIGNAL", {
        targetId: senderId,
        signal: {
          type: "sdp-answer",
          data: answer,
        },
      });
    } else if (type === "sdp-answer") {
      await item.pc.setRemoteDescription(new RTCSessionDescription(data));
    } else if (type === "ice-candidate") {
      try {
        await item.pc.addIceCandidate(new RTCIceCandidate(data));
      } catch (err) {
        // Ignore candidate errors
      }
    }
  };

  // Parse Binary Data Channel Packets
  const handleIncomingChunk = async (buffer: ArrayBuffer, senderId: string) => {
    const enc = new TextDecoder();
    
    // Binary header: first 36 bytes are fileId, next 4 bytes are chunkIndex
    const fileId = enc.decode(buffer.slice(0, 36));
    const view = new DataView(buffer, 36, 4);
    const chunkIndex = view.getUint32(0, true);
    
    const chunkData = buffer.slice(40);

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

    if (fileMeta.receivedChunks === fileMeta.totalChunks) {
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

      // Clear local memory metadata
      delete receivingFilesRef.current[fileId];
      
      // Clean progress bar
      setTimeout(() => {
        setFileProgress((prev) => {
          const next = { ...prev };
          delete next[fileId];
          return next;
        });
      }, 3000);
    }
  };

  // Chunking and transmission loop (32KB chunks)
  const startFileChunking = (fileId: string, targetPeerId: string) => {
    const fileItem = activeFilesRef.current[fileId];
    if (!fileItem) return;

    const CHUNK_SIZE = 32768; // 32KB
    const file = fileItem.file;
    const reader = new FileReader();

    const sendNextChunk = () => {
      const start = fileItem.currentChunk * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const slice = file.slice(start, end);

      reader.onload = (e) => {
        const item = peersRef.current[targetPeerId];
        if (!item || !item.dc || item.dc.readyState !== "open") {
          // Peer left, abort transfer
          delete activeFilesRef.current[fileId];
          return;
        }

        const rawData = e.target?.result as ArrayBuffer;

        // Construct packet with binary header
        const header = new Uint8Array(40);
        const enc = new TextEncoder();
        header.set(enc.encode(fileId)); // 36 bytes for fileId UUID
        const view = new DataView(header.buffer);
        view.setUint32(36, fileItem.currentChunk, true); // 4 bytes for chunkIndex

        const packet = new Uint8Array(header.length + rawData.byteLength);
        packet.set(header, 0);
        packet.set(new Uint8Array(rawData), header.length);

        // Send over WebRTC Data Channel
        try {
          item.dc.send(packet.buffer);
          fileItem.currentChunk += 1;

          setFileProgress((prev) => ({
            ...prev,
            [fileId]: {
              name: file.name,
              progress: fileItem.currentChunk,
              total: fileItem.totalChunks,
              isSending: true,
            },
          }));

          if (fileItem.currentChunk < fileItem.totalChunks) {
            // Keep sending chunks
            // Use setImmediate / setTimeout with 0 to prevent call stack overflow
            setTimeout(sendNextChunk, 5);
          } else {
            // Completed
            delete activeFilesRef.current[fileId];
            setTimeout(() => {
              setFileProgress((prev) => {
                const next = { ...prev };
                delete next[fileId];
                return next;
              });
            }, 3000);
          }
        } catch (err) {
          // Abort on channel failure
          delete activeFilesRef.current[fileId];
        }
      };

      reader.readAsArrayBuffer(slice);
    };

    sendNextChunk();
  };

  // Public: Send P2P Text
  const sendP2PText = (text: string) => {
    const messageId = crypto.randomUUID();
    const payload = JSON.stringify({
      type: "TEXT",
      messageId,
      text,
      timestamp: Date.now(),
    });

    console.log("[P2P] sendP2PText called. Active peer list:", Object.keys(peersRef.current));

    Object.keys(peersRef.current).forEach((peerId) => {
      const item = peersRef.current[peerId];
      console.log(`[P2P] Peer ${peerId} connectionState: ${item.connectionState}, dataChannelState: ${item.dc?.readyState}`);
      if (item.dc && item.dc.readyState === "open") {
        item.dc.send(payload);
        console.log(`[P2P] Successfully sent text payload to ${peerId}`);
      } else {
        console.warn(`[P2P] Skipped sending to ${peerId} - data channel is not open.`);
      }
    });

    // Return message info for local rendering
    return messageId;
  };

  // Public: Send P2P File
  const sendP2PFile = (file: File) => {
    const fileId = crypto.randomUUID();
    const CHUNK_SIZE = 32768;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    
    // Set file item in sender registry
    activeFilesRef.current[fileId] = {
      file,
      currentChunk: 0,
      totalChunks,
      targetPeerId: "",
    };

    const offerPayload: FileOfferPayload = {
      fileId,
      name: file.name,
      size: file.size,
      mimeType: file.type,
      totalChunks,
      hash: "SHA-256-hash", // Placeholder for MVP
    };

    // Broadcast file offer to all peers
    Object.keys(peersRef.current).forEach((peerId) => {
      const item = peersRef.current[peerId];
      if (item.dc && item.dc.readyState === "open") {
        item.dc.send(JSON.stringify({
          type: "FILE_OFFER",
          payload: offerPayload,
        }));
      }
    });
  };

  // Public: Coordinate join checklist updates
  const handleRoomJoined = (joiningId: string, identity: string, avatar: string, list: any[]) => {
    // If the join is not myself, and I am the older peer, wait for the joining peer to offer connection
    // Cloudflare updates the list of participants. Let's record the new join metadata.
    list.forEach((item) => {
      if (item.id !== sessionId && !peersRef.current[item.id]) {
        // Record them as a potential peer. We will connect if they offer.
        peersRef.current[item.id] = {
          pc: null as any,
          dc: null,
          identity: item.identity,
          avatar: item.avatar,
          connectionState: "new",
        };
      }
    });
    
    // If I just joined the room, I need to initiate connections with all existing older peers in the room
    if (joiningId === sessionId) {
      list.forEach((p) => {
        if (p.id !== sessionId && !peersRef.current[p.id]?.pc) {
          const pc = createPeerConnection(p.id, p.identity, p.avatar, true);
          
          // Generate offer
          pc.createOffer().then((offer) => {
            pc.setLocalDescription(offer);
            sendMessage("SIGNAL", {
              targetId: p.id,
              signal: {
                type: "sdp-offer",
                data: offer,
              },
            });
          });
        }
      });
    }
    updatePeersState();
  };

  const handlePeerLeft = (peerId: string) => {
    cleanPeer(peerId);
  };

  // Close all connections on unmount
  useEffect(() => {
    return () => {
      Object.keys(peersRef.current).forEach((id) => {
        cleanPeer(id);
      });
    };
  }, []);

  return {
    activePeers,
    fileProgress,
    sendP2PText,
    sendP2PFile,
    handleSignal,
    handleRoomJoined,
    handlePeerLeft,
  };
};
