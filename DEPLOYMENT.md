# Deployment Guide

Nuke Chat is designed specifically for Cloudflare's free-tier serverless offerings. Follow this guide to deploy both the backend Worker and the frontend Pages application.

---

## 🌩️ Requirements

1. A free **Cloudflare Account**.
2. **Node.js** installed locally.
3. The **Wrangler** CLI logged into your Cloudflare account:
   ```bash
   wrangler login
   ```

---

## 1. Deploying the Backend (Cloudflare Workers)

The backend runs as a Cloudflare Worker using Durable Objects with SQLite storage. Note that the Durable Objects SQLite storage feature is available on the Workers Paid plan or within certain free limits under Cloudflare's Developer platform beta program. If deploying to the free tier, ensure Durable Objects are active on your account.

### Step 1: Configuration
Review `backend/wrangler.toml`. It defines the worker routing, the Durable Object bindings (`ROOM_DO` and `MATCHMAKING_DO`), and SQLite migration structures:

```toml
name = "nuke-chat-backend"
main = "src/index.ts"
compatibility_date = "2024-04-01"

[durable_objects]
binding = "ROOM_DO"
class_name = "RoomDO"

[durable_objects]
binding = "MATCHMAKING_DO"
class_name = "MatchmakingDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RoomDO", "MatchmakingDO"]
```

### Step 2: Deploy Backend
Navigate to the `backend/` directory and run:
```bash
cd backend
npm run deploy
```
This compile, bundles, and uploads the worker. Note the deployment URL (e.g., `https://nuke-chat-backend.your-subdomain.workers.dev`).

---

## 2. Deploying the Frontend (Cloudflare Pages)

The frontend is a static React application deployed to Cloudflare Pages.

### Step 1: Set Backend URL Environment Variable
Create a production environment file in `frontend/.env.production` (or compile using shell environment variables):
```env
VITE_BACKEND_URL=https://nuke-chat-backend.your-subdomain.workers.dev
```

### Step 2: Build the Frontend
Build the optimized static files from the `frontend/` directory:
```bash
cd frontend
npm run build
```
This generates a static build folder under `frontend/dist`.

### Step 3: Deploy to Cloudflare Pages
Deploy the `dist/` directory to Cloudflare Pages:
```bash
npx wrangler pages deploy dist --project-name nuke-chat
```
Follow the prompt commands to create the Pages project under the free tier. Your website will be available at `https://nuke-chat.pages.dev`.

---

## 🛑 Cost Verification & Free-Tier Guardrails

- **Zero DB Maintenance**: No databases to provision. SQLite resides within the Durable Object.
- **Auto-Sleep**: Workers and DOs hibernate when inactive, incurring **zero** runtime cost.
- **Fail Safe**: If Cloudflare's free limits (e.g., 100k requests/day) are reached, Cloudflare will automatically block new requests, rather than rolling over to paid billing (provided no billing profile is attached to the account).
