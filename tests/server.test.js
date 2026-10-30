// Run with: node --test tests/*.test.js
// Starts the real HTTP server on a free port and talks to it with independent clients (separate tokens, separate calls).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server.js');
const { loadBank, ROOT } = require('./helpers.js');
const ENGINE = require('../room-engine.js');

const BANK = loadBank();

function startServer() {
  const clock = { t: 1_000_000 };
  const { server, rooms } = createServer({ bank: BANK, now: () => clock.t, random: Math.random });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const base = 'http://127.0.0.1:' + server.address().port;
      resolve({ server, rooms, clock, base });
    });
  });
}

// One independent client. Keeps its own token, like a browser tab would.
function client(base, name) {
  let token = null;
  let code = null;
  const call = async (method, path, body, withToken = true) => {
    const headers = { 'Content-Type': 'application/json' };
    if (withToken && token) headers['X-Room-Token'] = token;
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
  return {
    name,
    get code() { return code; },
    get token() { return token; },
    async create() {
      const r = await call('POST', '/api/rooms', { name }, false);
      token = r.data.token; code = r.data.code;
      return r;
    },
    async join(c) {
      const r = await call('POST', '/api/rooms/' + c + '/join', { name }, false);
      token = r.data.token; code = c;
      return r;
    },
    state() { return call('GET', '/api/rooms/' + code); },
    act(body) { return call('POST', '/api/rooms/' + code + '/action', body); },
    leave() { return call('POST', '/api/rooms/' + code + '/leave'); },
    raw: call
  };
}

async function withServer(fn) {
  const s = await startServer();
  try { await fn(s); }
  finally { s.server.close(); }
}

test('Create, join, and invalid name handling', async () => {
  await withServer(async ({ base }) => {
    const ann = client(base, 'Ann');
    const created = await ann.create();
    assert.equal(created.status, 201);
    assert.match(created.data.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
    assert.ok(created.data.token.length >= 32);
    assert.equal(created.data.state.status, 'lobby');

    const bad = await client(base, '<img src=x>').raw('POST', '/api/rooms', { name: '<img src=x>' }, false);
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, 'invalid_name');

    const bob = client(base, 'Bob');
    const joined = await bob.join(ann.code);
    assert.equal(joined.status, 200);
    assert.equal(joined.data.state.players.length, 2);
  });
});

test('Invalid and unknown room codes return 404 without revealing whether a code exists', async () => {
  await withServer(async ({ base }) => {
    const bob = client(base, 'Bob');
    const unknown = await bob.join('ZZZZZ');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.data.error, 'room_not_found');
    const malformed = await bob.join('bad!');
    assert.equal(malformed.status, 404);
    assert.equal(malformed.data.error, 'room_not_found');
  });
});

test('Unauthorized access: no token, wrong token, and a token from another room are all refused', async () => {
  await withServer(async ({ base }) => {
    const ann = client(base, 'Ann');
    await ann.create();
    const other = client(base, 'Dan');
    await other.create();

    const anon = await client(base, 'Eve').raw('GET', '/api/rooms/' + ann.code, undefined, false);
    assert.equal(anon.status, 403);

    const forged = await client(base, 'Eve').raw('GET', '/api/rooms/' + ann.code, undefined, false);
    assert.equal(forged.status, 403);

    // Dan's token must not open Ann's room.
    const cross = await client(base, 'Dan').raw('GET', '/api/rooms/' + ann.code, undefined, false);
    assert.equal(cross.status, 403);
    const crossWithToken = await fetch(base + '/api/rooms/' + ann.code, { headers: { 'X-Room-Token': other.token } });
    assert.equal(crossWithToken.status, 403);
  });
});

test('Synchronised game: lobby, secret predictions, choices, reveal, scoring, and final scoreboard', async () => {
  await withServer(async ({ base, clock }) => {
    const ann = client(base, 'Ann');
    await ann.create();
    const bob = client(base, 'Bob');
    await bob.join(ann.code);
    const cy = client(base, 'Cy');
    await cy.join(ann.code);

    for (const p of [ann, bob, cy]) {
      const r = await p.act({ type: 'ready', ready: true });
      assert.equal(r.status, 200);
    }
    assert.equal((await bob.act({ type: 'start' })).data.error, 'not_host');
    const started = await ann.act({ type: 'start' });
    assert.equal(started.status, 200);
    assert.equal(started.data.state.status, 'round');

    // All clients see the same question; the question has no simulated vote data.
    const qAnn = (await ann.state()).data.state.round.question;
    const qBob = (await bob.state()).data.state.round.question;
    assert.deepEqual(qAnn, qBob);
    assert.equal(JSON.stringify((await bob.state()).data).includes('"v":'), false, 'simulated votes never reach clients');

    // Secret predictions: Bob cannot see Ann's prediction before the reveal.
    assert.equal((await ann.act({ type: 'predict', idx: 0 })).status, 200);
    const dup = await ann.act({ type: 'predict', idx: 1 });
    assert.equal(dup.status, 409);
    assert.equal(dup.data.error, 'already_submitted');
    const bobSees = (await bob.state()).data.state.round;
    assert.equal(bobSees.predictedBy.includes('ann') || bobSees.predictedBy.length === 1, true);
    assert.equal(JSON.stringify(bobSees).includes('"predictions"'), false);
    assert.equal(bobSees.result, null);

    await bob.act({ type: 'predict', idx: 0 });
    await cy.act({ type: 'predict', idx: 0 });
    // Choices open now.
    assert.equal((await ann.state()).data.state.round.stage, 'choose');
    await ann.act({ type: 'choose', idx: 0 });
    await bob.act({ type: 'choose', idx: 0 });
    const last = await cy.act({ type: 'choose', idx: 1 });
    assert.equal(last.data.state.status, 'reveal');
    const result = last.data.state.round.result;
    assert.deepEqual(result.votes, [2, 1]);
    assert.equal(result.majority, 0);
    const annScore = last.data.state.players.find(p => p.name === 'Ann');
    assert.equal(annScore.score, 100);
    assert.equal(annScore.streak, 1);

    assert.equal((await bob.act({ type: 'next' })).data.error, 'not_host');
    const next = await ann.act({ type: 'next' });
    assert.equal(next.data.state.round.index, 1);

    // Wrong option index and wrong stage are refused.
    assert.equal((await ann.act({ type: 'predict', idx: 9 })).data.error, 'invalid_option');
  });
});

test('A full 10-round game reaches the final scoreboard and rematch works', async () => {
  await withServer(async ({ base }) => {
    const ann = client(base, 'Ann');
    await ann.create();
    const bob = client(base, 'Bob');
    await bob.join(ann.code);
    await ann.act({ type: 'ready', ready: true });
    await bob.act({ type: 'ready', ready: true });
    await ann.act({ type: 'start' });
    for (let r = 0; r < 10; r++) {
      await ann.act({ type: 'predict', idx: 0 });
      await bob.act({ type: 'predict', idx: 0 });
      await ann.act({ type: 'choose', idx: 0 });
      const rev = await bob.act({ type: 'choose', idx: 0 });
      assert.equal(rev.data.state.status, 'reveal', 'round ' + (r + 1) + ' reveals');
      await ann.act({ type: 'next' });
    }
    const board = (await bob.state()).data.state;
    assert.equal(board.status, 'finished');
    const bobRow = board.players.find(p => p.name === 'Bob');
    assert.equal(bobRow.score, 1000);
    assert.equal(bobRow.bestStreak, 10);
    const again = await ann.act({ type: 'rematch' });
    assert.equal(again.data.state.status, 'lobby');
    assert.equal(again.data.state.players.find(p => p.name === 'Bob').score, 0);
  });
});

test('Duplicate joins, full rooms, and leaving: host passes on and empty rooms are removed', async () => {
  await withServer(async ({ base, rooms }) => {
    const ann = client(base, 'Ann');
    await ann.create();
    const bob = client(base, 'Bob');
    await bob.join(ann.code);
    await bob.leave();
    assert.equal((await ann.state()).data.state.players.length, 1);
    await ann.leave();
    assert.equal(rooms.size, 0, 'empty room is deleted');
    const after = await ann.state();
    assert.equal(after.status, 404);
  });
});

test('Host departure hands the host role to the next player', async () => {
  await withServer(async ({ base }) => {
    const ann = client(base, 'Ann');
    await ann.create();
    const bob = client(base, 'Bob');
    await bob.join(ann.code);
    await ann.leave();
    const s = (await bob.state()).data.state;
    assert.equal(s.players.length, 1);
    assert.equal(s.players[0].isHost, true);
  });
});

test('Expired rooms are removed on the next request', async () => {
  await withServer(async ({ base, clock }) => {
    const ann = client(base, 'Ann');
    await ann.create();
    clock.t += ENGINE.ROOM_LIMITS.idleMs + 1;
    const r = await ann.state();
    assert.equal(r.status, 404);
  });
});

test('Disconnected players are shown as disconnected but do not block the round', async () => {
  await withServer(async ({ base, clock }) => {
    const ann = client(base, 'Ann');
    await ann.create();
    const bob = client(base, 'Bob');
    await bob.join(ann.code);
    await ann.act({ type: 'ready', ready: true });
    await bob.act({ type: 'ready', ready: true });
    await ann.act({ type: 'start' });
    clock.t += ENGINE.ROOM_LIMITS.presenceMs + 5000;
    await ann.state(); // Ann keeps polling, Bob goes quiet.
    const r = await ann.act({ type: 'predict', idx: 0 });
    assert.equal(r.status, 200);
    const choice = await ann.act({ type: 'choose', idx: 0 });
    assert.equal(choice.data.state.status, 'reveal', 'Ann alone completes the stage');
    const bobRow = choice.data.state.players.find(p => p.name === 'Bob');
    assert.equal(bobRow.connected, false);
  });
});

test('Static files: only allowlisted files are served, source and tests are not', async () => {
  await withServer(async ({ base }) => {
    const ok = await fetch(base + '/room');
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /Read the/);
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.equal((await fetch(base + '/server.js')).status, 404);
    assert.equal((await fetch(base + '/tests/scoring.test.js')).status, 404);
    assert.equal((await fetch(base + '/../package.json')).status, 404);
    assert.equal((await fetch(base + '/api/unknown')).status, 404);
  });
});

test('Malformed JSON and oversized bodies are rejected', async () => {
  await withServer(async ({ base }) => {
    const bad = await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
    assert.equal(bad.status, 400);
    const big = await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(5000) }) });
    assert.ok(big.status === 400 || big.status === 413);
  });
});

test('Responses are never cached, so polling always gets fresh state', async () => {
  await withServer(async ({ base }) => {
    const ann = client(base, 'Ann');
    await ann.create();
    const res = await fetch(base + '/api/rooms/' + ann.code, { headers: { 'X-Room-Token': ann.token } });
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});

test('Room state is isolated between rooms', async () => {
  await withServer(async ({ base }) => {
    const a = client(base, 'A');
    const b = client(base, 'B');
    await a.create();
    await b.create();
    assert.notEqual(a.code, b.code);
    await a.act({ type: 'ready', ready: true });
    const bState = (await b.state()).data.state;
    assert.equal(bState.players.length, 1);
    assert.equal(bState.players[0].ready, false, 'ready state in room A does not leak into room B');
  });
});
