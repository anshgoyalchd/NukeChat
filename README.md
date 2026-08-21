# Nuke Chat

> **Talk. Share. Nuke It.**

Nuke Chat is a production-quality, anonymous, temporary communication web application designed to operate 100% within free-tier cloud infrastructure. It requires zero accounts, zero databases, and zero message retention. 

---

## 🚀 Key Features

* **Accountless & Ephemeral**: No login, sign-up, or tracking. Everyone is assigned a random adjective-animal identity (e.g. `Sleepy Panda 482`) with a pastel avatar.
* **Two Room Types**:
  1. **Timed Chat**: Server-authoritative text chat expiring in 15m, 30m, 1h, or 2h. Messages are end-to-end encrypted with `AES-256-GCM` and destroyed when the room expires or the last user leaves.
  2. **P2P Chat**: Mesh-connected peer-to-peer room for up to 12 participants sharing text, images, videos, and files directly using WebRTC DataChannels. Payloads never touch the server.
* **One Room Rule**: A single device session can only belong to one active room at a time.
* **Nuke Voting**: Any participant can initiate a vote to nuke the chat. If `voted > active / 2`, the room data is instantly wiped, connections severed, and a custom nuclear explosion animation is rendered across all clients.

---

## 📖 Technical Blog & Resources

Explore detailed technical explainers about the Nuke Chat architecture, encryption, and peer-to-peer designs:

* **[How P2P WebRTC Mesh Networks Enable Serverless Secure File Sharing](https://nuke-chat.pages.dev/#/blog/p2p-webrtc-file-sharing)**: Deep dive into how browser-native WebRTC DataChannels transfer files directly between peers without intermediate cloud storage.
* **[How Client-Side AES-256-GCM Encryption Works in the Browser](https://nuke-chat.pages.dev/#/blog/client-side-aes-gcm-encryption)**: Learn how browser-native Web Crypto APIs PBKDF2 key derivation and AES-GCM are implemented client-side.
* **[Why Serverless Architecture is the Future of Privacy-First Ephemeral Apps](https://nuke-chat.pages.dev/#/blog/serverless-privacy-ephemeral-apps)**: Read about why running temporary chat databases in-memory via Cloudflare Durable Objects matches the requirements of disposable messaging.

---

## 🛠️ Technology Stack

* **Frontend**: React (TypeScript), Vite, Tailwind CSS, Framer Motion, IndexedDB
* **Backend**: Cloudflare Workers, Hono, Durable Objects (SQLite-backed storage)
* **Realtime**: WebSockets, WebRTC DataChannels
* **Security**: Web Crypto API (AES-256-GCM, SHA-256)

---

## 📂 Project Structure

```text
NukeChat/
├── backend/                  # Cloudflare Workers & Durable Objects code
├── frontend/                 # React & Vite client application
├── shared/                   # Common typescript interfaces & event types
├── README.md                 # Main overview
├── ARCHITECTURE.md           # System design & execution flows
├── SECURITY.md               # Cryptographic primitives & identity models
├── DEVELOPMENT.md            # Local setup & testing guides
├── DEPLOYMENT.md             # Production setup details (Cloudflare Pages/Workers)
├── API.md                    # HTTP API endpoint specifications
├── REALTIME.md               # WebSocket event formats
├── WEBRTC.md                 # Signaling & P2P data chunking flow
├── DATABASE.md               # SQLite table layout inside Durable Objects
├── TESTING.md                # Test suites description (Unit, Integration, E2E)
└── LIMITATIONS.md            # Honest analysis of network constraints & capacity
```

---

## 💻 Quick Start

### Prerequisites
* Node.js v18+
* Cloudflare Wrangler CLI (`npm i -g wrangler`)

### Local Setup

1. **Install Dependencies**
   ```bash
   # Root / shared packages
   npm install
   ```

2. **Run Backend (Cloudflare Miniflare)**
   ```bash
   cd backend
   npm run dev
   ```

3. **Run Frontend (Vite Dev Server)**
   ```bash
   cd frontend
   npm run dev
   ```

*Refer to [DEVELOPMENT.md](file:///e:/Vs Code/Projects/NukeChat/DEVELOPMENT.md) for more details.*
