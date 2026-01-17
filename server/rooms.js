const rooms = new Map(); // code -> room

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createRoom(hostSocket, name = "Player 1") {
  let code;
  do code = makeCode(); while (rooms.has(code));

  const room = {
    code,
    status: "lobby", // lobby | playing | finished
    players: [
      { socketId: hostSocket.id, name, ready: false },
    ],
    match: null,
    createdAt: Date.now(),
  };

  rooms.set(code, room);
  hostSocket.join(code);
  return room;
}

function getPublicRoomState(room) {
  return {
    code: room.code,
    status: room.status,
    players: room.players.map(p => ({ name: p.name, ready: p.ready })),
    match: room.match ? { turn: room.match.turn, active: room.match.active } : null,
  };
}

function joinRoom(room, socket, name = "Player 2") {
  if (room.players.length >= 2) return { ok: false, reason: "room_full" };
  if (room.status !== "lobby") return { ok: false, reason: "already_started" };

  room.players.push({ socketId: socket.id, name, ready: false });
  socket.join(room.code);
  return { ok: true };
}

function setReady(room, socketId, ready) {
  const p = room.players.find(x => x.socketId === socketId);
  if (!p) return false;
  p.ready = !!ready;
  return true;
}

function canStart(room) {
  return room.status === "lobby" && room.players.length === 2 && room.players.every(p => p.ready);
}

function startMatch(room) {
  room.status = "playing";
  // минимальный authoritative state матча:
  room.match = {
    turn: 1,
    active: 0, // индекс активного игрока (0/1)
    seed: Math.floor(Math.random() * 1e9),
    // позже добавим: колоды, руки, поле, энергия и т.д.
  };
}

function findRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.socketId === socketId)) return room;
  }
  return null;
}

function removePlayer(socketId) {
  const room = findRoomBySocket(socketId);
  if (!room) return null;

  room.players = room.players.filter(p => p.socketId !== socketId);

  // если никого не осталось — удаляем комнату
  if (room.players.length === 0) {
    rooms.delete(room.code);
    return { room: null, deletedCode: room.code };
  }

  // если матч шел — можно завершить, либо вернуть в лобби (на твой выбор)
  if (room.status === "playing") {
    room.status = "lobby";
    room.match = null;
    room.players.forEach(p => (p.ready = false));
  }

  return { room, deletedCode: null };
}

module.exports = {
  rooms,
  createRoom,
  joinRoom,
  setReady,
  canStart,
  startMatch,
  getPublicRoomState,
  removePlayer,
  findRoomBySocket,
};
