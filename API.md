# API Endpoint Specification

All HTTP endpoints are hosted by the Cloudflare Worker and routed using the Hono framework.

---

## 1. Room Creation

### `POST /api/room/create`
Creates a new chat room and spins up a dedicated Room Durable Object.

#### Request Body
```json
{
  "type": "timed" | "p2p",
  "visibility": "private" | "open",
  "expiresInMinutes": 15 | 30 | 60 | 120
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "roomCode": "MANGO-42",
  "internalRoomId": "8f8b88a9-51b8-4c91-a5ee-bc549f69742e",
  "salt": "a1b2c3d4e5f6g7h8",
  "expiresAt": "2026-08-18T23:29:09.000Z"
}
```

#### Response Errors
- `400 Bad Request`: Invalid type/duration parameter, or device session violates the One Room Rule.

---

## 2. Room Join Authorization

### `POST /api/room/join`
Validates eligibility, check limits, and returns room details before initiating WebSocket connection.

#### Request Body
```json
{
  "roomCode": "MANGO-42"
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "internalRoomId": "8f8b88a9-51b8-4c91-a5ee-bc549f69742e",
  "type": "timed" | "p2p",
  "expiresAt": "2026-08-18T23:29:09.000Z",
  "salt": "a1b2c3d4e5f6g7h8",
  "participantCount": 3
}
```

#### Response Errors
- `404 Not Found`: Room code does not exist, was nuked, or has expired.
- `400 Bad Request`: User already in another room (One Room Rule).
- `403 Forbidden`: Room has reached maximum capacity (12 for P2P, default 50 for Timed).

---

## 3. Random Chat Matchmaking

### `GET /api/matchmake`
Finds an available open timed room.

#### Request Headers
- `X-Session-ID`: The browser's session identifier (for One Room Rule check).

#### Response (200 OK)
```json
{
  "success": true,
  "roomCode": "PEACH-81",
  "internalRoomId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "salt": "z9y8x7w6v5u4t3s2"
}
```

#### Response (202 Accepted)
Returned when no matches are immediately available on the shard. The client should retry or wait.
```json
{
  "success": false,
  "status": "waiting",
  "message": "No rooms available. Please try again or create your own."
}
```
