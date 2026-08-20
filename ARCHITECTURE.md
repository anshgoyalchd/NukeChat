# System Architecture

Nuke Chat is built on a serverless, real-time architecture optimized for Cloudflare's edge network. The core philosophy is **zero permanent server-side data retention** and **independent scaling** of active chat rooms.

---

## 1. Core Architecture Principles

### One Durable Object (DO) Per Chat Room
Every active chat room is managed by its own dedicated Durable Object instance. There is no central orchestrator or single room registry. 
- **Room A** -> `RoomDO_A`
- **Room B** -> `RoomDO_B`
- **Room C** -> `RoomDO_C`
- This ensures maximum performance isolation, horizontal scaling across Cloudflare's network, and transactional safety within each room's SQLite storage.

### Sharded Matchmaking
To support **Random Chat**, open rooms register themselves into one of multiple **Matchmaking Shards** (implemented as separate Durable Objects). When matchmaking is requested:
1. A client queries the worker.
2. The worker selects a matchmaking shard at random (or deterministically).
3. The shard queries its internal storage for an active, under-capacity open room.
4. If found, the client is directed to it; if not, the client is placed in a queue or tries another shard.

---

## 2. Request Flow Diagram

```text
                           [ USER CLIENT ]
                                  │
                       ⚡ Cloudflare Edge Network
                                  │
                     [ Cloudflare Worker HTTP Router ]
                                  │
             ┌────────────────────┴────────────────────┐
             ▼                                         ▼
   [ Room Code Resolution ]                 [ Matchmaking Shard DO ]
             │                                         │
             ├─────────► [ Room Durable Object ] ◄─────┘
             │                     │
             │           ┌─────────┴─────────┐
             ▼           ▼                   ▼
          [WS / E2EE Text]          [WebRTC Signaling]
             │                               │
       SQLite Database                       ▼
   (Messages, Votes, State)          [Direct Peer Connection]
                                    (Mesh: Max 12 Peers)
```

---

## 3. Storage Layer (SQLite in DO)
Each Room Durable Object utilizes the built-in SQLite engine. SQLite databases are local to the Durable Object and persist only as long as the DO is active.
- **Auto-Destruction**: When the room's expiration time is reached, or when the active participant count reaches zero, the DO executes an alarm that drops all tables and terminates the instance.
- **E2EE Ciphertext Storage**: For Timed Chats, the SQLite database only stores the encrypted message ciphertext, initialization vector (nonce), and sender metadata. Plaintext never touches the server.
- **Zero Storage for P2P**: P2P rooms store room coordination and nuke voting state in SQLite, but no chat history or files are written to the database.

---

## 4. Real-time Communication
- **WebSockets with Hibernation**: Active clients communicate with the Room DO via WebSockets. To stay within Cloudflare free limits, the Room DO utilizes the WebSocket Hibernation API. This allows Cloudflare to serialize the DO state and sleep when no messages are actively being sent, while keeping the socket open.
- **WebRTC DataChannels**: In P2P Chat, WebSockets are used solely for exchanging SDP offers/answers and ICE candidates. Once the connection is established, the socket goes quiet and all data (text, files) passes directly browser-to-browser.
