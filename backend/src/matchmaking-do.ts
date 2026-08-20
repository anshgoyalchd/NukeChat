export class MatchmakingDO implements DurableObject {
  private state: DurableObjectState;
  private db: any;

  constructor(state: DurableObjectState, _env: any) {
    this.state = state;
    this.db = this.state.storage.sql;
    this.initializeDb();
  }

  private initializeDb() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matchmaking (
        room_code TEXT PRIMARY KEY,
        internal_room_id TEXT NOT NULL,
        salt TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
  }

  async fetch(request: Request): Promise<Response> {
    this.initializeDb();
    const url = new URL(request.url);
    const path = url.pathname;

    // Prune expired rooms
    const nowIso = new Date().toISOString();
    this.db.exec("DELETE FROM matchmaking WHERE expires_at < ?", nowIso);

    if (path === "/register") {
      const data: any = await request.json();
      this.db.exec(
        "INSERT OR REPLACE INTO matchmaking (room_code, internal_room_id, salt, expires_at) VALUES (?, ?, ?, ?)",
        data.roomCode,
        data.internalRoomId,
        data.salt,
        data.expiresAt
      );
      return Response.json({ success: true });
    }

    if (path === "/pop") {
      // Fetch the oldest registered room (queue style)
      const cursor = this.db.exec("SELECT room_code, internal_room_id, salt, expires_at FROM matchmaking ORDER BY expires_at ASC LIMIT 1");
      const rows = Array.from(cursor);

      if (rows.length === 0) {
        return new Response("No matchmaking slots available", { status: 404 });
      }

      const row: any = rows[0];
      return Response.json({
        roomCode: row.room_code,
        internalRoomId: row.internal_room_id,
        salt: row.salt,
        expiresAt: row.expires_at,
      });
    }

    if (path === "/remove") {
      const data: any = await request.json();
      this.db.exec("DELETE FROM matchmaking WHERE room_code = ?", data.roomCode);
      return Response.json({ success: true });
    }

    return new Response("Matchmaking endpoint not found", { status: 404 });
  }
}
