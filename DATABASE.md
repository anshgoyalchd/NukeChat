# SQLite Database Schema

Each Room Durable Object runs a local SQLite database using Cloudflare Durable Objects Storage SQLite API. The database isolates data per room, enabling easy, transactional destruction of all tables when the room is nuked or expires.

---

## 1. Table Definitions

### `room` Table
Stores metadata for the individual chat room.
```sql
CREATE TABLE IF NOT EXISTS room (
  room_id TEXT PRIMARY KEY,       -- Cryptographically secure internal ID (UUID)
  public_code TEXT UNIQUE,        -- Short room code (e.g., MANGO-42)
  room_type TEXT NOT NULL,        -- 'timed' | 'p2p'
  visibility TEXT NOT NULL,       -- 'private' | 'open'
  created_at INTEGER NOT NULL,    -- Timestamp (ms)
  expires_at INTEGER NOT NULL,    -- Timestamp (ms)
  state TEXT NOT NULL             -- 'CREATING' | 'ACTIVE' | 'EXPIRING' | 'NUKING' | 'DESTROYED'
);
```

### `participants` Table
Manages active socket/peer identities inside the room.
```sql
CREATE TABLE IF NOT EXISTS participants (
  participant_id TEXT PRIMARY KEY,  -- Ephemeral client session ID
  identity_name TEXT NOT NULL,      -- Random name (e.g. Sleepy Panda 482)
  avatar_svg TEXT NOT NULL,         -- Deterministic pastel SVG representation
  joined_at INTEGER NOT NULL,       -- Timestamp (ms)
  last_seen_at INTEGER NOT NULL,    -- Timestamp (ms) for heartbeat tracking
  is_active INTEGER DEFAULT 1       -- Boolean status flag (1 = active, 0 = disconnected/grace period)
);
```

### `messages` Table (Timed Chat Only)
Stores the encrypted payloads. This table remains empty for P2P rooms.
```sql
CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  nonce TEXT NOT NULL,              -- AES-256-GCM Initialization Vector (hex)
  ciphertext TEXT NOT NULL,         -- Encrypted message contents (hex)
  FOREIGN KEY(sender_id) REFERENCES participants(participant_id) ON DELETE CASCADE
);
```

### `nuke_votes` Table
Tracks active nuke votes cast by current participants.
```sql
CREATE TABLE IF NOT EXISTS nuke_votes (
  participant_id TEXT PRIMARY KEY,
  voted_at INTEGER NOT NULL,
  FOREIGN KEY(participant_id) REFERENCES participants(participant_id) ON DELETE CASCADE
);
```

### `events` Table
Audit logs of state changes used for sync operations during client reconnections.
```sql
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  payload TEXT NOT NULL             -- Stringified JSON schema specific to the event
);
```

---

## 2. Hard Destruction Script

When a room is nuked or its expiration alarm fires, the Durable Object executes the following statements to ensure complete erasure of all records:

```sql
PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS room;
DROP TABLE IF EXISTS participants;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS nuke_votes;
DROP TABLE IF EXISTS events;
VACUUM;
```
This forces the SQLite engine to clear database file sectors on disk immediately, ensuring no lingering remnants remain in the Cloudflare KV storage layer.
