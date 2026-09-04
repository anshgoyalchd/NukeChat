import React, { useState, useEffect, useCallback, useRef } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useWebRTC } from "../hooks/useWebRTC";
import { useLocalMeet } from "../hooks/useLocalMeet";
import { deriveRoomKey, encryptText, decryptText } from "../utils/crypto";
import { DEFAULT_ICE_SERVERS } from "../utils/ice";
import { safeRandomUUID } from "../utils/uuid";
import { TimedChat } from "./TimedChat";
import { P2PChat } from "./P2PChat";
import { LocalMeet } from "./LocalMeet";
import { WsEnvelope, WsEventType, Participant, RoomType } from "../../../shared/types";

export interface UIMessage {
  messageId: string;
  senderId: string;
  senderName: string;
  avatar: string;
  text?: string;
  file?: {
    fileId: string;
    name: string;
    size: number;
    mimeType: string;
    blobUrl: string;
  };
  timestamp: number;
  isSending?: boolean;
}

interface ActiveRoomProps {
  roomCode: string;
  roomType: RoomType;
  sessionId: string;
  identityName: string;
  avatarUrl: string;
  salt: string;
  expiresAt: string;
  hostId?: string;
  onGoHome: () => void;
  onRoomNuked: () => void;
  onRoomExpired: () => void;
  backendUrl: string;
}

export const ActiveRoom: React.FC<ActiveRoomProps> = ({
  roomCode,
  roomType,
  sessionId,
  identityName,
  avatarUrl,
  salt,
  expiresAt,
  hostId,
  onGoHome,
  onRoomNuked,
  onRoomExpired,
  backendUrl,
}) => {
  const storedHostKey = (typeof localStorage !== "undefined" && localStorage.getItem(`nukechat_host_key_${roomCode}`)) || "";
  const isCreator = !!storedHostKey;
  const [currentHostId, setCurrentHostId] = useState<string>(isCreator ? sessionId : (hostId || ""));
  const [roomKey, setRoomKey] = useState<CryptoKey | null>(null);
  const roomKeyRef = useRef<CryptoKey | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [nukeVotesState, setNukeVotesState] = useState({ votesCount: 0, neededVotes: 0 });
  const [iceServers, setIceServers] = useState<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  const [myIdentityName, setMyIdentityName] = useState<string>(identityName);

  // Synchronize host role when creator returns or hostId changes
  useEffect(() => {
    if (isCreator) {
      setCurrentHostId(sessionId);
    } else if (hostId) {
      setCurrentHostId(hostId);
    }
  }, [isCreator, hostId, sessionId]);

  // Synchronize local identity when prop changes
  useEffect(() => {
    setMyIdentityName(identityName);
  }, [identityName]);

  // Fetch TURN server credentials for P2P/Meet mode on mount
  useEffect(() => {
    if (roomType === "p2p" || roomType === "meet") {
      fetch(`${backendUrl}/api/ice-servers`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.iceServers) {
            console.log("[P2P/Meet] Fetched custom TURN/STUN ICE servers.");
            setIceServers(data.iceServers);
          }
        })
        .catch((err) => {
          console.error("[P2P/Meet] Failed to fetch TURN credentials, falling back to STUN:", err);
        });
    }
  }, [roomType, backendUrl]);

  // Helper to reliably retrieve or derive the E2EE key on demand
  const getOrDeriveRoomKey = useCallback(async (): Promise<CryptoKey | null> => {
    if (roomKeyRef.current) return roomKeyRef.current;
    if (roomType !== "timed") return null;
    try {
      const key = await deriveRoomKey(roomCode, salt);
      roomKeyRef.current = key;
      setRoomKey(key);
      return key;
    } catch (e) {
      console.error("[E2EE] Failed to derive room key:", e);
      return null;
    }
  }, [roomCode, salt, roomType]);

  // Derive E2EE Key from room credentials on load
  useEffect(() => {
    if (roomType === "timed") {
      getOrDeriveRoomKey();
    }
  }, [roomType, getOrDeriveRoomKey]);

  // WebSocket event handler
  const handleWebSocketMessage = useCallback(async (envelope: WsEnvelope) => {
    switch (envelope.type) {
      case WsEventType.ROOM_JOINED: {
        const payload = envelope.payload;
        setParticipants(payload.participants);
        if (isCreator) {
          setCurrentHostId(sessionId);
        } else if (payload.hostId) {
          setCurrentHostId(payload.hostId);
        }
        // If this client joined, adopt server-confirmed (possibly deduplicated) identity
        if (envelope.senderId === sessionId && payload.identity) {
          setMyIdentityName(payload.identity);
        }

        // Notify peer managers
        if (roomType === "p2p") {
          webRTC.handleRoomJoined(
            envelope.senderId,
            payload.identity,
            payload.avatar,
            payload.participants
          );
        } else if (roomType === "meet") {
          localMeet.handleRoomJoined(
            envelope.senderId,
            payload.identity,
            payload.avatar,
            payload.participants
          );
        }
        break;
      }

      case WsEventType.PEER_LEFT: {
        const payload = envelope.payload;
        const departedId = payload?.participantId || envelope.senderId;

        if (payload?.participants) {
          setParticipants(payload.participants);
        } else {
          setParticipants((prev) => prev.filter((p) => p.id !== departedId));
        }

        // Notify WebRTC peer manager of peer left
        if (roomType === "p2p") {
          webRTC.handlePeerLeft(departedId);
          // Remove all messages and files shared by the departed peer from the chat!
          setMessages((prev) => prev.filter((m) => m.senderId !== departedId));
        } else if (roomType === "meet") {
          localMeet.handlePeerLeft(departedId);
        }
        break;
      }

      case "HOST_CHANGED": {
        if (envelope.payload?.hostId) {
          setCurrentHostId(envelope.payload.hostId);
        }
        break;
      }

      case WsEventType.MESSAGE_BROADCAST: {
        const payload = envelope.payload;

        if (roomType === "meet") {
          // Classroom Q&A message
          if (envelope.senderId === sessionId) return;
          const sender = participants.find((p) => p.id === envelope.senderId);
          setMessages((prev) => [
            ...prev,
            {
              messageId: payload.messageId || safeRandomUUID(),
              senderId: envelope.senderId,
              senderName: payload.senderName || sender?.identity || "Student",
              avatar: sender ? sender.avatar : "",
              text: payload.text,
              timestamp: envelope.timestamp || Date.now(),
            },
          ]);
          return;
        }

        const currentKey = await getOrDeriveRoomKey();
        if (!currentKey) return;

        // Decrypt ciphertext on the fly
        try {
          const decryptedText = await decryptText(currentKey, payload.ciphertext, payload.nonce);
          
          // Map participant ID to their identity name & avatar
          const sender = participants.find((p) => p.id === envelope.senderId);
          const senderName = sender ? sender.identity : "Unknown Panda";
          const senderAvatar = sender ? sender.avatar : "";

          // Check if message was already optimistically rendered
          setMessages((prev) => {
            const exists = prev.findIndex((m) => m.messageId === payload.messageId);
            if (exists !== -1) {
              const updated = [...prev];
              updated[exists] = {
                ...updated[exists],
                isSending: false,
              };
              return updated;
            }
            return [
              ...prev,
              {
                messageId: payload.messageId,
                senderId: envelope.senderId,
                senderName,
                avatar: senderAvatar,
                text: decryptedText,
                timestamp: envelope.timestamp,
              },
            ];
          });
        } catch (err) {
          console.error("[E2EE] Decryption failed for message:", envelope, err);
        }
        break;
      }

      case WsEventType.NUKE_VOTE_CAST: {
        setNukeVotesState({
          votesCount: envelope.payload.votesCount,
          neededVotes: envelope.payload.neededVotes,
        });
        break;
      }

      case WsEventType.SIGNAL: {
        if (roomType === "p2p") {
          webRTC.handleSignal(envelope.senderId, envelope.payload.signal);
        } else if (roomType === "meet") {
          localMeet.handleSignal(envelope.senderId, envelope.payload.signal);
        }
        break;
      }

      case "HISTORY": {
        // Decrypt historical messages when joining a Timed Chat
        const currentKey = await getOrDeriveRoomKey();
        if (!currentKey) return;
        const payload = envelope.payload || [];
        const histMsgs: UIMessage[] = [];

        for (const item of payload) {
          try {
            const dec = await decryptText(currentKey, item.ciphertext, item.nonce);
            histMsgs.push({
              messageId: item.messageId,
              senderId: item.senderId,
              senderName: "Past Member", // Ephemeral historical identifier
              avatar: `data:image/svg+xml;utf8,${encodeURIComponent('<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#E4E2DD"/><circle cx="50" cy="50" r="20" fill="#6B6B73"/></svg>')}`,
              text: dec,
              timestamp: item.timestamp,
            });
          } catch (e) {
            console.error("[E2EE] History decryption failed for item:", item, e);
          }
        }
        setMessages(histMsgs);
        break;
      }
    }
  }, [getOrDeriveRoomKey, roomType, participants]);

  // WebSocket Hook
  const { isConnected, sendMessage } = useWebSocket({
    roomCode,
    sessionId,
    identityName,
    avatarUrl,
    onMessageReceived: handleWebSocketMessage,
    onRoomNuked,
    onRoomExpired,
    backendUrl,
  });

  // WebRTC P2P Callbacks
  const handleP2PTextReceived = useCallback((msg: { messageId: string; senderId: string; senderName: string; avatar?: string; text: string; timestamp: number }) => {
    setMessages((prev) => {
      if (prev.some((m) => m.messageId === msg.messageId)) return prev;
      const sender = participants.find((p) => p.id === msg.senderId);
      return [
        ...prev,
        {
          messageId: msg.messageId,
          senderId: msg.senderId,
          senderName: msg.senderName || sender?.identity || "Peer",
          avatar: msg.avatar || sender?.avatar || "",
          text: msg.text,
          timestamp: msg.timestamp,
        },
      ];
    });
  }, [participants]);

  const handleP2PFileReceived = useCallback((file: { fileId: string; name: string; size: number; mimeType: string; blobUrl: string; senderName: string }) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.file?.fileId === file.fileId);
      if (idx !== -1) {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          file: {
            ...updated[idx].file!,
            blobUrl: file.blobUrl,
          },
        };
        return updated;
      }

      // Find sender avatar
      const sender = participants.find((p) => p.identity === file.senderName);
      return [
        ...prev,
        {
          messageId: file.fileId,
          senderId: sender ? sender.id : "peer-file",
          senderName: file.senderName,
          avatar: sender ? sender.avatar : "",
          file: {
            fileId: file.fileId,
            name: file.name,
            size: file.size,
            mimeType: file.mimeType,
            blobUrl: file.blobUrl,
          },
          timestamp: Date.now(),
        },
      ];
    });
  }, [participants]);

  const handleP2PFileOffered = useCallback((offered: { fileId: string; name: string; size: number; mimeType: string; senderId: string; senderName: string; timestamp: number }) => {
    setMessages((prev) => {
      // Don't add duplicate card if already present
      if (prev.some((m) => m.file?.fileId === offered.fileId)) {
        return prev;
      }

      const sender = participants.find((p) => p.id === offered.senderId || p.identity === offered.senderName);
      return [
        ...prev,
        {
          messageId: offered.fileId,
          senderId: offered.senderId,
          senderName: offered.senderName,
          avatar: sender ? sender.avatar : "",
          file: {
            fileId: offered.fileId,
            name: offered.name,
            size: offered.size,
            mimeType: offered.mimeType,
            blobUrl: "", // Awaiting P2P download
          },
          timestamp: offered.timestamp,
        },
      ];
    });
  }, [participants]);

  const handlePeerDisconnected = useCallback((departedId: string) => {
    setMessages((prev) => prev.filter((m) => m.senderId !== departedId));
    setParticipants((prev) => prev.filter((p) => p.id !== departedId));
  }, []);

  // WebRTC Hook
  const webRTC = useWebRTC({
    sessionId,
    roomCode,
    sendMessage,
    onTextReceived: handleP2PTextReceived,
    onFileOffered: handleP2PFileOffered,
    onFileReceived: handleP2PFileReceived,
    onPeerDisconnected: handlePeerDisconnected,
    iceServers,
  });

  // Direct LAN message handler (works when broadcaster or student has no internet)
  const handleDirectLANMessage = useCallback((msg: any) => {
    if (msg.type === "CHAT") {
      setMessages((prev) => {
        if (prev.some((m) => m.messageId === msg.messageId)) return prev;
        return [
          ...prev,
          {
            messageId: msg.messageId,
            senderId: msg.senderId,
            senderName: msg.senderName,
            avatar: msg.avatar,
            text: msg.text,
            timestamp: msg.timestamp || Date.now(),
          },
        ];
      });
    } else if (msg.type === "HAND_RAISE") {
      setMessages((prev) => [
        ...prev,
        {
          messageId: msg.messageId || safeRandomUUID(),
          senderId: msg.senderId,
          senderName: msg.senderName,
          avatar: "",
          text: `✋ ${msg.senderName} raised their hand!`,
          timestamp: Date.now(),
        },
      ]);
    }
  }, []);

  // LocalMeet Hook
  const localMeet = useLocalMeet({
    roomCode,
    sessionId,
    hostId: currentHostId,
    sendMessage,
    iceServers,
    participants,
    identityName: myIdentityName,
    avatarUrl,
    onDirectChatMessage: handleDirectLANMessage,
  });

  // Send Message coordinator
  const handleSendMessage = async (text: string) => {
    if (roomType === "timed") {
      if (!roomKey) return;
      
      const messageId = safeRandomUUID();
      
      // Render locally with optimistic buffer
      setMessages((prev) => [
        ...prev,
        {
          messageId,
          senderId: sessionId,
          senderName: myIdentityName,
          avatar: avatarUrl,
          text,
          timestamp: Date.now(),
          isSending: true,
        },
      ]);

      // Encrypt
      try {
        const currentKey = await getOrDeriveRoomKey();
        if (!currentKey) {
          console.error("[E2EE] Cannot send message: key not available");
          return;
        }
        const encrypted = await encryptText(currentKey, text);
        sendMessage(WsEventType.MESSAGE_SENT, {
          messageId,
          nonce: encrypted.iv,
          ciphertext: encrypted.ciphertext,
        });
      } catch (err) {
        console.error("[E2EE] Message encryption failed:", err);
      }
    } else if (roomType === "meet") {
      const messageId = safeRandomUUID();
      // Render locally with optimistic buffer
      setMessages((prev) => [
        ...prev,
        {
          messageId,
          senderId: sessionId,
          senderName: myIdentityName,
          avatar: avatarUrl,
          text,
          timestamp: Date.now(),
        },
      ]);

      const chatPayload = {
        type: "CHAT",
        messageId,
        senderId: sessionId,
        senderName: myIdentityName,
        avatar: avatarUrl,
        text,
        timestamp: Date.now(),
      };

      // 1. Broadcast over direct WebRTC LAN DataChannels (100% offline local Wi-Fi)
      localMeet.broadcastDirectMessage(chatPayload);

      // 2. Broadcast over WebSocket if connected
      if (isConnected) {
        sendMessage(WsEventType.MESSAGE_SENT, {
          messageId,
          text,
          senderName: myIdentityName,
        });
      }
    } else {
      // P2P Text Send
      const msgId = webRTC.sendP2PText(text, myIdentityName, avatarUrl);
      setMessages((prev) => [
        ...prev,
        {
          messageId: msgId,
          senderId: sessionId,
          senderName: myIdentityName,
          avatar: avatarUrl,
          text,
          timestamp: Date.now(),
        },
      ]);
    }
  };

  const handleSendFile = (file: File) => {
    if (roomType !== "p2p") return;
    
    // Trigger P2P file sender (registers in persistent host registry & broadcasts offer)
    const sent = webRTC.sendP2PFile(file);

    // Render local file bubble optimistically
    setMessages((prev) => [
      ...prev,
      {
        messageId: sent.fileId,
        senderId: sessionId,
        senderName: myIdentityName,
        avatar: avatarUrl,
        file: {
          fileId: sent.fileId,
          name: sent.name,
          size: sent.size,
          mimeType: sent.mimeType,
          blobUrl: URL.createObjectURL(file), // Local reference for instant view
        },
        timestamp: sent.timestamp,
      },
    ]);
  };

  const handleDownloadFile = (fileId: string, senderId: string) => {
    webRTC.requestP2PFile(fileId, senderId);
  };

  const handleNukeClick = () => {
    sendMessage(WsEventType.NUKE_VOTE_CAST, {});
  };

  if (!roomKey && roomType === "timed") {
    return (
      <div className="flex-grow flex items-center justify-center">
        <div className="text-secondaryText font-mono text-xs uppercase tracking-widest animate-pulse">
          Deriving E2EE Keys...
        </div>
      </div>
    );
  }

  if (roomType === "timed") {
    return (
      <TimedChat
        roomCode={roomCode}
        participants={participants}
        mySessionId={sessionId}
        messages={messages}
        onSendMessage={handleSendMessage}
        onNukeClick={handleNukeClick}
        onLeaveClick={onGoHome}
        nukeVotesState={nukeVotesState}
        expiresAt={expiresAt}
        isConnected={isConnected}
      />
    );
  }

  if (roomType === "meet") {
    return (
      <LocalMeet
        roomCode={roomCode}
        participants={participants}
        lanParticipants={localMeet.lanParticipants}
        mySessionId={sessionId}
        hostId={currentHostId}
        identityName={myIdentityName}
        messages={messages}
        onSendMessage={handleSendMessage}
        onNukeClick={handleNukeClick}
        onLeaveClick={onGoHome}
        nukeVotesState={nukeVotesState}
        isConnected={isConnected}
        isHost={localMeet.isHost}
        isScreenSharing={localMeet.isScreenSharing}
        isMicActive={localMeet.isMicActive}
        isHostPresenting={localMeet.isHostPresenting}
        broadcastSource={localMeet.broadcastSource}
        cameraFacingMode={localMeet.cameraFacingMode}
        broadcastError={localMeet.broadcastError}
        streamHealth={localMeet.streamHealth}
        localStream={localMeet.localStream}
        remoteStream={localMeet.remoteStream}
        qualityMode={localMeet.qualityMode}
        setQualityMode={localMeet.setQualityMode}
        activeViewersCount={localMeet.activeViewersCount}
        starViewersCount={localMeet.starViewersCount}
        relayViewersCount={localMeet.relayViewersCount}
        peerTopologyMap={localMeet.peerTopologyMap}
        connectionTopology={localMeet.connectionTopology}
        startScreenShare={localMeet.startScreenShare}
        startCameraShare={localMeet.startCameraShare}
        switchCameraFacingMode={localMeet.switchCameraFacingMode}
        stopBroadcast={localMeet.stopBroadcast}
        toggleMic={localMeet.toggleMic}
        retryStudentConnection={localMeet.retryStudentConnection}
      />
    );
  }

  return (
    <P2PChat
      roomCode={roomCode}
      participants={participants}
      mySessionId={sessionId}
      messages={messages}
      onSendMessage={handleSendMessage}
      onSendFile={handleSendFile}
      onDownloadFile={handleDownloadFile}
      onNukeClick={handleNukeClick}
      onLeaveClick={onGoHome}
      onReconnect={webRTC.reconnectAll}
      nukeVotesState={nukeVotesState}
      activePeers={webRTC.activePeers}
      fileProgress={webRTC.fileProgress}
      isConnected={isConnected}
    />
  );
};
