import { useEffect, useRef, useState, useCallback } from "react";
import { WsEnvelope, WsEventType } from "../../../shared/types";

interface UseWebSocketProps {
  roomCode: string;
  sessionId: string;
  identityName: string;
  avatarUrl: string;
  onMessageReceived: (envelope: WsEnvelope) => void;
  onRoomNuked: () => void;
  onRoomExpired: () => void;
  backendUrl: string;
}

export const useWebSocket = ({
  roomCode,
  sessionId,
  identityName,
  avatarUrl,
  onMessageReceived,
  onRoomNuked,
  onRoomExpired,
  backendUrl,
}: UseWebSocketProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<any>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const reconnectAttemptsRef = useRef(0);

  const isMountedRef = useRef(true);

  // Store callbacks in mutable refs to prevent reference changes from restarting the WebSocket
  const onMessageRef = useRef(onMessageReceived);
  const onNukeRef = useRef(onRoomNuked);
  const onExpireRef = useRef(onRoomExpired);

  useEffect(() => {
    onMessageRef.current = onMessageReceived;
    onNukeRef.current = onRoomNuked;
    onExpireRef.current = onRoomExpired;
  }, [onMessageReceived, onRoomNuked, onRoomExpired]);
 
  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
 
    // Convert HTTP url to WS/WSS URL
    let wsBaseUrl = backendUrl.replace(/^http/, "ws");
    const hostKey = (typeof localStorage !== "undefined" && localStorage.getItem(`nukechat_host_key_${roomCode}`)) || "";
    const wsUrl = `${wsBaseUrl}/ws/room/${roomCode}?sessionId=${sessionId}&identity=${encodeURIComponent(
      identityName
    )}&avatar=${encodeURIComponent(avatarUrl)}${hostKey ? `&hostKey=${encodeURIComponent(hostKey)}` : ""}`;
 
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
 
      ws.onopen = () => {
        setIsConnected(true);
        setConnectionError(null);
        reconnectAttemptsRef.current = 0;
        
        // Start Heartbeat: PING every 40s to support DO Hibernation keep-alive
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: WsEventType.HEARTBEAT, senderId: sessionId, timestamp: Date.now(), payload: {} }));
          }
        }, 40000);
      };
 
      ws.onmessage = (event) => {
        try {
          const envelope: WsEnvelope = JSON.parse(event.data);
          
          if (envelope.type === "ROOM_NUKED") {
            onNukeRef.current();
            closeAll();
          } else if (envelope.type === "ROOM_EXPIRED") {
            onExpireRef.current();
            closeAll();
          } else {
            onMessageRef.current(envelope);
          }
        } catch (err) {
          // Ignore parse errors
        }
      };
 
      ws.onclose = (event) => {
        setIsConnected(false);
        clearInterval(pingIntervalRef.current);
        
        // If the hook has unmounted, do not attempt to reconnect
        if (!isMountedRef.current) {
          return;
        }

        // If closed cleanly or because of nuke or expiration, do not auto-reconnect
        if (event.code === 1000 || event.reason === "Clean Close" || event.reason === "ROOM_NUKED" || event.reason === "ROOM_EXPIRED") {
          return;
        }
 
        // Auto-reconnect with fast retry (never give up permanently while mounted, retry every 3s max)
        const delay = Math.min(500 * Math.pow(1.3, Math.min(reconnectAttemptsRef.current, 5)), 3000);
        reconnectAttemptsRef.current += 1;
        
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };
 
      ws.onerror = () => {
        setIsConnected(false);
      };
    } catch (err: any) {
      // Re-schedule connection attempt if network is offline
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 5000);
    }
  }, [roomCode, sessionId, identityName, avatarUrl, backendUrl]);

  // Immediately reconnect when network connectivity returns
  useEffect(() => {
    const handleOnline = () => {
      console.log("[WebSocket] Network restored, reconnecting immediately...");
      reconnectAttemptsRef.current = 0;
      connect();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [connect]);

  const sendMessage = useCallback((type: string, payload: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type,
          senderId: sessionId,
          timestamp: Date.now(),
          payload,
        })
      );
    }
  }, [sessionId]);

  const closeAll = () => {
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: WsEventType.ROOM_LEFT,
              senderId: sessionId,
              timestamp: Date.now(),
              payload: {},
            })
          );
        }
      } catch (e) {}
      wsRef.current.close(1000, "Clean Close");
      wsRef.current = null;
    }
    setIsConnected(false);
    clearInterval(pingIntervalRef.current);
    clearTimeout(reconnectTimeoutRef.current);
  };

  useEffect(() => {
    isMountedRef.current = true;
    connect();
    return () => {
      isMountedRef.current = false;
      closeAll();
    };
  }, [connect]);

  return {
    isConnected,
    connectionError,
    sendMessage,
  };
};
