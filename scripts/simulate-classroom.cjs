/**
 * NukeChat - 50-Person Classroom & P2P Load Testing Simulator
 * 
 * Features:
 * - Simulates 50 (or custom N) concurrent attendees/students connecting via WebSocket
 * - Handles authentication, join deduplication, heartbeats, and room sync
 * - Interactive classroom events: hand raising, Q&A chat messages, disconnect/reconnect simulation
 * - Built-in Local Control Dashboard at http://localhost:4040
 * - Real-time statistics, event logs, and programmatic JSON API (/api/status)
 * 
 * Usage:
 *   node scripts/simulate-classroom.cjs [ROOM_CODE] [--count=50]
 *   Example: node scripts/simulate-classroom.cjs 109304
 *   If no room code is passed, it automatically creates a fresh classroom room!
 */

const http = require("http");
const crypto = require("crypto");

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || "https://nuke-chat-backend.ansh-goyalchd.workers.dev";
const WS_BASE_URL = BACKEND_URL.replace(/^http/, "ws");
const DASHBOARD_PORT = parseInt(process.env.PORT || "4040", 10);

// CLI Arguments
const args = process.argv.slice(2);
let targetRoomCode = args.find((a) => !a.startsWith("--")) || "";
const countArg = args.find((a) => a.startsWith("--count="));
const TOTAL_BOTS = countArg ? parseInt(countArg.split("=")[1], 10) : 50;

// Student Names Pool
const FIRST_NAMES = [
  "Aarav", "Emma", "Liam", "Sofia", "Noah", "Olivia", "Ethan", "Maya",
  "Lucas", "Ava", "Mason", "Isabella", "Logan", "Mia", "Oliver", "Harper",
  "Elijah", "Evelyn", "Aiden", "Abigail", "James", "Emily", "Benjamin", "Ella",
  "Alexander", "Elizabeth", "Jackson", "Camila", "Sebastian", "Luna", "Daniel", "Chloe",
  "Matthew", "Penelope", "Henry", "Layla", "Joseph", "Riley", "Samuel", "Zoey",
  "David", "Nora", "Carter", "Lily", "Wyatt", "Eleanor", "John", "Hannah",
  "Owen", "Lillian", "Dylan", "Addison", "Luke", "Aubrey", "Gabriel", "Ellie"
];

const LAST_NAMES = [
  "Sharma", "Chen", "Patel", "Rodriguez", "Kim", "Davis", "Gupta", "Smith",
  "Johnson", "Williams", "Brown", "Jones", "Miller", "Wilson", "Moore", "Taylor",
  "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson", "Garcia",
  "Martinez", "Robinson", "Clark", "Lee", "Walker", "Hall", "Allen", "Young"
];

const SAMPLE_QUESTIONS = [
  "Can you zoom in a bit on the diagram?",
  "Is audio clear for everyone?",
  "Could you please repeat that last slide point?",
  "What is the time complexity of this approach?",
  "Will the presentation slides be shared after this?",
  "Understood clearly, thank you!",
  "Great explanation, makes complete sense now.",
  "Quick question: does this also work offline?",
  "Screen quality looks crisp!",
  "Can you show the example code once more?"
];

// In-Memory Simulation State
const state = {
  roomCode: targetRoomCode,
  hostKey: "",
  roomType: "meet",
  hostId: "",
  totalBots: TOTAL_BOTS,
  connectedCount: 0,
  handsRaisedCount: 0,
  messagesSentCount: 0,
  autoTraffic: false,
  autoTrafficInterval: null,
  logs: [],
  bots: [], // { id, name, avatar, ws, isConnected, handRaised, pingMs }
};

function log(msg, type = "info") {
  const time = new Date().toLocaleTimeString();
  const entry = { time, msg, type };
  state.logs.unshift(entry);
  if (state.logs.length > 200) state.logs.pop();
  console.log(`[${time}] [${type.toUpperCase()}] ${msg}`);
}

function generateAvatarSvg(name) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const colors = ["#6366F1", "#EC4899", "#10B981", "#F59E0B", "#8B5CF6", "#06B6D4", "#3B82F6"];
  const color = colors[Math.abs(name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)) % colors.length];
  return `data:image/svg+xml;utf8,<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" rx="50" fill="${color}"/><text x="50" y="58" font-size="38" font-weight="bold" fill="white" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`;
}

// 1. Create or verify Room
async function ensureRoom() {
  if (state.roomCode) {
    log(`Targeting specified room: ${state.roomCode}`);
    return;
  }

  log(`No room code provided. Auto-creating a fresh Classroom room on ${BACKEND_URL}...`);
  try {
    const res = await fetch(`${BACKEND_URL}/api/room/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "meet",
        visibility: "private",
        expiresInMinutes: 120,
      }),
    });
    const data = await res.json();
    if (data.success && data.roomCode) {
      state.roomCode = data.roomCode;
      state.hostKey = data.hostKey || "";
      log(`Created Classroom room: ${state.roomCode}`);
      const hostUrl = `https://nuke-chat.pages.dev/#/join/${state.roomCode}${state.hostKey ? `?hostKey=${state.hostKey}` : ""}`;
      log(`Join URL for Host: ${hostUrl}`);
    } else {
      throw new Error(data.error || "Failed to create room");
    }
  } catch (err) {
    log(`Error creating room: ${err.message}. Defaulting to 109304`, "error");
    state.roomCode = "109304";
  }
}

// 2. Connect a single Simulated Student
function spawnBot(index) {
  const firstName = FIRST_NAMES[index % FIRST_NAMES.length];
  const lastName = LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length];
  const name = `${firstName} ${lastName}`;
  const id = crypto.randomUUID();
  const avatar = generateAvatarSvg(name);

  const bot = {
    index: index + 1,
    id,
    name,
    avatar,
    ws: null,
    isConnected: false,
    handRaised: false,
    pingMs: 0,
    connect() {
      const wsUrl = `${WS_BASE_URL}/ws/room/${state.roomCode}?sessionId=${id}&identity=${encodeURIComponent(name)}&avatar=${encodeURIComponent(avatar)}`;
      try {
        const ws = new WebSocket(wsUrl);
        bot.ws = ws;

        ws.onopen = () => {
          bot.isConnected = true;
          state.connectedCount = state.bots.filter((b) => b.isConnected).length;
          log(`[Bot #${bot.index}] ${name} joined room ${state.roomCode}`, "success");

          // Start Heartbeat interval
          bot.heartbeatInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              const start = Date.now();
              ws.send(JSON.stringify({ type: "HEARTBEAT", senderId: id, timestamp: start, payload: {} }));
              bot.pingMs = Date.now() - start;
            }
          }, 15000);
        };

        ws.onmessage = (event) => {
          try {
            const envelope = JSON.parse(event.data);
            if (envelope.type === "ROOM_JOINED") {
              if (envelope.payload?.hostId) {
                state.hostId = envelope.payload.hostId;
              }
            } else if (envelope.type === "SIGNAL") {
              // Respond to WebRTC offer if Host is initiating stream
              const signal = envelope.payload?.signal;
              if (signal?.type === "sdp-offer" && envelope.senderId) {
                log(`[Bot #${bot.index}] Received broadcast stream offer from Host ${envelope.senderId}. Answering...`);
                ws.send(JSON.stringify({
                  type: "SIGNAL",
                  senderId: id,
                  payload: {
                    targetId: envelope.senderId,
                    signal: {
                      type: "sdp-answer",
                      data: {
                        type: "answer",
                        sdp: signal.data?.sdp ? signal.data.sdp.replace(/a=sendrecv/g, "a=recvonly") : "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n",
                      },
                    },
                  },
                }));
              }
            }
          } catch (e) {}
        };

        ws.onclose = () => {
          bot.isConnected = false;
          clearInterval(bot.heartbeatInterval);
          state.connectedCount = state.bots.filter((b) => b.isConnected).length;
          log(`[Bot #${bot.index}] ${name} disconnected.`, "warn");
        };

        ws.onerror = (err) => {
          log(`[Bot #${bot.index}] WebSocket error: ${err.message || "error"}`, "error");
        };
      } catch (e) {
        log(`Failed connecting bot #${bot.index}: ${e.message}`, "error");
      }
    },
    disconnect() {
      if (bot.ws) {
        try {
          bot.ws.close();
        } catch (e) {}
        bot.ws = null;
      }
      bot.isConnected = false;
      state.connectedCount = state.bots.filter((b) => b.isConnected).length;
    },
    raiseHand() {
      if (!bot.isConnected || !bot.ws || bot.ws.readyState !== WebSocket.OPEN) return;
      bot.handRaised = true;
      state.handsRaisedCount++;
      bot.ws.send(JSON.stringify({
        type: "MESSAGE_SENT",
        senderId: id,
        timestamp: Date.now(),
        payload: {
          messageId: crypto.randomUUID(),
          senderName: name,
          text: `✋ ${name} raised their hand!`,
        },
      }));
      log(`[Bot #${bot.index}] ✋ ${name} raised their hand!`, "action");

      // Auto-lower hand after 25s
      setTimeout(() => {
        bot.handRaised = false;
        state.handsRaisedCount = Math.max(0, state.handsRaisedCount - 1);
      }, 25000);
    },
    askQuestion(text) {
      if (!bot.isConnected || !bot.ws || bot.ws.readyState !== WebSocket.OPEN) return;
      const question = text || SAMPLE_QUESTIONS[Math.floor(Math.random() * SAMPLE_QUESTIONS.length)];
      state.messagesSentCount++;
      bot.ws.send(JSON.stringify({
        type: "MESSAGE_SENT",
        senderId: id,
        timestamp: Date.now(),
        payload: {
          messageId: crypto.randomUUID(),
          senderName: name,
          text: question,
        },
      }));
      log(`[Bot #${bot.index}] 💬 ${name} asked in Q&A: "${question}"`, "action");
    },
  };

  state.bots.push(bot);
  return bot;
}

// 3. Launch all Bots with staggered ramp-up
function launchAllBots() {
  log(`Spawning ${TOTAL_BOTS} virtual classroom students...`);
  for (let i = 0; i < TOTAL_BOTS; i++) {
    const bot = spawnBot(i);
    // Stagger connections every 60ms to avoid hammering local sockets simultaneously
    setTimeout(() => {
      bot.connect();
    }, i * 60);
  }
}

// 4. Automated Classroom Traffic Toggle
function toggleAutoTraffic(enable) {
  state.autoTraffic = enable !== undefined ? enable : !state.autoTraffic;
  if (state.autoTraffic) {
    log("Auto-traffic ENABLED: Students will randomly raise hands and ask questions every 4-8s.");
    state.autoTrafficInterval = setInterval(() => {
      const connectedBots = state.bots.filter((b) => b.isConnected);
      if (connectedBots.length === 0) return;
      
      const randomBot = connectedBots[Math.floor(Math.random() * connectedBots.length)];
      if (Math.random() > 0.45) {
        randomBot.raiseHand();
      } else {
        randomBot.askQuestion();
      }
    }, 5000);
  } else {
    log("Auto-traffic DISABLED.");
    clearInterval(state.autoTrafficInterval);
    state.autoTrafficInterval = null;
  }
}

// 5. Local Web Dashboard & Control Center
function startDashboardServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    // API: Current Status JSON
    if (url.pathname === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        roomCode: state.roomCode,
        totalBots: state.totalBots,
        connectedCount: state.connectedCount,
        handsRaisedCount: state.handsRaisedCount,
        messagesSentCount: state.messagesSentCount,
        autoTraffic: state.autoTraffic,
        logs: state.logs.slice(0, 30),
        bots: state.bots.map((b) => ({
          index: b.index,
          id: b.id,
          name: b.name,
          isConnected: b.isConnected,
          handRaised: b.handRaised,
          pingMs: b.pingMs,
        })),
      }));
      return;
    }

    // API: Actions
    if (url.pathname === "/api/action") {
      const action = url.searchParams.get("type");
      const connected = state.bots.filter((b) => b.isConnected);

      if (action === "raise-hand") {
        if (connected.length > 0) {
          const b = connected[Math.floor(Math.random() * connected.length)];
          b.raiseHand();
        }
      } else if (action === "raise-5-hands") {
        const shuffled = [...connected].sort(() => 0.5 - Math.random());
        shuffled.slice(0, Math.min(5, shuffled.length)).forEach((b) => b.raiseHand());
      } else if (action === "ask-question") {
        if (connected.length > 0) {
          const b = connected[Math.floor(Math.random() * connected.length)];
          b.askQuestion();
        }
      } else if (action === "toggle-auto") {
        toggleAutoTraffic();
      } else if (action === "reconnect-all") {
        state.bots.forEach((b, i) => {
          if (!b.isConnected) {
            setTimeout(() => b.connect(), i * 40);
          }
        });
      } else if (action === "drop-10") {
        const active = state.bots.filter((b) => b.isConnected);
        active.slice(0, 10).forEach((b) => b.disconnect());
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // HTML Control Dashboard UI
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>NukeChat - 50-Student Testing Simulator</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
          body { background: #0A0A0B; color: #F3F4F6; font-family: system-ui, -apple-system, sans-serif; }
        </style>
      </head>
      <body class="p-4 md:p-8 max-w-6xl mx-auto">
        <!-- Top Bar -->
        <div class="flex flex-col md:flex-row md:items-center justify-between border-b border-neutral-800 pb-6 mb-6 gap-4">
          <div>
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-black uppercase mb-2">
              <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Live Load Simulator
            </div>
            <h1 class="text-2xl md:text-3xl font-black tracking-tight">Classroom Testing Environment</h1>
            <p class="text-neutral-400 text-xs mt-1">Simulating 50 active students with WebSocket messaging, hand-raising, and live WebRTC sync.</p>
          </div>
          
          <div class="flex items-center gap-3">
            <div class="bg-neutral-900 border border-neutral-800 rounded-2xl px-4 py-2.5 text-right">
              <span class="text-[10px] text-neutral-400 font-bold uppercase tracking-wider block">Target Room Code</span>
              <span class="text-xl font-mono font-black text-amber-400 tracking-wider">\${state.roomCode}</span>
            </div>
            <a href="https://nuke-chat.pages.dev/#/join/\${state.roomCode}\${state.hostKey ? '?hostKey=' + state.hostKey : ''}" target="_blank" class="px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs uppercase tracking-wider rounded-2xl shadow-lg transition-all active:scale-95 flex items-center gap-2">
              Open As Host ↗
            </a>
          </div>
        </div>

        <!-- Metric Stat Cards -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div class="bg-neutral-900/80 border border-neutral-800 p-4 rounded-2xl">
            <span class="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">Connected Students</span>
            <div class="text-2xl font-black text-white flex items-baseline gap-1">
              <span id="stat-connected" class="text-emerald-400">\${state.connectedCount}</span>
              <span class="text-neutral-500 text-sm font-normal">/ \${state.totalBots}</span>
            </div>
          </div>

          <div class="bg-neutral-900/80 border border-neutral-800 p-4 rounded-2xl">
            <span class="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">Active Hand Raises</span>
            <div class="text-2xl font-black text-amber-400" id="stat-hands">
              \${state.handsRaisedCount}
            </div>
          </div>

          <div class="bg-neutral-900/80 border border-neutral-800 p-4 rounded-2xl">
            <span class="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">Q&A Questions</span>
            <div class="text-2xl font-black text-sky-400" id="stat-msgs">
              \${state.messagesSentCount}
            </div>
          </div>

          <div class="bg-neutral-900/80 border border-neutral-800 p-4 rounded-2xl">
            <span class="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">Auto-Traffic Mode</span>
            <div class="text-lg font-black" id="stat-auto">
              \${state.autoTraffic ? "<span class='text-emerald-400'>ACTIVE (5s)</span>" : "<span class='text-neutral-500'>OFF</span>"}
            </div>
          </div>
        </div>

        <!-- Quick Action Trigger Buttons -->
        <div class="bg-neutral-900/60 border border-neutral-800 p-4 rounded-3xl mb-6">
          <span class="text-xs font-bold text-neutral-400 uppercase tracking-wider block mb-3">Live Testing Controls</span>
          <div class="flex flex-wrap gap-2.5">
            <button onclick="triggerAction('raise-hand')" class="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95">
              ✋ Raise 1 Hand
            </button>
            <button onclick="triggerAction('raise-5-hands')" class="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95">
              ✋ Raise 5 Hands
            </button>
            <button onclick="triggerAction('ask-question')" class="px-4 py-2 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95">
              💬 Ask Q&A Question
            </button>
            <button onclick="triggerAction('toggle-auto')" id="btn-auto" class="px-4 py-2 bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/40 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95">
              ⚡ Toggle Auto-Traffic
            </button>
            <button onclick="triggerAction('drop-10')" class="px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95">
              🚪 Simulate 10 Drops
            </button>
            <button onclick="triggerAction('reconnect-all')" class="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95">
              🔄 Reconnect All
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Live Event Log Stream -->
          <div class="lg:col-span-2 bg-neutral-900/80 border border-neutral-800 rounded-3xl p-4 flex flex-col h-96">
            <div class="flex items-center justify-between border-b border-neutral-800 pb-3 mb-3">
              <span class="text-xs font-bold uppercase tracking-wider text-neutral-400">Real-Time Event Stream</span>
              <span class="text-[10px] text-neutral-500 font-mono">Live updates every 1.5s</span>
            </div>
            <div id="log-container" class="flex-1 overflow-y-auto space-y-2 font-mono text-xs pr-2">
              \${state.logs.map((l) => \`
                <div class="flex items-start gap-2 py-0.5 \${l.type === 'action' ? 'text-amber-300' : l.type === 'success' ? 'text-emerald-400' : l.type === 'warn' ? 'text-amber-400' : l.type === 'error' ? 'text-rose-400' : 'text-neutral-300'}">
                  <span class="text-neutral-600 shrink-0">[\${l.time}]</span>
                  <span class="break-all">\${l.msg}</span>
                </div>
              \`).join("")}
            </div>
          </div>

          <!-- Student Roster Grid (Compact) -->
          <div class="bg-neutral-900/80 border border-neutral-800 rounded-3xl p-4 flex flex-col h-96">
            <div class="flex items-center justify-between border-b border-neutral-800 pb-3 mb-3">
              <span class="text-xs font-bold uppercase tracking-wider text-neutral-400">Student Roster (\${state.totalBots})</span>
            </div>
            <div id="roster-container" class="flex-1 overflow-y-auto space-y-1.5 pr-2">
              \${state.bots.map((b) => \`
                <div class="flex items-center justify-between p-2 rounded-xl bg-black/40 border border-neutral-800/80 text-xs">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="w-2 h-2 rounded-full \${b.isConnected ? 'bg-emerald-400' : 'bg-neutral-600'}"></span>
                    <span class="font-bold text-neutral-200 truncate max-w-[130px]">\${b.name}</span>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    \${b.handRaised ? "<span class='text-amber-400'>✋</span>" : ""}
                    <span class="text-[10px] text-neutral-500 font-mono">\${b.isConnected ? 'Online' : 'Offline'}</span>
                  </div>
                </div>
              \`).join("")}
            </div>
          </div>
        </div>

        <script>
          async function triggerAction(actionType) {
            await fetch('/api/action?type=' + actionType);
            refreshData();
          }

          async function refreshData() {
            try {
              const res = await fetch('/api/status');
              const data = await res.json();
              document.getElementById('stat-connected').innerText = data.connectedCount;
              document.getElementById('stat-hands').innerText = data.handsRaisedCount;
              document.getElementById('stat-msgs').innerText = data.messagesSentCount;
              document.getElementById('stat-auto').innerHTML = data.autoTraffic 
                ? "<span class='text-emerald-400'>ACTIVE (5s)</span>" 
                : "<span class='text-neutral-500'>OFF</span>";

              // Update logs
              const logBox = document.getElementById('log-container');
              logBox.innerHTML = data.logs.map(l => \`
                <div class="flex items-start gap-2 py-0.5 \${l.type === 'action' ? 'text-amber-300' : l.type === 'success' ? 'text-emerald-400' : l.type === 'warn' ? 'text-amber-400' : l.type === 'error' ? 'text-rose-400' : 'text-neutral-300'}">
                  <span class="text-neutral-600 shrink-0">[\${l.time}]</span>
                  <span class="break-all">\${l.msg}</span>
                </div>
              \`).join('');

              // Update Roster
              const rosterBox = document.getElementById('roster-container');
              rosterBox.innerHTML = data.bots.map(b => \`
                <div class="flex items-center justify-between p-2 rounded-xl bg-black/40 border border-neutral-800/80 text-xs">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="w-2 h-2 rounded-full \${b.isConnected ? 'bg-emerald-400' : 'bg-neutral-600'}"></span>
                    <span class="font-bold text-neutral-200 truncate max-w-[130px]">\${b.name}</span>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    \${b.handRaised ? "<span class='text-amber-400'>✋</span>" : ""}
                    <span class="text-[10px] text-neutral-500 font-mono">\${b.isConnected ? 'Online' : 'Offline'}</span>
                  </div>
                </div>
              \`).join('');
            } catch (e) {}
          }

          setInterval(refreshData, 1500);
        </script>
      </body>
      </html>
    `);
  });

  server.listen(DASHBOARD_PORT, () => {
    log(`Local Web Testing Dashboard is LIVE at http://localhost:${DASHBOARD_PORT}`, "success");
  });
}

// 6. Main Execution
async function main() {
  console.log("=================================================");
  console.log("   NukeChat 50-Attendee Classroom Load Simulator ");
  console.log("=================================================");
  
  await ensureRoom();
  startDashboardServer();
  launchAllBots();

  // Print summary instructions
  setTimeout(() => {
    console.log("\n-------------------------------------------------");
    console.log(`🎯 Room Code: ${state.roomCode}`);
    console.log(`📊 Local Web Control Dashboard: http://localhost:${DASHBOARD_PORT}`);
    console.log(`🌐 Open in browser as Host: https://nuke-chat.pages.dev/#/join/${state.roomCode}${state.hostKey ? `?hostKey=${state.hostKey}` : ""}`);
    console.log("-------------------------------------------------\n");
  }, 1000);
}

main().catch((err) => {
  console.error("Fatal simulation error:", err);
});
