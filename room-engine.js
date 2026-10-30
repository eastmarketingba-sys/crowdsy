// Multiplayer room state machine for "Predict the Room". Pure: no I/O, no clock, no randomness.
// The server owns every room and calls these functions with the current time. Clients only see projections.
//
// Room status: lobby -> round (stages: predict, then choose) -> reveal -> round ... -> finished
// Scoring per round: a correct prediction earns POINTS and extends the streak. A wrong prediction resets it.
// A tie in the room votes means no majority: nobody scores and streaks are unchanged.
// Players who join during a round wait and join from the next round.
// A player who disconnects (no request for PRESENCE_MS) no longer blocks a stage from advancing.

const ROOM_LIMITS = {
  maxPlayers: 8,
  minPlayers: 2,
  rounds: 10,
  idleMs: 2 * 60 * 60 * 1000,
  presenceMs: 20000,
  points: 100
};
const NAME_RE = /^[\p{L}\p{N} _'-]{1,20}$/u;

function fail(error, message) {
  return { ok: false, error, message };
}

function normaliseName(name) {
  if (typeof name !== 'string') return null;
  const t = name.trim();
  return NAME_RE.test(t) ? t : null;
}

function makePlayer(id, name, token, now) {
  return { id, name, token, joinedAt: now, lastSeen: now, ready: false, waiting: false, score: 0, streak: 0, bestStreak: 0 };
}

function isConnected(player, now) {
  return now - player.lastSeen <= ROOM_LIMITS.presenceMs;
}

function findPlayer(room, id) {
  return room.players.find(p => p.id === id) || null;
}

function findByToken(room, token) {
  if (typeof token !== 'string' || token.length === 0) return null;
  return room.players.find(p => p.token === token) || null;
}

function touch(room, playerId, now) {
  const p = findPlayer(room, playerId);
  if (p) p.lastSeen = now;
  room.lastActive = now;
}

function createRoom({ code, id, token, name, now, deck }) {
  const player = makePlayer(id, name, token, now);
  return {
    code,
    status: 'lobby',
    createdAt: now,
    lastActive: now,
    hostId: id,
    players: [player],
    deck,
    total: Math.min(ROOM_LIMITS.rounds, deck.length),
    round: null,
    history: []
  };
}

function isExpired(room, now) {
  return now - room.lastActive > ROOM_LIMITS.idleMs;
}

function joinRoom(room, { id, token, name, now }) {
  if (room.players.length >= ROOM_LIMITS.maxPlayers) return fail('room_full', 'This room is full.');
  if (room.status === 'round' || room.status === 'reveal') {
    room.players.push(Object.assign(makePlayer(id, name, token, now), { waiting: true }));
  } else {
    room.players.push(makePlayer(id, name, token, now));
  }
  room.lastActive = now;
  return { ok: true };
}

function electHost(room) {
  const sorted = room.players.slice().sort((a, b) => a.joinedAt - b.joinedAt);
  room.hostId = sorted.length ? sorted[0].id : null;
}

function leaveRoom(room, playerId, now) {
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx < 0) return fail('not_in_room', 'You are not in this room.');
  room.players.splice(idx, 1);
  if (room.round) {
    room.round.participants = room.round.participants.filter(id => id !== playerId);
    delete room.round.predictions[playerId];
    delete room.round.choices[playerId];
  }
  if (room.hostId === playerId) electHost(room);
  room.lastActive = now;
  if (room.players.length === 0) return { ok: true, empty: true };
  if (room.status === 'round') evaluateStage(room, now);
  return { ok: true, empty: false };
}

function setReady(room, playerId, ready) {
  if (room.status !== 'lobby') return fail('not_lobby', 'Ready status can only change in the lobby.');
  const p = findPlayer(room, playerId);
  if (!p) return fail('not_in_room', 'You are not in this room.');
  p.ready = !!ready;
  return { ok: true };
}

function startRound(room, index, now) {
  room.status = 'round';
  room.round = {
    index,
    stage: 'predict',
    participants: room.players.map(p => p.id),
    predictions: {},
    choices: {},
    result: null
  };
  room.players.forEach(p => { p.waiting = false; });
  room.lastActive = now;
}

function startGame(room, playerId, now) {
  if (room.hostId !== playerId) return fail('not_host', 'Only the host can start the game.');
  if (room.status !== 'lobby') return fail('not_lobby', 'The game has already started.');
  if (room.players.length < ROOM_LIMITS.minPlayers) return fail('not_enough_players', 'You need at least two players to start.');
  if (!room.players.every(p => p.ready)) return fail('not_all_ready', 'Everyone needs to be ready before the host starts.');
  startRound(room, 0, now);
  return { ok: true };
}

function questionFor(room, index) {
  return room.deck[index];
}

function submit(room, playerId, type, idx, now) {
  if (room.status !== 'round' || !room.round) return fail('not_in_round', 'There is no round in progress.');
  const r = room.round;
  if (!r.participants.includes(playerId)) return fail('not_participant', 'You are not taking part in this round.');
  const q = questionFor(room, r.index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= q.o.length) return fail('invalid_option', 'That answer is not valid.');
  if (type === 'predict') {
    if (r.stage !== 'predict') return fail('wrong_stage', 'Predictions are closed for this round.');
    if (r.predictions[playerId] !== undefined) return fail('already_submitted', 'You have already locked in a prediction.');
    r.predictions[playerId] = idx;
  } else if (type === 'choose') {
    if (r.stage !== 'choose') return fail('wrong_stage', 'Choices open after everyone has predicted.');
    if (r.choices[playerId] !== undefined) return fail('already_submitted', 'You have already locked in your choice.');
    r.choices[playerId] = idx;
  } else {
    return fail('invalid_type', 'Unknown submission.');
  }
  touch(room, playerId, now);
  evaluateStage(room, now);
  return { ok: true };
}

// Advances the round when every connected participant has submitted. Disconnected players do not block.
function evaluateStage(room, now) {
  const r = room.round;
  if (!r || room.status !== 'round') return;
  const connected = r.participants.filter(id => {
    const p = findPlayer(room, id);
    return p && isConnected(p, now);
  });
  if (connected.length === 0) return;
  if (r.stage === 'predict' && connected.every(id => r.predictions[id] !== undefined)) {
    r.stage = 'choose';
  }
  if (r.stage === 'choose' && connected.every(id => r.choices[id] !== undefined)) {
    reveal(room);
  }
}

// Computes the round result. Votes come only from submitted choices. Scores update here, once.
function reveal(room) {
  const r = room.round;
  const q = questionFor(room, r.index);
  const votes = q.o.map(() => 0);
  Object.values(r.choices).forEach(i => { votes[i] += 1; });
  const max = Math.max(...votes);
  const tops = votes.map((c, i) => (c === max && max > 0 ? i : -1)).filter(i => i >= 0);
  const majority = tops.length === 1 ? tops[0] : null;
  const names = {};
  const correct = {};
  const points = {};
  room.players.forEach(p => { names[p.id] = p.name; });
  Object.keys(r.predictions).forEach(id => {
    const p = findPlayer(room, id);
    if (!p) return;
    if (majority === null) {
      correct[id] = null;
      points[id] = 0;
      return;
    }
    const hit = r.predictions[id] === majority;
    correct[id] = hit;
    points[id] = hit ? ROOM_LIMITS.points : 0;
    if (hit) {
      p.score += ROOM_LIMITS.points;
      p.streak += 1;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
    } else {
      p.streak = 0;
    }
  });
  r.result = {
    index: r.index,
    question: { id: q.id, q: q.q, o: q.o.slice() },
    votes,
    majority,
    tie: majority === null,
    predictions: Object.assign({}, r.predictions),
    choices: Object.assign({}, r.choices),
    correct,
    points,
    names
  };
  room.history.push(r.result);
  r.stage = 'reveal';
  room.status = 'reveal';
}

function hostReveal(room, playerId, now) {
  if (room.hostId !== playerId) return fail('not_host', 'Only the host can reveal early.');
  if (room.status !== 'round' || !room.round) return fail('not_in_round', 'There is no round in progress.');
  if (room.round.stage !== 'choose') return fail('wrong_stage', 'You can reveal once choices are open.');
  if (Object.keys(room.round.choices).length === 0) return fail('no_choices', 'Nobody has chosen yet.');
  room.lastActive = now;
  reveal(room);
  return { ok: true };
}

function nextRound(room, playerId, now) {
  if (room.hostId !== playerId) return fail('not_host', 'Only the host can move on.');
  if (room.status !== 'reveal') return fail('not_revealed', 'The round has not been revealed yet.');
  room.lastActive = now;
  const next = room.round.index + 1;
  if (next < room.total) {
    startRound(room, next, now);
  } else {
    room.status = 'finished';
    room.round = null;
  }
  return { ok: true, finished: room.status === 'finished' };
}

function rematch(room, playerId, newDeck, now) {
  if (room.hostId !== playerId) return fail('not_host', 'Only the host can start a rematch.');
  if (room.status !== 'finished') return fail('not_finished', 'The game is not finished yet.');
  room.deck = newDeck;
  room.total = Math.min(ROOM_LIMITS.rounds, newDeck.length);
  room.status = 'lobby';
  room.round = null;
  room.history = [];
  room.players.forEach(p => {
    p.ready = false;
    p.waiting = false;
    p.score = 0;
    p.streak = 0;
    p.bestStreak = 0;
  });
  room.lastActive = now;
  return { ok: true };
}

// What one player is allowed to see. Other players' predictions and choices stay hidden until the reveal.
function project(room, viewerId, now) {
  const me = findPlayer(room, viewerId);
  const r = room.round;
  const revealed = room.status === 'reveal' || room.status === 'finished';
  const view = {
    code: room.code,
    status: room.status,
    total: room.total,
    hostId: room.hostId,
    me: me ? { id: me.id, name: me.name, ready: me.ready, isHost: room.hostId === me.id } : null,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      isHost: room.hostId === p.id,
      connected: isConnected(p, now),
      waiting: p.waiting,
      score: p.score,
      streak: p.streak,
      bestStreak: p.bestStreak
    })),
    round: null,
    history: revealed ? room.history.slice() : undefined
  };
  if (r) {
    const q = questionFor(room, r.index);
    const mine = {
      predicted: r.predictions[viewerId] !== undefined ? r.predictions[viewerId] : null,
      chose: r.choices[viewerId] !== undefined ? r.choices[viewerId] : null
    };
    view.round = {
      index: r.index,
      stage: r.stage,
      question: { id: q.id, q: q.q, o: q.o.slice() },
      participants: r.participants.slice(),
      predictedBy: Object.keys(r.predictions),
      choseBy: Object.keys(r.choices),
      mine,
      result: revealed ? r.result : null
    };
  }
  return view;
}

if (typeof module !== 'undefined') {
  module.exports = {
    ROOM_LIMITS, NAME_RE, normaliseName, createRoom, joinRoom, leaveRoom, setReady, startGame, submit,
    hostReveal, nextRound, rematch, project, isExpired, findByToken, findPlayer, touch, evaluateStage, isConnected
  };
}
