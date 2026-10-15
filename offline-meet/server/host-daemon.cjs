const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");
const { getLocalNetworkAddresses } = require("./network-detect.cjs");

const HTTPS_PORT = parseInt(process.env.PORT || "8443", 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || "8080", 10);
const FRONTEND_DIST_DIR = path.join(__dirname, "../../frontend/dist");
const CLIENT_DIST_DIR = fs.existsSync(FRONTEND_DIST_DIR)
  ? FRONTEND_DIST_DIR
  : path.join(__dirname, "../client/dist");
const CERT_PFX_PATH = path.join(__dirname, "certs/cert.pfx");

// 1. Detect Network Interfaces
const network = getLocalNetworkAddresses();
const primaryNet = network.primary;

// Multi-room in-memory registry
const rooms = new Map();

function getOrCreateRoom(code, initialHostKey = null) {
  const normCode = (code || "MEET01").toUpperCase();
  if (!rooms.has(normCode)) {
    rooms.set(normCode, {
      roomCode: normCode,
      hostId: null,
      hostName: "Host Presenter",
      hostKey: initialHostKey || crypto.randomUUID(),
      isBroadcasting: false,
      broadcastType: null, // "camera" | "screen"
      participants: new Map(), // sessionId => { id, identity, avatar, ws, isHost, joinedAt }
      handsRaised: new Set(),
      messages: [],
      logs: [],
    });
  }
  return rooms.get(normCode);
}

function log(msg, type = "info") {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${type.toUpperCase()}] ${msg}`);
}

// 2. MIME type mapping for static files
const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain",
};

// Helper to read request JSON body
function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        resolve({});
      }
    });
  });
}

// 3. HTTP Request Handler (Serves NukeChat PWA and Local Offline API)
async function handleHttpRequest(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // CORS headers for local LAN communication across all devices
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Private-Network", "true");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: ICE Servers
  if (pathname === "/api/ice-servers") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }));
    return;
  }

  // API: Fast Subnet Discovery
  if (pathname === "/api/discover") {
    res.writeHead(200, { "Content-Type": "application/json" });
    const firstRoom = Array.from(rooms.values())[0];
    res.end(
      JSON.stringify({
        success: true,
        hostIp: primaryNet.ip,
        sslipDomain: primaryNet.sslipDomain,
        activeRooms: Array.from(rooms.keys()),
        defaultRoomCode: firstRoom ? firstRoom.roomCode : null,
      })
    );
    return;
  }

  // API: Room Status
  if (pathname === "/api/room/status" || pathname.startsWith("/api/room/status/")) {
    const pathCode = pathname.replace("/api/room/status/", "");
    const queryRoom = (pathCode || parsedUrl.searchParams.get("room") || "").toUpperCase();
    const room = rooms.get(queryRoom);
    if (!room) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Room not found on local daemon" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        roomCode: room.roomCode,
        isBroadcasting: room.isBroadcasting,
        broadcastType: room.broadcastType,
        attendees: Array.from(room.participants.values()).map((p) => ({
          id: p.id,
          identity: p.identity,
          avatar: p.avatar,
          isHost: p.isHost,
          handRaised: room.handsRaised.has(p.id),
        })),
        handsRaisedCount: room.handsRaised.size,
      })
    );
    return;
  }

  // API: Offline Room Creation
  if (pathname === "/api/room/create" && req.method === "POST") {
    const body = await readJsonBody(req);
    const code = (body.publicCode || Math.floor(100000 + Math.random() * 900000).toString()).toUpperCase();
    const hostKey = body.hostKey || crypto.randomUUID();
    const room = getOrCreateRoom(code, hostKey);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        roomCode: room.roomCode,
        type: "meet",
        expiresAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
        salt: "offline-salt",
        hostKey: room.hostKey,
      })
    );
    return;
  }

  // API: Offline Room Join
  if (pathname === "/api/room/join" && req.method === "POST") {
    const body = await readJsonBody(req);
    const code = (body.roomCode || "").toUpperCase();
    if (!rooms.has(code)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Room not found on local daemon" }));
      return;
    }
    const room = rooms.get(code);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        roomCode: room.roomCode,
        type: "meet",
        expiresAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
        salt: "offline-salt",
        hostId: room.hostId,
      })
    );
    return;
  }

  // Serve Static Client Files from CLIENT_DIST_DIR with SPA fallback
  let filePath = path.join(CLIENT_DIST_DIR, pathname === "/" ? "index.html" : pathname);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  } else if (fs.existsSync(path.join(CLIENT_DIST_DIR, "index.html"))) {
    // SPA fallback
    res.writeHead(200, { "Content-Type": "text/html" });
    fs.createReadStream(path.join(CLIENT_DIST_DIR, "index.html")).pipe(res);
  } else {
    // Basic landing if build files not yet created
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>NukeChat Offline LAN Hub</title>
  <style>
    body { background: #0a0a0a; color: #fff; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #171717; border: 1px solid #262626; border-radius: 20px; padding: 32px; max-width: 480px; width: 100%; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h2>⚡ NukeChat Offline LAN Gateway</h2>
    <p>Please build the frontend: <code>npm run build --prefix frontend</code></p>
  </div>
</body>
</html>`);
  }
}

// 4. Create HTTPS and HTTP Servers
let httpsServer = null;
if (fs.existsSync(CERT_PFX_PATH)) {
  try {
    httpsServer = https.createServer(
      {
        pfx: fs.readFileSync(CERT_PFX_PATH),
        passphrase: "nukechat",
      },
      handleHttpRequest
    );
  } catch (err) {
    log(`Failed to initialize HTTPS certificate: ${err.message}`, "warn");
  }
}

const httpServer = http.createServer(handleHttpRequest);

// 5. Shared WebSocket Signaling Server attached to both ports
const wss = new WebSocketServer({ noServer: true });

function handleUpgrade(req, socket, head) {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
}

httpServer.on("upgrade", handleUpgrade);
if (httpsServer) {
  httpsServer.on("upgrade", handleUpgrade);
}

wss.on("connection", (ws, req) => {
  const parsedUrl = new URL(req.url, "http://localhost");
  const pathParts = parsedUrl.pathname.split("/").filter(Boolean);

  let roomCode = "MEET01";
  if (pathParts[0] === "ws" && pathParts[1] === "room" && pathParts[2]) {
    roomCode = pathParts[2].toUpperCase();
  } else if (parsedUrl.searchParams.get("room")) {
    roomCode = parsedUrl.searchParams.get("room").toUpperCase();
  }

  const room = getOrCreateRoom(roomCode);
  const sessionId = parsedUrl.searchParams.get("sessionId") || crypto.randomUUID();
  let participantName = parsedUrl.searchParams.get("identity") || "Attendee";
  let participantAvatar = parsedUrl.searchParams.get("avatar") || "";
  const providedHostKey = parsedUrl.searchParams.get("hostKey");
  const isHostKeyMatch = !!(providedHostKey && room.hostKey && providedHostKey === room.hostKey);

  // Check if an existing host is currently connected and active
  const existingHost = room.hostId ? room.participants.get(room.hostId) : null;
  const isHostAlive = existingHost && existingHost.ws && existingHost.ws.readyState === WebSocket.OPEN;

  // A participant is host IF AND ONLY IF:
  // 1. Same sessionId as existing host (reconnection)
  // 2. Matching hostKey AND the previous host is no longer actively connected (failover / restore)
  // 3. Very first connection setting up an ad-hoc room with isHost=true
  let isHost = false;
  if (sessionId === room.hostId) {
    isHost = true;
    room.hostName = participantName;
  } else if (isHostKeyMatch) {
    if (!isHostAlive) {
      isHost = true;
      room.hostId = sessionId;
      room.hostName = participantName;
      log(`[WS] Host role reclaimed by ${participantName} (${sessionId})`);
    } else {
      log(`[WS] ${participantName} provided hostKey but active host (${room.hostId}) is already connected. Joining as attendee.`);
      isHost = false;
    }
  } else if (!room.hostId && parsedUrl.searchParams.get("isHost") === "true") {
    isHost = true;
    room.hostId = sessionId;
    room.hostName = participantName;
    if (providedHostKey) {
      room.hostKey = providedHostKey;
    }
  }

  room.participants.set(sessionId, {
    id: sessionId,
    identity: participantName,
    avatar: participantAvatar,
    isHost,
    ws,
    joinedAt: Date.now(),
  });

  log(`[WS] ${participantName} (${sessionId}) joined room ${roomCode} (isHost: ${isHost})`);

  const activeParticipants = Array.from(room.participants.values()).map((p) => ({
    id: p.id,
    identity: p.identity,
    avatar: p.avatar,
    isHost: p.isHost,
  }));

  const broadcastRoom = (msg, excludeId = null) => {
    const data = typeof msg === "string" ? msg : JSON.stringify(msg);
    for (const [id, p] of room.participants.entries()) {
      if (id !== excludeId && p.ws.readyState === WebSocket.OPEN) {
        try {
          p.ws.send(data);
        } catch (e) {}
      }
    }
  };

  // 1. Send ROOM_JOINED confirmation to the joining peer
  ws.send(
    JSON.stringify({
      type: "ROOM_JOINED",
      senderId: sessionId,
      timestamp: Date.now(),
      payload: {
        identity: participantName,
        avatar: participantAvatar,
        joinedAt: Date.now(),
        participants: activeParticipants,
        hostId: room.hostId,
        isBroadcasting: room.isBroadcasting,
        broadcastType: room.broadcastType,
      },
    })
  );

  // 2. Broadcast ROOM_JOINED to existing participants in the room
  broadcastRoom(
    {
      type: "ROOM_JOINED",
      senderId: sessionId,
      timestamp: Date.now(),
      payload: {
        identity: participantName,
        avatar: participantAvatar,
        joinedAt: Date.now(),
        participants: activeParticipants,
        hostId: room.hostId,
      },
    },
    sessionId
  );

  ws.on("message", (raw) => {
    try {
      const envelope = JSON.parse(raw);

      switch (envelope.type) {
        case "SIGNAL": {
          // Relays WebRTC SDP Offer, SDP Answer, and ICE Candidate directly to target peer
          const targetId = envelope.payload?.targetId || envelope.targetId;
          const signal = envelope.payload?.signal !== undefined ? envelope.payload.signal : envelope.signal;

          if (targetId && room.participants.has(targetId)) {
            const target = room.participants.get(targetId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(
                JSON.stringify({
                  type: "SIGNAL",
                  senderId: sessionId,
                  timestamp: Date.now(),
                  payload: {
                    senderId: sessionId,
                    signal: signal,
                  },
                })
              );
            }
          }
          break;
        }

        case "MESSAGE_SENT": {
          const text = envelope.payload?.text || "";
          const msgObj = {
            messageId: envelope.payload?.messageId || crypto.randomUUID(),
            senderId: sessionId,
            senderName: participantName,
            avatar: participantAvatar,
            text,
            timestamp: Date.now(),
          };
          room.messages.push(msgObj);
          if (room.messages.length > 500) room.messages.shift();
          broadcastRoom({
            type: "MESSAGE_BROADCAST",
            senderId: sessionId,
            timestamp: Date.now(),
            payload: msgObj,
          });
          break;
        }

        case "HAND_RAISE": {
          const raised = !!envelope.payload?.raised;
          if (raised) {
            room.handsRaised.add(sessionId);
          } else {
            room.handsRaised.delete(sessionId);
          }
          broadcastRoom({
            type: "HAND_RAISE_UPDATE",
            senderId: sessionId,
            timestamp: Date.now(),
            payload: {
              sessionId,
              name: participantName,
              raised,
              handsCount: room.handsRaised.size,
            },
          });
          break;
        }

        case "BROADCAST_STATUS": {
          if (isHost || sessionId === room.hostId) {
            room.isBroadcasting = !!envelope.payload?.isBroadcasting;
            room.broadcastType = envelope.payload?.broadcastType || null;
            log(`[Broadcast] Room ${roomCode} status: ${room.isBroadcasting ? "STREAMING" : "STOPPED"}`);
            broadcastRoom({
              type: "STREAM_STATUS",
              senderId: sessionId,
              timestamp: Date.now(),
              payload: {
                isBroadcasting: room.isBroadcasting,
                broadcastType: room.broadcastType,
                hostId: room.hostId,
              },
            });
          }
          break;
        }

        case "HEARTBEAT": {
          // Keep-alive acknowledgment
          break;
        }
      }
    } catch (err) {
      log(`Error processing WS message: ${err.message}`, "error");
    }
  });

  ws.on("close", () => {
    room.participants.delete(sessionId);
    room.handsRaised.delete(sessionId);

    const remaining = Array.from(room.participants.values()).map((p) => ({
      id: p.id,
      identity: p.identity,
      avatar: p.avatar,
      isHost: p.isHost,
    }));

    if (sessionId === room.hostId) {
      log(`[WS] Host disconnected from room ${roomCode} (retaining host authority for host return)`);
      room.isBroadcasting = false;
      broadcastRoom({
        type: "STREAM_STATUS",
        senderId: sessionId,
        timestamp: Date.now(),
        payload: {
          isBroadcasting: false,
          broadcastType: null,
          hostId: room.hostId,
        },
      });
    } else {
      log(`[WS] ${participantName} disconnected from room ${roomCode}`);
    }

    broadcastRoom({
      type: "PEER_LEFT",
      senderId: sessionId,
      timestamp: Date.now(),
      payload: {
        participantId: sessionId,
        participants: remaining,
      },
    });
  });
});

// 6. Launch Servers
httpServer.listen(HTTP_PORT, "0.0.0.0", () => {
  log(`⚡ NukeChat HTTP & WebSocket Gateway listening on http://0.0.0.0:${HTTP_PORT}`);
});

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, "0.0.0.0", () => {
    log(`🔒 NukeChat Secure HTTPS Gateway listening on https://${primaryNet.sslipDomain}:${HTTPS_PORT}`);
  });
}

console.log("\n============================================================");
console.log("            ⚡ NukeChat Offline LAN Broadcasting Hub        ");
console.log("============================================================");
console.log(`📡 Local Network    : ${primaryNet.type} (${primaryNet.ip})`);
console.log(`📲 Direct LAN URL   : http://${primaryNet.ip}:${HTTP_PORT}`);
if (httpsServer) {
  console.log(`🔒 HTTPS Domain     : https://${primaryNet.sslipDomain}:${HTTPS_PORT}`);
}
console.log(`📁 Client Bundle    : ${CLIENT_DIST_DIR}`);
console.log("------------------------------------------------------------");
console.log(`👉 ATTENDEES ON WI-FI: Open http://${primaryNet.ip}:${HTTP_PORT} on their phones`);
console.log("   Then enter the 6-digit Room Code to stream with 0 KB internet!");
console.log("============================================================\n");
