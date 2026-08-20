# Local Development Guide

This guide walks you through setting up and running Nuke Chat on your local development machine.

---

## 🛠️ Prerequisites

Ensure you have the following installed:
- **Node.js**: version 18.x or higher
- **npm**: version 9.x or higher
- **Wrangler**: Cloudflare command-line interface (`npm install -g wrangler`)

---

## 📂 Project Organization

This project is a monorepo structured as:
* `shared/`: Shared typescript definitions.
* `backend/`: Cloudflare Workers & Durable Objects code.
* `frontend/`: React Vite SPA client.

---

## 🚀 Setup & Execution

### 1. Install Dependencies
From the repository root, install the necessary dependencies:
```bash
npm install
```

### 2. Configure Local Environment
Copy or create local configurations if needed. For Miniflare, local configurations are stored in `backend/wrangler.toml` (or `wrangler.json`).

### 3. Run Backend (Cloudflare Emulation)
Start the local Worker emulator (using Miniflare under the hood) which emulates Workers, Durable Objects, and the SQLite storage layer:
```bash
cd backend
npm run dev
```
By default, the backend will listen on `http://localhost:8787`.

### 4. Run Frontend
In a new terminal window, start the Vite development server:
```bash
cd frontend
npm run dev
```
By default, the frontend will listen on `http://localhost:5173`. Open this URL in your web browser.

---

## 🧪 Running Tests

We use **Vitest** for running unit and integration tests.

### Running Backend Unit Tests
```bash
cd backend
npm run test
```

### Running Frontend Tests
```bash
cd frontend
npm run test
```

### Running Playwright E2E Tests
To run E2E browser automation tests:
```bash
# Install playwright browsers (first-time setup)
npx playwright install

# Run the tests
npx playwright test
```
See [TESTING.md](file:///e:/Vs Code/Projects/NukeChat/TESTING.md) for more details.
