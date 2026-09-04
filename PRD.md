# Product Requirements Document (PRD)

# NukeChat — Ephemeral, Accountless & Zero-Retention Real-Time Communication

**Document Version:** 2.0.0  
**Status:** Approved / In Production  
**Last Updated:** September 2026  
**Target Platform:** Web (Desktop, Mobile, Tablet, PWA)  
**Production URL:** [https://nuke-chat.pages.dev](https://nuke-chat.pages.dev)  
**Backend Edge API:** [https://nuke-chat-backend.ansh-goyalchd.workers.dev](https://nuke-chat-backend.ansh-goyalchd.workers.dev)

---

## 1. Executive Summary

### 1.1 Problem Statement
Modern communication tools (Slack, Discord, WhatsApp, Telegram, Google Meet) require persistent accounts, phone numbers, email verification, and perpetual cloud logging. Once a conversation begins on these platforms, metadata, message logs, and shared attachments reside on centralized servers indefinitely, susceptible to data leaks, surveillance, and subpoena requests. Furthermore, ad-hoc local collaboration (e.g., classrooms, meetups, field teams) often consumes unnecessary internet bandwidth even when all participants reside on the exact same local Wi-Fi router.

### 1.2 Product Vision
**NukeChat** (*"Talk. Share. Nuke It."*) is a disposable, zero-retention, accountless real-time communication platform engineered to run 100% serverless on edge infrastructure. NukeChat requires:
* **Zero accounts**, phone numbers, or email sign-ups.
* **Zero persistent databases** or permanent server message logs.
* **Zero trace**: Rooms self-destruct upon expiration, participant departure, or majority consensus (**"Nuke Vote"**).
* **Local-first efficiency**: Real-time voice, video, and screen sharing operate over direct local Wi-Fi LAN (**Star Topology**) with 0 KB internet data consumption when available.

---

## 2. Product Principles & Non-Goals

### 2.1 Core Principles
1. **Radical Ephemerality**: If data does not strictly need to exist to deliver the next packet, it must not exist.
2. **Client-Side Cryptography**: In server-routed modes, encryption keys are derived strictly inside the user's browser via PBKDF2/AES-256-GCM; plaintexts never hit the wire in the clear.
3. **Local-First & Mesh Priority**: Prefer direct peer-to-peer (WebRTC) and local Wi-Fi transmission over cloud relay wherever network conditions allow.
4. **Frictionless Onboarding**: Entering a room requires nothing more than clicking a link or typing a 6-digit room code.
5. **Edge Efficiency**: Architecture must remain 100% functional within Cloudflare's serverless free tier using Durable Objects and WebSocket Hibernation.

### 2.2 Non-Goals
* **No Permanent User Accounts**: No usernames, passwords, OAuth, or user profiles.
* **No Searchable Archive**: No server-side search or historical message retrieval after room teardown.
* **No Ad-tech or Tracking**: Zero analytics pixels, telemetry trackers, or fingerprinting scripts.

---

## 3. User Personas & Core Journeys

| Persona | Description | Primary Need |
| :--- | :--- | :--- |
| **The Privacy Purist** | Security researchers, journalists, activists | Share sensitive text or documents with guaranteed cryptographic destruction and no digital footprint. |
| **The Educator / Presenter** | Teachers, conference hosts, workshop leads | Broadcast video and screen sharing to up to 50 local attendees without crashing the venue's limited internet uplink. |
| **The Disposable Collaborator** | Coworkers, gamers, freelancers | Spin up a rapid 30-minute chat or file share with colleagues without cluttering personal Slack/Discord workspaces. |
| **The Incognito Stranger** | People looking for spontaneous conversation | Instant matchmaking into random anonymous rooms with rapid skip/nuke capabilities. |

---

## 4. Feature Specifications & Room Types

NukeChat provides **three distinct room modalities**, each tailored to a specific operational model:

```
                          ┌───────────────────────────┐
                          │   NukeChat Room Engine    │
                          └─────────────┬─────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        ▼                               ▼                               ▼
┌────────────────┐             ┌────────────────┐             ┌──────────────────┐
│   Timed Chat   │             │    P2P Chat    │             │    Local Meet    │
├────────────────┤             ├────────────────┤             ├──────────────────┤
│ • Server-routed│             │ • Direct Mesh  │             │ • Star Topology  │
│ • E2EE AES-GCM │             │ • Zero server  │             │ • Host Broadcast │
│ • 15m - 2h TTL │             │ • File sharing │             │ • Screen/Camera  │
│ • Nuke Voting  │             │ • Hybrid relay │             │ • Q&A & Hands    │
└────────────────┘             └────────────────┘             └──────────────────┘
```

---

### 4.1 Mode 1: Timed Chat (E2EE Disposable Rooms)
* **Target Audience**: Confidential discussions, sensitive code exchanges, temporary group meetings.
* **Architecture**: Server-authoritative via dedicated Cloudflare Durable Object instance.
* **Capacity**: Up to 50 concurrent participants per room.
* **Lifetime / Expiration**: 15 minutes, 30 minutes, 1 hour, or 2 hours (user configurable at room creation).

#### Functional Requirements:
1. **Client-Side E2EE (`AES-256-GCM`)**:
   - Master key derived via Web Crypto PBKDF2 (100,000 iterations of SHA-256) combining the Room Code and a cryptographic Salt generated at room creation.
   - Every outgoing text message is encrypted with a unique 12-byte initialization vector (nonce).
   - Only `ciphertext`, `nonce`, `senderId`, `senderName`, and `timestamp` are stored in the ephemeral SQLite database inside the Durable Object.
2. **Auto-Destruction Triggers**:
   - **Expiration Alarm**: The Durable Object triggers a scheduled alarm when TTL expires, drops all SQLite tables, severs all WebSockets, and exits memory.
   - **Last User Departure**: When the active participant count drops to 0, the DO schedules an immediate self-destruct alarm (30-second grace period).
3. **Nuke Protocol**:
   - Any participant can click the **"Nuke Room"** button to cast a vote.
   - If `votesCount > activeParticipants / 2`, the DO initiates the irreversible Nuke Sequence:
     - Dispatches a `ROOM_NUKED` broadcast to all connected clients.
     - Immediately drops all SQLite tables and clears DO storage.
     - All clients display a full-screen nuclear explosion animation with sound effects and redirect to the landing page.

---

### 4.2 Mode 2: P2P Chat (Mesh File & Media Sharing)
* **Target Audience**: Direct peer-to-peer file sharing, large video transfers, private group transfers without file-size limits.
* **Architecture**: Full WebRTC DataChannel Mesh (peer-to-peer) with Cloudflare WebSocket signaling.
* **Capacity**: Up to 12 participants per mesh.
* **Storage Footprint**: **0 bytes on the server**. Files and messages pass browser-to-browser.

#### Functional Requirements:
1. **Deterministic Initiator & Zero Glare**:
   - Lexicographical peer sorting (`sessionId > remoteId`) guarantees that exactly one peer initiates the offer, eliminating WebRTC SDP offer/answer collisions.
2. **Multi-Protocol ICE Infrastructure**:
   - Fast STUN: `stun:stun.cloudflare.com:3478`, `stun:stun.l.google.com:19302`.
   - TCP TURN: `turn:openrelay.metered.ca:80?transport=tcp`, `turn:openrelay.metered.ca:443?transport=tcp`.
   - TLS TURNS (Port 443): `turns:openrelay.metered.ca:443?transport=tcp` (indistinguishable from regular HTTPS traffic, bypassing restrictive cellular CGNAT and enterprise firewalls).
3. **Non-Destructive Native `iceRestart`**:
   - When a peer connection encounters transient disconnection or cellular Wi-Fi handover, the app executes `pc.createOffer({ iceRestart: true })`, preserving the active `RTCDataChannel` without tearing down in-flight transfers.
4. **High-Availability Hybrid Relay Fallback (100% Delivery Guarantee)**:
   - If WebRTC is negotiating, recovering, or completely blocked by symmetric NAT, messages automatically relay over the secure signaling channel (`p2p-relay-text`, `p2p-relay-file-offer`).
   - Deduplication caching guarantees zero duplicate messages.
5. **Binary Chunked File Transfer**:
   - Files are sliced into 32 KB binary chunks with a 5-byte framing header (`idLen`, `fileId`, `chunkIndex`, `payload`).
   - Transfer progress is tracked in real-time with bidirectional progress bars.
   - Received files are buffered in client-side IndexedDB and converted into direct download blobs.

---

### 4.3 Mode 3: Local Meet / Classroom Webinar
* **Target Audience**: Classrooms, corporate training, webinars, local presentations, offline conferences.
* **Architecture**: Star Topology WebRTC Stream with Cloudflare Durable Object coordination.
* **Capacity**: 1 Host Presenter + up to 50 Attendees (51 total participants).

#### Functional Requirements:
1. **Host Broadcasting**:
   - Host can stream **Camera (720p/1080p)**, **Microphone**, and **Screen Share (1080p 30fps)**.
   - Broadcaster quality selector: *Clarity (1080p / high bitrate)* vs *Performance (720p / low bitrate)*.
   - Dynamic role management via URL Host Key (`#/join/ROOM?hostKey=XYZ`) ensuring the creator retains Broadcaster controls even after page refresh.
2. **Star Topology Direct LAN Detection**:
   - Broadcaster and attendees automatically inspect active ICE candidate pairs.
   - If candidate IPs match RFC-1918 private subnets (`192.168.x.x`, `10.x.x.x`), the connection is tagged **`⭐ STAR LAN (Offline)`**.
   - Top bar and attendee cards display **`⚡ LAN`** in amber, confirming **0 KB internet data used**.
   - If attendees join across WAN/4G, they seamlessly fallback to **`🌐 Cloud Relay`**.
3. **Classroom Q&A Drawer**:
   - Attendees submit questions via structured `MESSAGE_SENT` envelopes.
   - Real-time Q&A drawer with unread message badge counters.
   - Question cards display student avatar, sender name, timestamp, and message body.
4. **Live Hand-Raising System**:
   - Attendees can click **"Raise Hand"** ✋ to alert the teacher.
   - Real-time hand counter badge displayed prominently in the top bar.
   - Hand-raising students are highlighted in amber within the Joinees list.
   - Automatic hand lowering after 25 seconds of inactivity.
5. **Lobby State & Topology Clarity**:
   - When the Host has not yet started broadcasting, attendee cards display **`🟢 Ready in Lobby`** and the summary card indicates **`Classroom Audience: X attendees waiting`**.
   - Upon clicking **"Start Broadcast"**, the summary card dynamically transitions to live streaming metrics:
     - `⭐ Star Topology (Direct LAN): X Watching (Offline)`
     - `🌐 Cloud Relay (Internet): Y Watching (Online)`

---

## 5. Accountless Identity & Security Architecture

### 5.1 Identity Generation
* **Anonymous Pseudonyms**: Upon launching the app, the client randomly combines a whimsical adjective, an animal, and a 3-digit entropy suffix (e.g. `Velvet Falcon 739`, `Electric Otter 104`).
* **Deterministic Pastel SVG Avatars**: Generated client-side using an SVG avatar template with initials and a hash-derived background color palette.
* **Zero Persistence**: Identity is stored only in `sessionStorage` and destroyed when the browser tab closes.

### 5.2 The "One Room Rule"
* To prevent resource abuse and zombie connections, a single browser session may only belong to **one active room at a time**.
* Joining a new room automatically tears down prior WebSocket sockets and clears local WebRTC peer states.

### 5.3 Cryptographic Primitives
| Operation | Algorithm | Parameters |
| :--- | :--- | :--- |
| **Room Key Derivation** | PBKDF2 | SHA-256, 100,000 iterations, 32-byte key length |
| **Message Encryption** | AES-GCM | 256-bit key, 12-byte IV (nonce), 128-bit authentication tag |
| **WebRTC Transport** | DTLS-SRTP | ECDSA (P-256) certificate negotiation |
| **File Integrity** | SHA-256 | Validated chunk stream checksum |

---

## 6. Technical Stack & Infrastructure

```text
┌────────────────────────────────────────────────────────┐
│                   FRONTEND (CLIENT)                    │
│  React 18 • TypeScript • Vite • Tailwind CSS • Lucide  │
│  Web Crypto API • WebRTC API • IndexedDB (Dexie)       │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS / WSS
┌───────────────────────────┴────────────────────────────┐
│              CLOUDFLARE EDGE WORKER (HONO)             │
│  • Edge HTTP Router                                    │
│  • WebRTC Signaling Relay                              │
│  • Multi-protocol ICE Server Credentials Provider      │
└───────────────────────────┬────────────────────────────┘
                            │ Internal RPC
┌───────────────────────────┴────────────────────────────┐
│            CLOUDFLARE DURABLE OBJECTS (DO)             │
│  • RoomDO (One per active room)                        │
│    - SQLite in-memory table storage                    │
│    - WebSocket Hibernation API                         │
│    - Expiration & Nuke Alarms                          │
│  • MatchmakingDO (Sharded Random Chat Matcher)         │
└────────────────────────────────────────────────────────┘
```

---

## 7. User Interface & Design System

### 7.1 Visual Style
* **Theme**: Deep obsidian dark mode (`bg-black`, `bg-neutral-950`, `bg-neutral-900`).
* **Accents**:
  * Amber (`#F59E0B`): Star LAN topology, hand-raising, and local offline features.
  * Indigo / Violet (`#6366F1`): Cloud Relay, video controls, and action triggers.
  * Emerald (`#10B981`): Healthy connections, connected students, active indicators.
  * Rose / Red (`#F43F5E`): Nuke button, destructive actions, leave room.
* **Typography**: Clean, geometric sans-serif (`Inter`, `system-ui`) with monospace digits for codes and timers.

### 7.2 Interface Layout
1. **Top Header**:
   - Room Code Pill with one-click copy.
   - Live Expiration Countdown Timer (`00:29:45`).
   - Network Mode Badge (`⚡ LAN` or `🌐 Relay`).
   - Participant Count Pill (`👥 51`) with hand-raise alert badge.
   - Nuke Action Button (Skull icon 💀).
2. **Main Viewport**:
   - Timed Chat: Scrollable encrypted message stream with typing indicator.
   - P2P Chat: Split-pane chat stream with drag-and-drop file dropzone.
   - Local Meet: Dominant 16:9 presentation video stage with floating control pill.
3. **Slide-over Drawers**:
   - **Joinees Drawer**: Attendee roster, individual network tags, hand-raise indicators, and network breakdown summary card.
   - **Q&A Drawer**: Real-time moderated question list for classroom webinars.

---

## 8. Non-Functional Requirements (NFRs)

### 8.1 Performance & Latency
* **Signaling Latency**: < 50ms round-trip over Cloudflare edge WebSockets.
* **Local LAN Streaming Latency**: < 15ms peer-to-peer across 802.11ac/ax local Wi-Fi.
* **Initial Page Load**: < 1.2s on 4G mobile connections (compressed bundle < 140 KB gzip).

### 8.2 Reliability & Fault Tolerance
* **Zero Message Loss**: If WebRTC DataChannel experiences packet drop or disconnects, the hybrid relay automatically ensures 100% delivery via WebSocket signaling.
* **Automatic Reconnection**: Transient mobile network drops auto-recover within 2 seconds using native `iceRestart`.
* **Resource Cleanup**: Zero memory leaks; unmounted video tracks and peer connections are explicitly detached and garbage-collected.

### 8.3 Browser & Platform Support
* Fully compatible with modern evergreen browsers:
  * Google Chrome / Chromium / Brave / Edge (v100+)
  * Mozilla Firefox (v100+)
  * Apple Safari & iOS Mobile Safari (v15+)
  * Android Chrome & Samsung Internet

---

## 9. Testing & Quality Assurance Plan

### 9.1 Automated Load Testing Tooling
NukeChat maintains a built-in 50-person classroom simulator located in [`scripts/simulate-classroom.cjs`](file:///e:/Vs%20Code/Projects/NukeChat/scripts/simulate-classroom.cjs):
* **Execution**: `npm run test:50` or `node scripts/simulate-classroom.cjs [ROOM_CODE]`.
* **Simulated Behaviors**: Spawns 50 virtual student clients with native WebSockets, simulates live WebRTC answer negotiation, fires automated Q&A questions, triggers hand-raises, and executes network churn / drop recovery.
* **Telemetry Dashboard**: Runs a live HTTP monitoring dashboard on `http://localhost:4040` tracking active students, heartbeat latency, and traffic volume.

### 9.2 Test Matrix
| Category | Scope | Verification Method |
| :--- | :--- | :--- |
| **Unit & Crypto** | PBKDF2 derivation, AES-GCM encrypt/decrypt | Vitest test suite (`npm run test`) |
| **P2P Mesh** | DataChannel framing, chunk reconstruction | Multi-browser automated Puppeteer suite |
| **Load & Concurrency** | 50 concurrent students in Local Meet | `scripts/simulate-classroom.cjs` |
| **Network Resilience** | Drop 10 students, verify instant recovery | Simulator drop/reconnect API tests |
| **End-to-End Nuke** | Majority consensus nuke trigger & wipe | Dual-browser manual & automated integration |

---

## 10. Product Roadmap

### Phase 1 (Completed ✅)
* [x] Core Timed Chat with AES-256-GCM client-side encryption.
* [x] Nuke Voting consensus engine with full-screen explosion canvas.
* [x] WebRTC P2P DataChannel mesh for text and binary file sharing.
* [x] Sharded Random Chat matchmaking engine.
* [x] Local Meet classroom broadcasting with Star Topology LAN detection.
* [x] 50-person load simulator with live telemetry dashboard.
* [x] Multi-protocol TURN (TCP/TLS TURNS) and zero-drop WebSocket relay fallback.

### Phase 2 (Near-Term 🎯)
* [ ] **Audio Only Mode**: Toggle audio-only broadcast to support low-power devices in poor Wi-Fi conditions.
* [ ] **Host Whiteboard Canvas**: Collaborative vector drawing canvas for classroom teachers.
* [ ] **Classroom Polls**: Ephemeral multi-choice polls with instant live tally inside the Q&A drawer.
* [ ] **PWA Offline Mode**: Complete service worker caching for 100% offline local Wi-Fi meetings without internet access.

### Phase 3 (Future Horizons 🔮)
* [ ] **Multi-Broadcaster Panel**: Allow the host to invite up to 3 guest speakers onto the stage.
* [ ] **Encrypted Audio Recording**: Client-side local WebM recording saved directly to disk (never uploaded to any server).
