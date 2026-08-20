# Real-time WebSocket Protocol

All persistent signaling and message transfers go over a secure WebSocket connection established directly with the Room Durable Object.

---

## 1. Connection Upgrade

Clients establish a connection using:
`wss://nuke-chat-backend.your-subdomain.workers.dev/ws/room/:roomCode?sessionId=:sessionId`

### Handshake Authentication
During the WebSocket upgrade request, the Worker checks:
1. **Room State**: Validates that the room code resolves to an active, non-expired, non-nuked room.
2. **One Room Rule**: Rejects the connection if the `sessionId` is already associated with another active room.
3. **Capacity**: Rejects if room participant capacity is exceeded.

---

## 2. Event Envelope Schema

Every message sent or received over the WebSocket is serialized in JSON and conforms to the following schema:

```typescript
interface WebSocketMessage<T = any> {
  type: string;       // Type of event (e.g. "ROOM_JOINED", "MESSAGE_SENT")
  senderId: string;   // Unique anonymous session ID of the sender
  timestamp: number;  // Epoch millisecond timestamp
  payload: T;         // Data specific to the event type
}
```

---

## 3. Key WebSocket Events

### `ROOM_JOINED` (Server -> Client)
Sent to all room participants (and the joining user) when a new member connects.
```json
{
  "type": "ROOM_JOINED",
  "senderId": "user-8c88",
  "timestamp": 1723984180000,
  "payload": {
    "identity": "Sleepy Panda 482",
    "avatar": "data:image/svg+xml;utf8,...",
    "joinedAt": 1723984180000,
    "participants": [
      { "id": "user-1111", "identity": "Curious Crow 731" },
      { "id": "user-2222", "identity": "Blue Otter 204" }
    ]
  }
}
```

### `MESSAGE_SENT` (Client -> Server) / `MESSAGE_BROADCAST` (Server -> Client)
Used in Timed Chat for broadcasting encrypted text messages.
```json
{
  "type": "MESSAGE_SENT",
  "senderId": "user-8c88",
  "timestamp": 1723984190000,
  "payload": {
    "messageId": "msg-9999",
    "nonce": "a1b2c3d4e5f6g7h8",
    "ciphertext": "z9y8x7w6v5u4t3s2..."
  }
}
```

### `NUKE_VOTE_CAST` (Client -> Server -> Client)
Broadcasts that a participant voted to nuke the room.
```json
{
  "type": "NUKE_VOTE_CAST",
  "senderId": "user-8c88",
  "timestamp": 1723984210000,
  "payload": {
    "votesCount": 2,
    "neededVotes": 3
  }
}
```

### `ROOM_NUKED` (Server -> Client)
Sent when the voting threshold is crossed, prompting clients to play the nuke animation.
```json
{
  "type": "ROOM_NUKED",
  "senderId": "server",
  "timestamp": 1723984212000,
  "payload": {}
}
```

---

## 4. Heartbeats & WebSocket Hibernation

To prevent idling resources on the free tier, the backend uses **WebSocket Hibernation API**.
* The server registers the WebSockets to hibernate.
* If a socket receives no frames, it is kept open by Cloudflare without keeping the Durable Object memory active.
* Clients send a simple `PING` frame every 45 seconds to keep the socket alive. The DO wakes up automatically upon receiving client frames or when broadcasting messages.
