import { Hono } from "hono";
import { cors } from "hono/cors";
import { WORDS } from "./utils/words";
import { RoomType, RoomVisibility } from "../../shared/types";

// Hono bindings interface
export interface Env {
  ROOM_DO: DurableObjectNamespace;
  MATCHMAKING_DO: DurableObjectNamespace;
  MAX_ROOM_CAPACITY_TIMED: string;
  MAX_ROOM_CAPACITY_P2P: string;
  NUM_MATCHMAKING_SHARDS: string;
}

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for API routes (important for development on local ports)
app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Session-ID"],
  })
);

function generateRoomCode(): string {
  // Cryptographically random 6-digit numeric code: 100000 to 999999
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const codeNum = 100000 + (buf[0] % 900000);
  return codeNum.toString();
}

export function normalizeRoomCode(code: string): string {
  const clean = (code || "").trim();
  // If it's a 6-digit number (or has formatting like 123-456), extract the 6 digits
  const digits = clean.replace(/\D/g, "");
  if (digits.length === 6) {
    return digits;
  }
  // Backwards compatibility for legacy WORD-1234 formats
  const cleanLegacy = clean.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleanLegacy.length > 4) {
    const word = cleanLegacy.slice(0, -4);
    const num = cleanLegacy.slice(-4);
    if (/^\d{4}$/.test(num)) {
      return `${word}-${num}`;
    }
  }
  return clean.toUpperCase();
}

// REST: Create Room
app.post("/api/room/create", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const type: RoomType = body.type || "timed";
  const visibility: RoomVisibility = body.visibility || "private";
  let expiresInMinutes = parseInt(body.expiresInMinutes || "30");

  if (!["timed", "p2p", "meet"].includes(type)) {
    return c.json({ success: false, error: "Invalid room type" }, 400);
  }
  if (!["private", "open"].includes(visibility)) {
    return c.json({ success: false, error: "Invalid visibility" }, 400);
  }
  if (type === "p2p" || type === "meet") {
    // P2P and Local Meet default to 2 hours authoritative DO alarm
    expiresInMinutes = 120;
  } else if (expiresInMinutes > 120 || expiresInMinutes <= 0) {
    return c.json({ success: false, error: "Expiration must be between 15 minutes and 2 hours" }, 400);
  }

  // Generate public Room Code or accept existing offline room code
  const publicCode = (body.publicCode && /^[A-Za-z0-9\-]{4,12}$/.test(body.publicCode))
    ? body.publicCode.toUpperCase()
    : generateRoomCode();
  const internalRoomId = crypto.randomUUID();
  const hostKey = body.hostKey || crypto.randomUUID();
  
  // Ephemeral Salt for key derivation on clients
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const expiresAt = new Date(Date.now() + expiresInMinutes * 60000).toISOString();

  // Route to the specific DO instance named publicCode
  const id = c.env.ROOM_DO.idFromName(publicCode);
  const stub = c.env.ROOM_DO.get(id);

  try {
    const initRes = await stub.fetch(
      new Request("http://room/internal-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          internalRoomId,
          publicCode,
          type,
          visibility,
          expiresAt,
          salt,
          hostKey,
        }),
      })
    );

    const initData: any = await initRes.json();
    if (!initData.success) {
      return c.json({ success: false, error: "Failed to initialize room DO" }, 500);
    }

    // Register in matchmaking shard if open
    if (type === "timed" && visibility === "open") {
      const numShards = parseInt(c.env.NUM_MATCHMAKING_SHARDS || "3");
      const shardNum = Math.floor(Math.random() * numShards);
      const shardId = c.env.MATCHMAKING_DO.idFromName(`shard-${shardNum}`);
      const shardStub = c.env.MATCHMAKING_DO.get(shardId);

      await shardStub.fetch(
        new Request("http://matchmaking/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomCode: publicCode,
            internalRoomId,
            salt,
            expiresAt,
          }),
        })
      );
    }

    return c.json({
      success: true,
      roomCode: publicCode,
      internalRoomId,
      salt,
      expiresAt,
      hostKey,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || "Failed to create room" }, 500);
  }
});

// REST: Check Room Join Eligibility
app.post("/api/room/join", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  let roomCode = body.roomCode;
  if (!roomCode) {
    return c.json({ success: false, error: "Room code is required" }, 400);
  }
  roomCode = normalizeRoomCode(roomCode);

  const id = c.env.ROOM_DO.idFromName(roomCode);
  const stub = c.env.ROOM_DO.get(id);

  try {
    const checkRes = await stub.fetch(new Request("http://room/internal-check-join", { method: "POST" }));
    if (checkRes.status === 404) {
      if (body.hostKey) {
        // Auto-provision room for creator who created it offline
        const internalRoomId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
        const salt = Array.from(crypto.getRandomValues(new Uint8Array(8)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        await stub.fetch(
          new Request("http://room/internal-create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              internalRoomId,
              publicCode: roomCode,
              type: "meet",
              visibility: "private",
              expiresAt,
              salt,
              hostKey: body.hostKey,
            }),
          })
        );

        return c.json({
          success: true,
          roomCode: roomCode,
          internalRoomId,
          type: "meet",
          expiresAt,
          salt,
          participantCount: 0,
          hostId: null,
        });
      }
      return c.json({ success: false, error: "Room not found or has been destroyed" }, 404);
    }

    const checkData: any = await checkRes.json();
    const capacityLimit =
      checkData.type === "p2p"
        ? parseInt(c.env.MAX_ROOM_CAPACITY_P2P || "12")
        : checkData.type === "meet"
        ? parseInt((c.env as any).MAX_ROOM_CAPACITY_MEET || "60")
        : parseInt(c.env.MAX_ROOM_CAPACITY_TIMED || "50");

    if (checkData.participantCount >= capacityLimit) {
      return c.json({ success: false, error: `This room is full (${capacityLimit} max).` }, 403);
    }

    return c.json({
      success: true,
      roomCode: roomCode,
      internalRoomId: checkData.internalRoomId,
      type: checkData.type,
      expiresAt: checkData.expiresAt,
      salt: checkData.salt,
      participantCount: checkData.participantCount,
      hostId: checkData.hostId,
    });
  } catch (err: any) {
    return c.json({ success: false, error: "Unable to verify room eligibility." }, 500);
  }
});

// REST / Beacon: Immediate Participant Departure
app.post("/api/room/leave", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  let roomCode = body.roomCode;
  const sessionId = body.sessionId;
  if (!roomCode || !sessionId) {
    return c.json({ success: false }, 400);
  }
  roomCode = normalizeRoomCode(roomCode);
  const id = c.env.ROOM_DO.idFromName(roomCode);
  const stub = c.env.ROOM_DO.get(id);
  await stub.fetch(
    new Request("http://room/internal-leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
  ).catch(() => {});
  return c.json({ success: true });
});

// REST: Random Chat Matchmaking
app.get("/api/matchmake", async (c) => {
  const numShards = parseInt(c.env.NUM_MATCHMAKING_SHARDS || "3");
  const startShard = Math.floor(Math.random() * numShards);

  // Attempt to query matchmaking shards for an active open room
  for (let i = 0; i < numShards; i++) {
    const shardIndex = (startShard + i) % numShards;
    const shardId = c.env.MATCHMAKING_DO.idFromName(`shard-${shardIndex}`);
    const shardStub = c.env.MATCHMAKING_DO.get(shardId);

    try {
      const matchRes = await shardStub.fetch(new Request("http://matchmaking/pop", { method: "POST" }));
      if (matchRes.status === 200) {
        const matchData: any = await matchRes.json();
        
        // Atomically verify room DO is still active and has space
        const roomDoId = c.env.ROOM_DO.idFromName(matchData.roomCode);
        const roomStub = c.env.ROOM_DO.get(roomDoId);

        const checkRes = await roomStub.fetch(new Request("http://room/internal-check-join", { method: "POST" }));
        if (checkRes.status === 200) {
          const checkData: any = await checkRes.json();
          const capLimit = parseInt(c.env.MAX_ROOM_CAPACITY_TIMED || "50");
          
          if (checkData.participantCount < capLimit) {
            // Successfully matched! Return room code and salt
            return c.json({
              success: true,
              roomCode: matchData.roomCode,
              internalRoomId: matchData.internalRoomId,
              salt: matchData.salt,
              expiresAt: matchData.expiresAt
            });
          }
        }
        
        // If room check failed or was full, delete stale registration inside matchmaking DO
        await shardStub.fetch(
          new Request("http://matchmaking/remove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roomCode: matchData.roomCode }),
          })
        );
      }
    } catch (err) {
      // Shard fetch failed, proceed to next shard
    }
  }

  // If no rooms are available, return status waiting so client knows to try again
  return c.json(
    {
      success: false,
      status: "waiting",
      message: "No open chats are currently waiting. Create a room or wait for one to open.",
    },
    202
  );
});

// REST: Fetch temporary TURN/STUN ICE server configuration
app.get("/api/ice-servers", async (c) => {
  const apiKey = (c.env as any).METERED_API_KEY;
  const appName = (c.env as any).METERED_APP_NAME;

  // If the user configured custom Metered.ca credentials, fetch from their API
  if (apiKey && appName) {
    try {
      // 1. Try GET with apiKey (publishable key)
      let res = await fetch(`https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`);
      if (res.status === 200) {
        const data = await res.json();
        if (Array.isArray(data)) {
          console.log("[P2P] Successfully fetched credentials via GET (apiKey) from Metered.ca");
          return c.json({ success: true, iceServers: data });
        }
      }

      // 2. Try POST with secretKey (admin/developer secret key)
      res = await fetch(`https://${appName}.metered.live/api/v1/turn/credential?secretKey=${apiKey}`, {
        method: "POST"
      });
      if (res.status === 200) {
        const data = (await res.json()) as any;
        const username = data.username;
        const password = data.password || data.credential;
        if (username && password) {
          const iceServers = [
            { urls: "stun:global.relay.metered.ca:80" },
            {
              urls: "turn:global.relay.metered.ca:80",
              username: username,
              credential: password,
            },
            {
              urls: "turn:global.relay.metered.ca:443",
              username: username,
              credential: password,
            },
            {
              urls: "turn:global.relay.metered.ca:443?transport=tcp",
              username: username,
              credential: password,
            },
          ];
          console.log("[P2P] Successfully generated credentials via POST (secretKey) and constructed iceServers");
          return c.json({ success: true, iceServers });
        }
      }
    } catch (e) {
      console.warn("[P2P] Failed to fetch TURN from custom Metered API, attempting fallback:", e);
    }
  }

  // Return reliable STUN and TURN relay configuration
  try {
    const iceServers = [
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:80?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turns:openrelay.metered.ca:443?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turns:openrelay.metered.ca:5349?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
    ];

    return c.json({ success: true, iceServers });
  } catch (err: any) {
    return c.json(
      {
        success: false,
        error: "Failed to generate TURN credentials",
      },
      500
    );
  }
});

// WebSocket Entrypoint: Upgrades connection and forwards directly to the corresponding Room DO
app.get("/ws/room/:code", async (c) => {
  const code = c.req.param("code");
  const normalizedCode = normalizeRoomCode(code);
  const sessionId = c.req.query("sessionId");

  if (!sessionId) {
    return c.text("Missing session parameter.", 400);
  }

  // Resolve target DO instance
  const id = c.env.ROOM_DO.idFromName(normalizedCode);
  const stub = c.env.ROOM_DO.get(id);

  // Forward raw HTTP upgrade request to the DO fetch
  return stub.fetch(c.req.raw);
});

export default app;

// Export Durable Objects Classes for Cloudflare registration
export { RoomDO } from "./room-do";
export { MatchmakingDO } from "./matchmaking-do";
