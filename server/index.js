// server/index.js
// Socket.IO server for Re Cards (rooms by code + lobby ready + match start + authoritative sync)

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.get("/", (_, res) => res.send("Re Cards server is running ✅"));

const server = http.createServer(app);

// ✅ For Vercel client + local dev, allow CORS.
// Set CLIENT_ORIGIN in Render to your Vercel domain (e.g. https://re-cards.vercel.app)
// or keep "*" while prototyping.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  },
});

// ------------------------------
// In-memory room storage (MVP)
// ------------------------------
const rooms = new Map(); // code -> room

function makeCode() {
  // Avoid confusing chars: I/O/1/0
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getPublicRoomState(room) {
  return {
    code: room.code,
    status: room.status, // lobby | playing
    players: room.players.map((p) => ({
      name: p.name,
      ready: p.ready,
    })),
    match: room.match
      ? {
          schemaVersion: room.match.schemaVersion,
          turn: room.match.turn,
          active: room.match.active,
          seed: room.match.seed,
        }
      : null,
  };
}

function createRoom(socket, name = "Player 1") {
  let code;
  do code = makeCode();
  while (rooms.has(code));

  const room = {
    code,
    status: "lobby",
    players: [{ socketId: socket.id, name, ready: false }],
    match: null,
    createdAt: Date.now(),
  };

  rooms.set(code, room);
  socket.join(code);
  return room;
}

function joinRoom(room, socket, name = "Player 2") {
  if (room.status !== "lobby") return { ok: false, reason: "already_started" };
  if (room.players.length >= 2) return { ok: false, reason: "room_full" };

  room.players.push({ socketId: socket.id, name, ready: false });
  socket.join(room.code);
  return { ok: true };
}

function setReady(room, socketId, ready) {
  const p = room.players.find((x) => x.socketId === socketId);
  if (!p) return false;
  p.ready = !!ready;
  return true;
}

function canStart(room) {
  return room.status === "lobby" && room.players.length === 2 && room.players.every((p) => p.ready);
}

function startMatch(room) {
  room.status = "playing";

  // Authoritative state (data-only). UI assets are resolved client-side by cardId, etc.
  room.match = {
    schemaVersion: 1,
    turn: 1,
    active: 0, // index of active player (0/1)
    seed: Math.floor(Math.random() * 1e9),
    // Later you can add:
    // hands: [[], []],
    // board: [[], []],
    // graveyard: [[], []],
    // energy: [0, 0],
  };
}

function findRoomBySocketId(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.socketId === socketId)) return room;
  }
  return null;
}

function removePlayer(socketId) {
  const room = findRoomBySocketId(socketId);
  if (!room) return null;

  room.players = room.players.filter((p) => p.socketId !== socketId);

  // If empty — delete room
  if (room.players.length === 0) {
    rooms.delete(room.code);
    return { deletedCode: room.code, room: null };
  }

  // If game was running — reset back to lobby (simple MVP behavior)
  if (room.status === "playing") {
    room.status = "lobby";
    room.match = null;
    room.players.forEach((p) => (p.ready = false));
  }

  return { deletedCode: null, room };
}

// ------------------------------
// Socket handlers
// ------------------------------
io.on("connection", (socket) => {
  // Create room
  socket.on("room:create", ({ name } = {}, cb) => {
    const room = createRoom(socket, name);

    const state = getPublicRoomState(room);
    io.to(room.code).emit("room:state", state);

    cb?.({ ok: true, code: room.code, state });
  });

  // Join room
  socket.on("room:join", ({ code, name } = {}, cb) => {
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, reason: "not_found" });

    const res = joinRoom(room, socket, name);
    if (!res.ok) return cb?.(res);

    const state = getPublicRoomState(room);
    io.to(room.code).emit("room:state", state);

    cb?.({ ok: true, state });
  });

  // Toggle ready
  socket.on("room:ready", ({ code, ready } = {}, cb) => {
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, reason: "not_found" });

    const ok = setReady(room, socket.id, ready);
    if (!ok) return cb?.({ ok: false, reason: "not_in_room" });

    // Push lobby state update
    io.to(room.code).emit("room:state", getPublicRoomState(room));

    // Auto start when both ready
    if (canStart(room)) {
      startMatch(room);

      const state = getPublicRoomState(room);
      io.to(room.code).emit("match:start", state);
      io.to(room.code).emit("match:sync", state);
    }

    cb?.({ ok: true });
  });

  // OPTIONAL: simple ping for debugging latency
  socket.on("ping", (cb) => cb?.({ t: Date.now() }));

  // Future: match actions (reserved)
  // socket.on("match:action", ({ code, action } = {}, cb) => { ... })

  socket.on("disconnect", () => {
    const res = removePlayer(socket.id);
    if (res?.room) {
      io.to(res.room.code).emit("room:state", getPublicRoomState(res.room));
    }
  });
});

// ------------------------------
// Start server (Render requirement)
// ------------------------------
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Re Cards server listening on ${PORT} | CORS origin: ${CLIENT_ORIGIN}`);
});
