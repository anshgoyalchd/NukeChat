import { WsEnvelope, WsEventType } from "../../shared/types";

export class RoomDO implements DurableObject {
  private state: DurableObjectState;
  private env: any;
  private db: any;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
    this.db = this.state.storage.sql;
    this.initializeDb();
  }

  private initializeDb() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS room (
          room_id TEXT PRIMARY KEY,
          public_code TEXT UNIQUE,
          room_type TEXT NOT NULL,
          visibility TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at TEXT NOT NULL,
          state TEXT NOT NULL,
          salt TEXT NOT NULL
        );
      `);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS participants (
          participant_id TEXT PRIMARY KEY,
          identity_name TEXT NOT NULL,
          avatar_svg TEXT NOT NULL,
          joined_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          is_active INTEGER DEFAULT 1
        );
      `);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          message_id TEXT PRIMARY KEY,
          sender_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          nonce TEXT NOT NULL,
          ciphertext TEXT NOT NULL
        );
      `);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS nuke_votes (
          participant_id TEXT PRIMARY KEY,
          voted_at INTEGER NOT NULL
        );
      `);
    } catch (e) {
      console.error("SQL Init Error:", e);
    }
  }

  async fetch(request: Request): Promise<Response> {
    this.initializeDb();
    const url = new URL(request.url);
    const path = url.pathname;

    // REST: Initialize Room
    if (path === "/internal-create") {
      const data: any = await request.json();
      
      this.db.exec(
        `INSERT OR REPLACE INTO room (room_id, public_code, room_type, visibility, created_at, expires_at, state, salt)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
        data.internalRoomId,
        data.publicCode,
        data.type,
        data.visibility,
        Date.now(),
        data.expiresAt,
        data.salt
      );

      // Set authoritative alarm for natural room expiration
      const alarmTime = new Date(data.expiresAt).getTime();
      await this.state.storage.setAlarm(alarmTime);

      return Response.json({ success: true });
    }

    // REST: Verify room eligibility before WebSocket connect
    if (path === "/internal-check-join") {
      const cursor = this.db.exec("SELECT room_id, room_type, expires_at, state, salt FROM room LIMIT 1");
      const rows = Array.from(cursor);

      if (rows.length === 0) {
        return new Response("Room not found", { status: 404 });
      }

      const roomRow: any = rows[0];
      if (roomRow.state !== "ACTIVE") {
        return new Response("Room is inactive", { status: 404 });
      }

      // Check current participant count
      const partCursor = this.db.exec("SELECT COUNT(*) as count FROM participants WHERE is_active = 1");
      const count = (Array.from(partCursor)[0] as any).count;

      return Response.json({
        success: true,
        internalRoomId: roomRow.room_id,
        type: roomRow.room_type,
        expiresAt: roomRow.expires_at,
        participantCount: count,
        salt: roomRow.salt
      });
    }

    // WebSocket upgrade path
    if (request.headers.get("Upgrade") === "websocket") {
      const sessionId = url.searchParams.get("sessionId");
      const identity = url.searchParams.get("identity") || "Anonymous";
      const avatar = url.searchParams.get("avatar") || "";

      if (!sessionId) {
        return new Response("Session ID required", { status: 400 });
      }

      // Read room details
      const roomCursor = this.db.exec("SELECT room_type, state FROM room LIMIT 1");
      const roomRows = Array.from(roomCursor) as any[];
      if (roomRows.length === 0 || roomRows[0].state !== "ACTIVE") {
        return new Response("Room not found or inactive", { status: 404 });
      }

      // Check duplicate identity inside the room
      const dupCursor = this.db.exec("SELECT COUNT(*) as count FROM participants WHERE identity_name = ? AND is_active = 1 AND participant_id != ?", identity, sessionId);
      const isDuplicate = (Array.from(dupCursor)[0] as any).count > 0;
      let finalIdentity = identity;
      if (isDuplicate) {
        // Append random 3-digit suffix if duplicate occurs
        finalIdentity = `${identity.split(" ").slice(0, 2).join(" ")} ${Math.floor(100 + Math.random() * 900)}`;
      }

      // Record participant in SQLite
      this.db.exec(
        `INSERT OR REPLACE INTO participants (participant_id, identity_name, avatar_svg, joined_at, last_seen_at, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`,
        sessionId,
        finalIdentity,
        avatar,
        Date.now(),
        Date.now()
      );

      // Perform WebSocket Upgrade
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      
      // Store session properties by tagging the WebSocket
      this.state.acceptWebSocket(server, [sessionId]);

      const activeList = this.getActiveParticipants();

      // Send directly to the joining client so they don't miss the event during transition.
      // We wrap it in a setTimeout and try/catch block to let the HTTP upgrade response complete
      // and prevent throwing "WebSocket not open" handshake exceptions.
      setTimeout(() => {
        try {
          server.send(
            JSON.stringify({
              type: WsEventType.ROOM_JOINED,
              senderId: sessionId,
              timestamp: Date.now(),
              payload: {
                identity: finalIdentity,
                avatar: avatar,
                joinedAt: Date.now(),
                participants: activeList,
              },
            })
          );
        } catch (e) {
          // Socket closed
        }
      }, 200);

      // Broadcast to all other participants
      this.broadcast({
        type: WsEventType.ROOM_JOINED,
        senderId: sessionId,
        timestamp: Date.now(),
        payload: {
          identity: finalIdentity,
          avatar: avatar,
          joinedAt: Date.now(),
          participants: activeList,
        },
      }, sessionId);

      // Send chat history for Timed Chat
      if (roomRows[0].room_type === "timed") {
        const histCursor = this.db.exec("SELECT message_id, sender_id, timestamp, nonce, ciphertext FROM messages ORDER BY timestamp ASC LIMIT 50");
        const history = Array.from(histCursor).map((row: any) => ({
          messageId: row.message_id,
          senderId: row.sender_id,
          timestamp: row.timestamp,
          nonce: row.nonce,
          ciphertext: row.ciphertext,
        }));

        server.send(
          JSON.stringify({
            type: "HISTORY",
            senderId: "server",
            timestamp: Date.now(),
            payload: history,
          })
        );
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  // WebSocket Message Recipient (Hibernation Hook)
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const tags = this.state.getTags(ws);
      const sessionId = tags[0];

      if (typeof message !== "string") return;

      const envelope: WsEnvelope = JSON.parse(message);

      // Update heartbeat
      this.db.exec("UPDATE participants SET last_seen_at = ?, is_active = 1 WHERE participant_id = ?", Date.now(), sessionId);

      switch (envelope.type) {
        case WsEventType.MESSAGE_SENT: {
          // Verify room type is timed
          const roomCursor = this.db.exec("SELECT room_type FROM room LIMIT 1");
          const roomRows = Array.from(roomCursor) as any[];
          if (roomRows.length === 0 || roomRows[0].room_type !== "timed") return;

          const payload = envelope.payload;
          
          // Write message to SQLite database
          this.db.exec(
            "INSERT INTO messages (message_id, sender_id, timestamp, nonce, ciphertext) VALUES (?, ?, ?, ?, ?)",
            payload.messageId,
            sessionId,
            Date.now(),
            payload.nonce,
            payload.ciphertext
          );

          // Broadcast message
          this.broadcast({
            type: WsEventType.MESSAGE_BROADCAST,
            senderId: sessionId,
            timestamp: Date.now(),
            payload: {
              messageId: payload.messageId,
              nonce: payload.nonce,
              ciphertext: payload.ciphertext,
            },
          });
          break;
        }

        case WsEventType.SIGNAL: {
          // Forward signaling packet for WebRTC directly to target participant
          const payload = envelope.payload;
          this.forwardToParticipant(payload.targetId, {
            type: WsEventType.SIGNAL,
            senderId: sessionId,
            timestamp: Date.now(),
            payload: {
              signal: payload.signal,
            },
          });
          break;
        }

        case WsEventType.NUKE_VOTE_CAST: {
          // Register vote in database
          this.db.exec("INSERT OR REPLACE INTO nuke_votes (participant_id, voted_at) VALUES (?, ?)", sessionId, Date.now());

          // Count active votes
          const activeVotes = this.countActiveNukeVotes();
          const activeCount = this.getActiveCount();

          this.broadcast({
            type: WsEventType.NUKE_VOTE_CAST,
            senderId: sessionId,
            timestamp: Date.now(),
            payload: {
              votesCount: activeVotes,
              neededVotes: Math.floor(activeCount / 2) + 1,
            },
          });

          // Check if threshold crossed
          if (activeVotes > activeCount / 2) {
            this.destroyRoom("nuked");
          }
          break;
        }

        case WsEventType.HEARTBEAT:
          ws.send(JSON.stringify({ type: "PONG", senderId: "server", timestamp: Date.now(), payload: {} }));
          break;
      }
    } catch (e) {
      // Ignored
    }
  }

  // WebSocket Closed (Hibernation Hook)
  webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean) {
    const tags = this.state.getTags(ws);
    const sessionId = tags[0];
    this.handleParticipantDisconnect(sessionId);
  }

  // WebSocket Errored (Hibernation Hook)
  webSocketError(ws: WebSocket, _error: any) {
    const tags = this.state.getTags(ws);
    const sessionId = tags[0];
    this.handleParticipantDisconnect(sessionId);
  }

  // Natural DO Expiration Handler
  async alarm() {
    this.destroyRoom("expired");
  }

  // Grace Period and Clean Departure Management
  private handleParticipantDisconnect(sessionId: string) {
    // Set is_active = 0 in database
    this.db.exec("UPDATE participants SET is_active = 0 WHERE participant_id = ?", sessionId);

    // Start 5-second grace period in memory
    setTimeout(() => {
      try {
        const checkCursor = this.db.exec("SELECT is_active FROM participants WHERE participant_id = ?", sessionId);
        const rows = Array.from(checkCursor) as any[];

        if (rows.length > 0 && rows[0].is_active === 0) {
          // Permanently erase session records
          this.db.exec("DELETE FROM participants WHERE participant_id = ?", sessionId);
          this.db.exec("DELETE FROM nuke_votes WHERE participant_id = ?", sessionId);

          // Broadcast peer departure
          this.broadcast({
            type: WsEventType.PEER_LEFT,
            senderId: sessionId,
            timestamp: Date.now(),
            payload: {
              participantId: sessionId,
              participants: this.getActiveParticipants(),
            },
          });

          // Auto-destruction check
          this.checkAutoDestruction();
        }
      } catch (err) {
        // Ignored
      }
    }, 5000);
  }

  private checkAutoDestruction() {
    const activeCount = this.getActiveCount();
    if (activeCount === 0) {
      this.destroyRoom("expired");
    }
  }

  // Destroy room data and purge SQLite
  private destroyRoom(reason: "nuked" | "expired") {
    try {
      this.db.exec("UPDATE room SET state = 'DESTROYED'");

      // Notify clients
      const destroyType = reason === "nuked" ? WsEventType.ROOM_NUKED : WsEventType.ROOM_EXPIRED;
      this.broadcast({
        type: destroyType,
        senderId: "server",
        timestamp: Date.now(),
        payload: {},
      });

      // Clear DO alarm
      this.state.storage.deleteAlarm();

      // Wipe SQLite database tables completely
      this.db.exec("PRAGMA foreign_keys = OFF;");
      this.db.exec("DROP TABLE IF EXISTS room;");
      this.db.exec("DROP TABLE IF EXISTS participants;");
      this.db.exec("DROP TABLE IF EXISTS messages;");
      this.db.exec("DROP TABLE IF EXISTS nuke_votes;");
      this.db.exec("VACUUM;");

      // Close all sockets
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.close(1000, reason === "nuked" ? "ROOM_NUKED" : "ROOM_EXPIRED");
        } catch (e) {
          // Ignored
        }
      }
    } catch (e) {
      console.error("Purge Room DB Error:", e);
    }
  }

  private getActiveParticipants(): any[] {
    const cursor = this.db.exec("SELECT participant_id, identity_name, avatar_svg FROM participants WHERE is_active = 1");
    return Array.from(cursor).map((row: any) => ({
      id: row.participant_id,
      identity: row.identity_name,
      avatar: row.avatar_svg,
    }));
  }

  private getActiveCount(): number {
    const cursor = this.db.exec("SELECT COUNT(*) as count FROM participants WHERE is_active = 1");
    const rows = Array.from(cursor);
    return rows.length > 0 ? (rows[0] as any).count : 0;
  }

  private countActiveNukeVotes(): number {
    const cursor = this.db.exec(`
      SELECT COUNT(*) as count FROM nuke_votes
      INNER JOIN participants ON nuke_votes.participant_id = participants.participant_id
      WHERE participants.is_active = 1
    `);
    const rows = Array.from(cursor);
    return rows.length > 0 ? (rows[0] as any).count : 0;
  }

  private broadcast(msg: any, excludeSessionId?: string) {
    const payload = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      const tags = this.state.getTags(ws);
      if (excludeSessionId && tags[0] === excludeSessionId) {
        continue;
      }
      try {
        ws.send(payload);
      } catch (e) {
        // Socket closed
      }
    }
  }

  private forwardToParticipant(targetId: string, msg: any) {
    const payload = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      const tags = this.state.getTags(ws);
      if (tags[0] === targetId) {
        try {
          ws.send(payload);
        } catch (e) {
          // Sockets dead
        }
        return;
      }
    }
  }
}
