const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");
const { getLocalNetworkAddresses } = require("./network-detect.cjs");

const HTTPS_PORT = parseInt(process.env.PORT || "8443", 10);
const HTTP_PORT = 8080;
const CLIENT_DIST_DIR = path.join(__dirname, "../client/dist");
const CERT_PFX_PATH = path.join(__dirname, "certs/cert.pfx");

// 1. Detect Network Interfaces
const network = getLocalNetworkAddresses();
const primaryNet = network.primary;

// In-Memory Room State
const state = {
  roomCode: Math.floor(100000 + Math.random() * 900000).toString(),
  hostId: null,
  hostName: "Host Presenter",
  isBroadcasting: false,
  broadcastType: null, // "camera" | "screen"
  participants: new Map(), // sessionId => { id, name, avatar, ws, isHost, joinedAt }
  handsRaised: new Set(),
  messages: [],
  logs: [],
};

function log(msg, type = "info") {
  const time = new Date().toLocaleTimeString();
  state.logs.unshift({ time, msg, type });
  if (state.logs.length > 100) state.logs.pop();
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
};

// 3. HTTP Request Handler (Serves PWA and Discovery API)
function handleHttpRequest(req, res) {
  const parsedUrl = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // CORS headers for local LAN communication
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: Fast Subnet Discovery
  if (pathname === "/api/discover") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        roomCode: state.roomCode,
        hostName: state.hostName,
        isBroadcasting: state.isBroadcasting,
        broadcastType: state.broadcastType,
        attendeeCount: Math.max(0, state.participants.size - (state.hostId ? 1 : 0)),
        hostIp: primaryNet.ip,
        sslipDomain: primaryNet.sslipDomain,
      })
    );
    return;
  }

  // API: Room Status
  if (pathname === "/api/room/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        roomCode: state.roomCode,
        isBroadcasting: state.isBroadcasting,
        broadcastType: state.broadcastType,
        attendees: Array.from(state.participants.values()).map((p) => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          isHost: p.isHost,
          handRaised: state.handsRaised.has(p.id),
        })),
        handsRaisedCount: state.handsRaised.size,
      })
    );
    return;
  }

  // Serve Static Client Files from client/dist (if compiled), or a fallback dashboard
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
    // Fallback landing if client/dist is not built yet
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>OfflineMeet Hub</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { background: #0a0a0a; color: #fff; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
    .card { background: #171717; border: 1px solid #262626; border-radius: 20px; padding: 32px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
    .badge { display: inline-block; background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4); padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; margin-bottom: 12px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    p { color: #a3a3a3; font-size: 13px; line-height: 1.5; margin: 0 0 24px; }
    .code { font-size: 32px; font-weight: 900; letter-spacing: 4px; color: #10b981; font-family: monospace; background: #000; padding: 12px; border-radius: 12px; margin-bottom: 20px; border: 1px solid #333; }
    .info { font-size: 12px; color: #737373; text-align: left; background: #202020; padding: 12px; border-radius: 10px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">⚡ Offline Star LAN Gateway</div>
    <h1>OfflineMeet Hub</h1>
    <p>Connected locally with 0 KB internet consumption.</p>
    <div class="code">${state.roomCode}</div>
    <div class="info">
      <div><b>Host IP:</b> ${primaryNet.ip} (${primaryNet.type})</div>
      <div><b>Domain:</b> https://${primaryNet.sslipDomain}:${HTTPS_PORT}</div>
    </div>
    <p style="font-size: 11px; color: #525252;">Building client bundle... Refresh shortly.</p>
  </div>
</body>
</html>`);
  }
}

// 4. Create HTTPS Server with PFX credentials
let server;
if (fs.existsSync(CERT_PFX_PATH)) {
  server = https.createServer(
    {
      pfx: fs.readFileSync(CERT_PFX_PATH),
      passphrase: "nukechat",
    },
    handleHttpRequest
  );
} else {
  log("cert.pfx not found, falling back to HTTP", "warn");
  server = http.createServer(handleHttpRequest);
}

// Also create an HTTP redirect server on port 8080 to route users to HTTPS
http
  .createServer((req, res) => {
    res.writeHead(301, {
      Location: `https://${primaryNet.sslipDomain}:${HTTPS_PORT}${req.url}`,
    });
    res.end();
  })
  .listen(HTTP_PORT, () => {
    log(`HTTP redirect gateway listening on http://${primaryNet.ip}:${HTTP_PORT}`);
  });

// 5. WebSocket Signaling Hub
const wss = new WebSocketServer({ server, path: "/ws/offline" });

function broadcast(msg, excludeId = null) {
  const data = typeof msg === "string" ? msg : JSON.stringify(msg);
  for (const [id, p] of state.participants.entries()) {
    if (id !== excludeId && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  }
}

wss.on("connection", (ws, req) => {
  const parsedUrl = new URL(req.url, "https://localhost");
  const queryRoom = parsedUrl.searchParams.get("room") || state.roomCode;
  const isHostClaim = parsedUrl.searchParams.get("isHost") === "true";

  let sessionId = crypto.randomUUID();
  let participantName = "Attendee";
  let participantAvatar = "";

  ws.on("message", (raw) => {
    try {
      const envelope = JSON.parse(raw);

      switch (envelope.type) {
        case "JOIN": {
          sessionId = envelope.sessionId || sessionId;
          participantName = envelope.identity || "Attendee";
          participantAvatar = envelope.avatar || "";

          const isHost = isHostClaim || envelope.isHost === true;
          if (isHost) {
            state.hostId = sessionId;
            state.hostName = participantName;
          }

          state.participants.set(sessionId, {
            id: sessionId,
            name: participantName,
            avatar: participantAvatar,
            isHost,
            ws,
            joinedAt: Date.now(),
          });

          log(`[WS] ${participantName} joined (isHost: ${isHost})`);

          // Send confirmation to joining peer
          ws.send(
            JSON.stringify({
              type: "ROOM_JOINED",
              roomCode: state.roomCode,
              sessionId,
              isHost,
              hostId: state.hostId,
              isBroadcasting: state.isBroadcasting,
              broadcastType: state.broadcastType,
              participants: Array.from(state.participants.values()).map((p) => ({
                id: p.id,
                identity: p.name,
                avatar: p.avatar,
                isHost: p.isHost,
              })),
            })
          );

          // Broadcast PEER_JOINED to other attendees
          broadcast(
            {
              type: "PEER_JOINED",
              peer: {
                id: sessionId,
                identity: participantName,
                avatar: participantAvatar,
                isHost,
              },
            },
            sessionId
          );
          break;
        }

        case "SIGNAL": {
          // Relays WebRTC SDP Offer, SDP Answer, and ICE Candidate directly to target peer
          const targetId = envelope.targetId || envelope.payload?.targetId;
          const signal = envelope.signal !== undefined ? envelope.signal : envelope.payload?.signal;
          if (targetId && state.participants.has(targetId)) {
            const target = state.participants.get(targetId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(
                JSON.stringify({
                  type: "SIGNAL",
                  senderId: sessionId,
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

        case "BROADCAST_STATUS": {
          // Host announces video/screen broadcast started or stopped
          const p = state.participants.get(sessionId);
          if (isHostClaim || (p && p.isHost) || sessionId === state.hostId) {
            state.hostId = sessionId;
            state.isBroadcasting = !!envelope.payload?.isBroadcasting;
            state.broadcastType = envelope.payload?.broadcastType || null;
            log(`[Broadcast] Host status: ${state.isBroadcasting ? "STREAMING (" + state.broadcastType + ")" : "STOPPED"}`);
            broadcast({
              type: "STREAM_STATUS",
              payload: {
                isBroadcasting: state.isBroadcasting,
                broadcastType: state.broadcastType,
                hostId: state.hostId,
              },
            });
          }
          break;
        }

        case "HAND_RAISE": {
          const raised = !!envelope.payload?.raised;
          if (raised) {
            state.handsRaised.add(sessionId);
          } else {
            state.handsRaised.delete(sessionId);
          }
          broadcast({
            type: "HAND_RAISE_UPDATE",
            payload: {
              sessionId,
              name: participantName,
              raised,
              handsCount: state.handsRaised.size,
            },
          });
          break;
        }

        case "MESSAGE_SENT": {
          const msgObj = {
            messageId: crypto.randomUUID(),
            senderId: sessionId,
            senderName: participantName,
            avatar: participantAvatar,
            text: envelope.payload?.text || "",
            timestamp: Date.now(),
          };
          state.messages.push(msgObj);
          if (state.messages.length > 500) state.messages.shift();
          broadcast({
            type: "MESSAGE_BROADCAST",
            payload: msgObj,
          });
          break;
        }
      }
    } catch (err) {
      log(`Error processing WS message: ${err.message}`, "error");
    }
  });

  ws.on("close", () => {
    state.participants.delete(sessionId);
    state.handsRaised.delete(sessionId);

    if (sessionId === state.hostId) {
      state.hostId = null;
      state.isBroadcasting = false;
      state.broadcastType = null;
      log(`[WS] Host departed room`);
      broadcast({
        type: "STREAM_STATUS",
        payload: {
          isBroadcasting: false,
          broadcastType: null,
          hostId: null,
        },
      });
    } else {
      log(`[WS] ${participantName} disconnected`);
    }

    broadcast({
      type: "PEER_LEFT",
      peerId: sessionId,
      participantsCount: state.participants.size,
    });
  });
});

// 6. Launch HTTPS Server
server.listen(HTTPS_PORT, "0.0.0.0", () => {
  const hostUrl = `https://${primaryNet.sslipDomain}:${HTTPS_PORT}/#/?host=true&room=${state.roomCode}`;
  const studentUrl = `https://${primaryNet.sslipDomain}:${HTTPS_PORT}/#/?room=${state.roomCode}`;

  console.log("\n============================================================");
  console.log("            ⚡ OfflineMeet LAN Broadcasting Hub             ");
  console.log("============================================================");
  console.log(`📡 Network Mode     : ${primaryNet.type} (${primaryNet.ip})`);
  console.log(`🎯 Room Code        : ${state.roomCode}`);
  console.log(`🔒 Secure HTTPS     : https://${primaryNet.sslipDomain}:${HTTPS_PORT}`);
  console.log(`📲 HTTP Redirect    : http://${primaryNet.ip}:${HTTP_PORT}`);
  console.log("------------------------------------------------------------");
  console.log(`👑 Host Console URL : ${hostUrl}`);
  console.log(`👥 Student Join URL : ${studentUrl}`);
  console.log("============================================================\n");
  log("OfflineMeet Hub is ready for offline connections.");
});
