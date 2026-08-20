import React, { useState, useEffect, useCallback } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useWebRTC } from "../hooks/useWebRTC";
import { deriveRoomKey, encryptText, decryptText } from "../utils/crypto";
import { TimedChat } from "./TimedChat";
import { P2PChat } from "./P2PChat";
import { WsEnvelope, WsEventType, Participant } from "../../../shared/types";

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
  roomType: "timed" | "p2p";
  sessionId: string;
  identityName: string;
  avatarUrl: string;
  salt: string;
  expiresAt: string;
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
  onGoHome,
  onRoomNuked,
  onRoomExpired,
  backendUrl,
}) => {
  const [roomKey, setRoomKey] = useState<CryptoKey | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [nukeVotesState, setNukeVotesState] = useState({ votesCount: 0, neededVotes: 0 });
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ]);

  // Fetch TURN server credentials for P2P mode on mount
  useEffect(() => {
    if (roomType === "p2p") {
      fetch(`${backendUrl}/api/ice-servers`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.iceServers) {
            console.log("[P2P] Fetched custom TURN/STUN ICE servers.");
            setIceServers(data.iceServers);
          }
        })
        .catch((err) => {
          console.error("[P2P] Failed to fetch TURN credentials, falling back to STUN:", err);
        });
    }
  }, [roomType, backendUrl]);

  // Derive E2EE Key from room credentials on load
  useEffect(() => {
    if (roomType === "timed") {
      console.log("[E2EE] Starting key derivation. Params:", { roomCode, salt, roomType });
      deriveRoomKey(roomCode, salt)
        .then((key) => {
          console.log("[E2EE] Key derivation successful.");
          setRoomKey(key);
        })
        .catch((err) => {
          console.error("[E2EE] Key derivation failed:", err);
        });
    }
  }, [roomCode, salt, roomType]);

  // WebSocket event handler
  const handleWebSocketMessage = useCallback(async (envelope: WsEnvelope) => {
    switch (envelope.type) {
      case WsEventType.ROOM_JOINED: {
        const payload = envelope.payload;
        setParticipants(payload.participants);

        // Notify WebRTC peer manager of list changes in P2P Mode
        if (roomType === "p2p") {
          webRTC.handleRoomJoined(
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
        setParticipants(payload.participants);

        // Notify WebRTC peer manager of peer left
        if (roomType === "p2p") {
          webRTC.handlePeerLeft(envelope.senderId);
        }
        break;
      }

      case WsEventType.MESSAGE_BROADCAST: {
        if (!roomKey) return;
        const payload = envelope.payload;

        // Decrypt ciphertext on the fly
        try {
          const decryptedText = await decryptText(roomKey, payload.ciphertext, payload.nonce);
          
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
        }
        break;
      }

      case "HISTORY": {
        // Decrypt historical messages when joining a Timed Chat
        if (!roomKey) return;
        const payload = envelope.payload || [];
        const histMsgs: UIMessage[] = [];

        for (const item of payload) {
          try {
            const dec = await decryptText(roomKey, item.ciphertext, item.nonce);
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
  }, [roomKey, roomType, participants]);

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
  const handleP2PTextReceived = useCallback((msg: { messageId: string; senderId: string; senderName: string; text: string; timestamp: number }) => {
    const sender = participants.find((p) => p.id === msg.senderId);
    setMessages((prev) => [
      ...prev,
      {
        messageId: msg.messageId,
        senderId: msg.senderId,
        senderName: msg.senderName,
        avatar: sender ? sender.avatar : "",
        text: msg.text,
        timestamp: msg.timestamp,
      },
    ]);
  }, [participants]);

  const handleP2PFileReceived = useCallback((file: { fileId: string; name: string; size: number; mimeType: string; blobUrl: string; senderName: string }) => {
    // Find sender avatar
    const sender = participants.find((p) => p.identity === file.senderName);
    setMessages((prev) => [
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
    ]);
  }, [participants]);

  // WebRTC Hook
  const webRTC = useWebRTC({
    sessionId,
    roomCode,
    sendMessage,
    onTextReceived: handleP2PTextReceived,
    onFileReceived: handleP2PFileReceived,
    iceServers,
  });

  // Send Message coordinator
  const handleSendMessage = async (text: string) => {
    if (roomType === "timed") {
      if (!roomKey) return;
      
      const messageId = crypto.randomUUID();
      
      // Render locally with optimistic buffer
      setMessages((prev) => [
        ...prev,
        {
          messageId,
          senderId: sessionId,
          senderName: identityName,
          avatar: avatarUrl,
          text,
          timestamp: Date.now(),
          isSending: true,
        },
      ]);

      // Encrypt
      try {
        const encrypted = await encryptText(roomKey, text);
        sendMessage(WsEventType.MESSAGE_SENT, {
          messageId,
          nonce: encrypted.iv,
          ciphertext: encrypted.ciphertext,
        });
      } catch (err) {
        // Handle error
      }
    } else {
      // P2P Text Send
      const msgId = webRTC.sendP2PText(text);
      setMessages((prev) => [
        ...prev,
        {
          messageId: msgId,
          senderId: sessionId,
          senderName: identityName,
          avatar: avatarUrl,
          text,
          timestamp: Date.now(),
        },
      ]);
    }
  };

  const handleSendFile = (file: File) => {
    if (roomType !== "p2p") return;
    
    // Trigger P2P file sender
    webRTC.sendP2PFile(file);

    // Render local file bubble optimistically
    setMessages((prev) => [
      ...prev,
      {
        messageId: crypto.randomUUID(),
        senderId: sessionId,
        senderName: identityName,
        avatar: avatarUrl,
        file: {
          fileId: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          mimeType: file.type,
          blobUrl: URL.createObjectURL(file), // Local reference for instant view
        },
        timestamp: Date.now(),
      },
    ]);
  };

  const handleNukeClick = () => {
    sendMessage(WsEventType.NUKE_VOTE_CAST, {});
  };

  if (roomType === "timed") {
    return (
      <TimedChat
        roomCode={roomCode}
        participants={participants}
        mySessionId={sessionId}
        expiresAt={expiresAt}
        messages={messages}
        onSendMessage={handleSendMessage}
        onNukeClick={handleNukeClick}
        onLeaveClick={onGoHome}
        nukeVotesState={nukeVotesState}
        isConnected={isConnected}
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
      onNukeClick={handleNukeClick}
      onLeaveClick={onGoHome}
      nukeVotesState={nukeVotesState}
      activePeers={webRTC.activePeers}
      fileProgress={webRTC.fileProgress}
      isConnected={isConnected}
    />
  );
};
