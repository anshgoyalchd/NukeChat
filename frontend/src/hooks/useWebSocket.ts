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
  const [isLocalDaemon, setIsLocalDaemon] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<any>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const reconnectAttemptsCounter = useRef(0);

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

  const probeLocalDaemon = useCallback(async (): Promise<string | null> => {
    if (typeof window === "undefined") return null;

    const isHttps = window.location.protocol === "https:";
    const isLocalOrigin =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.port === "8080" ||
      window.location.port === "8443";

    const candidates: string[] = [];
    if (isLocalOrigin) {
      candidates.push(window.location.origin);
    }

    // Check if user or previous session saved a custom Host IP on this Wi-Fi
    const customHostIp = typeof localStorage !== "undefined" ? localStorage.getItem("nukechat_custom_host_ip") : null;
    if (customHostIp && customHostIp.trim()) {
      const cleanIp = customHostIp.trim().replace(/^https?:\/\//, "").replace(/:\d+$/, "");
      if (!isHttps) {
        candidates.push(`http://${cleanIp}:8080`);
      }
      candidates.push(`https://${cleanIp.replace(/\./g, "-")}.sslip.io:8443`);
    }

    if (!isHttps) {
      candidates.push("http://localhost:8080");
      candidates.push("http://192.168.43.1:8080");
      candidates.push("http://172.20.10.1:8080");
    } else {
      candidates.push("https://localhost:8443");
      candidates.push("https://192-168-43-1.sslip.io:8443");
      candidates.push("https://172-20-10-1.sslip.io:8443");
    }

    for (const origin of candidates) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 700);
        const res = await fetch(`${origin}/api/discover`, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          if (data && data.success) {
            console.log("[WebSocket] Discovered local offline daemon at:", origin);
            if (data.hostIp && typeof localStorage !== "undefined") {
              localStorage.setItem("nukechat_custom_host_ip", data.hostIp);
            }
            return origin;
          }
        }
      } catch (e) {}
    }
    return null;
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const hostKey =
      (typeof localStorage !== "undefined" &&
        localStorage.getItem(`nukechat_host_key_${roomCode}`)) ||
      "";
    const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

    const setupSocket = (targetWsUrl: string, isLocal: boolean) => {
      try {
        const ws = new WebSocket(targetWsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          setIsLocalDaemon(isLocal);
          setConnectionError(null);
          reconnectAttemptsCounter.current = 0;
          
          // Start Heartbeat: PING every 40s
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
          
          if (!isMountedRef.current) return;
          if (event.code === 1000 || event.reason === "Clean Close" || event.reason === "ROOM_NUKED" || event.reason === "ROOM_EXPIRED") {
            return;
          }

          const delay = Math.min(500 * Math.pow(1.3, Math.min(reconnectAttemptsCounter.current, 5)), 3000);
          reconnectAttemptsCounter.current += 1;
          
          if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        };

        ws.onerror = () => {
          setIsConnected(false);
        };
      } catch (err: any) {
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      }
    };

    // If offline or if connection has previously failed, probe local daemon first
    if (isOffline || reconnectAttemptsCounter.current >= 1) {
      probeLocalDaemon().then((localDaemonOrigin) => {
        if (localDaemonOrigin) {
          const localWsBase = localDaemonOrigin.replace(/^http/, "ws");
          const localWsUrl = `${localWsBase}/ws/room/${roomCode}?sessionId=${sessionId}&identity=${encodeURIComponent(
            identityName
          )}&avatar=${encodeURIComponent(avatarUrl)}${hostKey ? `&hostKey=${encodeURIComponent(hostKey)}` : ""}`;
          setupSocket(localWsUrl, true);
          return;
        }

        if (isOffline) {
          setIsConnected(false);
          return;
        }

        const cloudWsBase = backendUrl.replace(/^http/, "ws");
        const cloudWsUrl = `${cloudWsBase}/ws/room/${roomCode}?sessionId=${sessionId}&identity=${encodeURIComponent(
          identityName
        )}&avatar=${encodeURIComponent(avatarUrl)}${hostKey ? `&hostKey=${encodeURIComponent(hostKey)}` : ""}`;
        setupSocket(cloudWsUrl, false);
      });
      return;
    }

    const cloudWsBase = backendUrl.replace(/^http/, "ws");
    const cloudWsUrl = `${cloudWsBase}/ws/room/${roomCode}?sessionId=${sessionId}&identity=${encodeURIComponent(
      identityName
    )}&avatar=${encodeURIComponent(avatarUrl)}${hostKey ? `&hostKey=${encodeURIComponent(hostKey)}` : ""}`;
    setupSocket(cloudWsUrl, false);
  }, [roomCode, sessionId, identityName, avatarUrl, backendUrl, probeLocalDaemon]);

  // Immediately reconnect when network connectivity returns
  useEffect(() => {
    const handleOnline = () => {
      console.log("[WebSocket] Network restored, reconnecting immediately...");
      reconnectAttemptsCounter.current = 0;
      connect();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [connect]);

  const bcRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel !== "undefined") {
      const bc = new BroadcastChannel(`nukechat_room_bc_${roomCode}`);
      bcRef.current = bc;
      bc.onmessage = (event) => {
        try {
          const envelope: WsEnvelope = event.data;
          if (envelope && envelope.senderId !== sessionId) {
            onMessageRef.current(envelope);
          }
        } catch (e) {
          console.warn("[BC] Error processing broadcast channel event:", e);
        }
      };

      // Announce presence so offline peers / host on local tabs or device detect us immediately
      const announceTimer = setTimeout(() => {
        if (bcRef.current) {
          bcRef.current.postMessage({
            type: "PEER_ANNOUNCE",
            senderId: sessionId,
            timestamp: Date.now(),
            payload: {
              identity: identityName,
              avatar: avatarUrl,
            },
          });
        }
      }, 100);

      return () => {
        clearTimeout(announceTimer);
        bc.close();
        bcRef.current = null;
      };
    }
  }, [roomCode, sessionId, identityName, avatarUrl]);

  const sendMessage = useCallback((type: string, payload: any) => {
    const envelope: WsEnvelope = {
      type: type as any,
      senderId: sessionId,
      timestamp: Date.now(),
      payload,
    };

    // 1. Send via WebSocket if open
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(envelope));
      } catch (e) {}
    }

    // 2. Broadcast via BroadcastChannel for 0 KB local / multi-tab offline peer discovery & signaling
    if (bcRef.current) {
      try {
        bcRef.current.postMessage(envelope);
      } catch (e) {}
    }
  }, [sessionId]);

  const closeAll = () => {
    if (bcRef.current) {
      try {
        bcRef.current.postMessage({
          type: WsEventType.PEER_LEFT,
          senderId: sessionId,
          timestamp: Date.now(),
          payload: { participantId: sessionId },
        });
      } catch (e) {}
    }
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
    isLocalDaemon,
    connectionError,
    sendMessage,
    reconnect: connect,
  };
};
