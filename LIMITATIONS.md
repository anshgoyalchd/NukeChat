# Product Boundaries & Technical Limitations

To keep Nuke Chat free and serverless, several structural trade-offs were made. This document outlines the physical and architectural limits of the MVP.

---

## 1. WebRTC NAT Traversal Constraints

### The TURN Server Limitation
- Nuke Chat uses public STUN servers to resolve public IP addresses for direct peer connection.
- **No TURN Server**: The app does not include a TURN (Traversal Using Relays around NAT) server, as TURN routing costs money (often $0.05 - $0.15 per GB).
- **Network Failures**: In environments with strict symmetric NATs or corporate firewalls (e.g., some universities, office networks, public Wi-Fi), direct WebRTC connection will fail.
- **Handling**: When a connection cannot be established after 10 seconds, the frontend alerts the user: *"P2P connection couldn't be established on this network. Please try switching to cellular data or another network."*

---

## 2. Participant Capacity Limits

### P2P Mesh limit: 12
- P2P chat operates as a full-mesh topology (every peer connects to all other peers).
- The number of connections scales as $N(N-1)/2$.
- At 12 peers, each client manages 11 concurrent RTCPeerConnections. Adding a 13th peer would trigger significant browser CPU usage and packet loss, especially on mobile devices.

### Timed Chat Limit: 50
- Timed chats route text messages through the Durable Object SQLite database.
- While SQLite inside Durable Objects handles hundreds of connections, we limit the capacity to 50 active users to prevent memory bloat and stay within free-tier resource allocations.

---

## 3. Session Boundaries

### One Room Rule
- A device is limited to one room using LocalStorage session flags.
- **Technical Bypass**: A user can bypass this rule by:
  - Opening an Incognito window.
  - Using a different browser (e.g., Firefox and Chrome).
  - Clearing site cookies and storage.
- The rule is a product-level session guide rather than a hard cryptographic security fence.

---

## 4. Free Tier Execution Safeguards

### Cloudflare Worker CPU & Memory Limits
- Workers free tier allows up to **10ms CPU time** per request. Durable Objects are subject to the DO execution limits (up to 128MB of memory).
- If the limits are crossed:
  - Cloudflare kills the worker instance.
  - Sockets will disconnect, prompting clients to reconnect.
- Large files transferred via P2P bypass this limitation entirely since payloads travel browser-to-browser.
