// Crowdsy multiplayer server. Zero dependencies (Node 18+). Rooms live in memory and are lost on restart.
// Run: node server.js   (optional: PORT=8080)
// The server is the only source of truth for room state, votes and scores.
// Player tokens are sent in the X-Room-Token header, never in URLs.
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const ENGINE = require('./room-engine.js');
const { buildDeck } = require('./deck.js');

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = new RegExp('^[' + CODE_CHARS + ']{5}$');
const STATIC_FILES = new Set([
  'room.html', 'mind-of-the-crowd.html', 'questions.js', 'dimensions.js', 'history.js',
  'scoring.js', 'deck.js', 'archetypes.js', 'progress.js', 'analytics.js', 'room-client.js', 'room-engine.js'
]);
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const BODY_LIMIT = 2048;

function loadBank(rootDir) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(rootDir, 'questions.js'), 'utf8') + '\n;this.QUESTION_BANK = QUESTION_BANK;', ctx);
  return ctx.QUESTION_BANK;
}

function randomCode() {
  let code = '';
  for (const b of crypto.randomBytes(5)) code += CODE_CHARS[b % CODE_CHARS.length];
  return code;
}

function randomToken() {
  return crypto.randomBytes(16).toString('hex');
}

function createServer(options) {
  const opts = Object.assign({ rootDir: __dirname, now: () => Date.now(), random: Math.random }, options || {});
  const bank = opts.bank || loadBank(opts.rootDir);
  const rooms = new Map();

  function send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }
  function fail(res, status, error, message) {
    send(res, status, { error, message });
  }

  function sweep() {
    const t = opts.now();
    for (const [code, room] of rooms) {
      if (ENGINE.isExpired(room, t)) rooms.delete(code);
    }
  }

  function getRoom(code) {
    sweep();
    if (typeof code !== 'string' || !CODE_RE.test(code.toUpperCase())) return null;
    return rooms.get(code.toUpperCase()) || null;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      let tooBig = false;
      const chunks = [];
      req.on('data', c => {
        size += c.length;
        // Keep reading so the client receives the 413 response instead of a reset connection.
        if (size > BODY_LIMIT) {
          if (!tooBig) { tooBig = true; reject(Object.assign(new Error('too large'), { status: 413 })); }
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (chunks.length === 0) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(Object.assign(new Error('bad json'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }

  function newDeck() {
    return buildDeck(bank, opts.random, ENGINE.ROOM_LIMITS.rounds);
  }

  function auth(room, req) {
    const token = req.headers['x-room-token'];
    return ENGINE.findByToken(room, token);
  }

  function stateFor(room, playerId) {
    ENGINE.evaluateStage(room, opts.now());
    return ENGINE.project(room, playerId, opts.now());
  }

  function applyResult(res, room, result, playerId) {
    if (!result.ok) {
      const status = result.error === 'not_host' || result.error === 'not_participant' || result.error === 'not_in_room' ? 403 : 409;
      return fail(res, status, result.error, result.message);
    }
    return send(res, 200, { state: stateFor(room, playerId) });
  }

  async function handleApi(req, res, pathname) {
    const parts = pathname.split('/').filter(Boolean); // ['api', 'rooms', ...]
    const now = opts.now();

    if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true });

    if (req.method === 'POST' && pathname === '/api/rooms') {
      const body = await readBody(req);
      const name = ENGINE.normaliseName(body.name);
      if (!name) return fail(res, 400, 'invalid_name', 'Use 1 to 20 letters, numbers, spaces, apostrophes or hyphens.');
      let code = randomCode();
      for (let i = 0; i < 20 && rooms.has(code); i++) code = randomCode();
      if (rooms.has(code)) return fail(res, 503, 'busy', 'Could not create a room right now. Try again.');
      const id = randomToken().slice(0, 12);
      const token = randomToken();
      const room = ENGINE.createRoom({ code, id, token, name, now, deck: newDeck() });
      rooms.set(code, room);
      return send(res, 201, { code, playerId: id, token, state: stateFor(room, id) });
    }

    if (parts[0] !== 'api' || parts[1] !== 'rooms' || !parts[2]) return fail(res, 404, 'not_found', 'Not found.');
    const room = getRoom(parts[2]);
    if (!room) return fail(res, 404, 'room_not_found', 'That room does not exist or has expired.');

    if (req.method === 'POST' && parts[3] === 'join' && parts.length === 4) {
      const body = await readBody(req);
      const name = ENGINE.normaliseName(body.name);
      if (!name) return fail(res, 400, 'invalid_name', 'Use 1 to 20 letters, numbers, spaces, apostrophes or hyphens.');
      const id = randomToken().slice(0, 12);
      const token = randomToken();
      const result = ENGINE.joinRoom(room, { id, token, name, now });
      if (!result.ok) return fail(res, 409, result.error, result.message);
      return send(res, 200, { playerId: id, token, state: stateFor(room, id) });
    }

    if (req.method === 'GET' && parts.length === 3) {
      const me = auth(room, req);
      if (!me) return fail(res, 403, 'unauthorized', 'Your session for this room is not valid. Join again.');
      ENGINE.touch(room, me.id, now);
      return send(res, 200, { state: stateFor(room, me.id) });
    }

    if (req.method === 'POST' && parts[3] === 'action' && parts.length === 4) {
      const me = auth(room, req);
      if (!me) return fail(res, 403, 'unauthorized', 'Your session for this room is not valid. Join again.');
      const body = await readBody(req);
      ENGINE.touch(room, me.id, now);
      switch (body.type) {
        case 'ready': return applyResult(res, room, ENGINE.setReady(room, me.id, body.ready === true), me.id);
        case 'start': return applyResult(res, room, ENGINE.startGame(room, me.id, now), me.id);
        case 'predict': return applyResult(res, room, ENGINE.submit(room, me.id, 'predict', body.idx, now), me.id);
        case 'choose': return applyResult(res, room, ENGINE.submit(room, me.id, 'choose', body.idx, now), me.id);
        case 'reveal': return applyResult(res, room, ENGINE.hostReveal(room, me.id, now), me.id);
        case 'next': return applyResult(res, room, ENGINE.nextRound(room, me.id, now), me.id);
        case 'rematch': return applyResult(res, room, ENGINE.rematch(room, me.id, newDeck(), now), me.id);
        default: return fail(res, 400, 'invalid_type', 'Unknown action.');
      }
    }

    if (req.method === 'POST' && parts[3] === 'leave' && parts.length === 4) {
      const me = auth(room, req);
      if (!me) return fail(res, 403, 'unauthorized', 'Your session for this room is not valid. Join again.');
      const result = ENGINE.leaveRoom(room, me.id, now);
      if (result.empty) rooms.delete(room.code);
      return send(res, 200, { ok: true });
    }

    return fail(res, 404, 'not_found', 'Not found.');
  }

  function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'mind-of-the-crowd.html' : pathname === '/room' ? 'room.html' : pathname.slice(1);
    if (!STATIC_FILES.has(rel)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const full = path.join(opts.rootDir, rel);
    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(rel)] || 'application/octet-stream' });
      res.end(data);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url.pathname);
      } else if (req.method === 'GET') {
        serveStatic(req, res, url.pathname);
      } else {
        fail(res, 405, 'method_not_allowed', 'Method not allowed.');
      }
    } catch (err) {
      if (err && err.status) return fail(res, err.status, 'bad_request', err.status === 413 ? 'Request too large.' : 'Invalid request.');
      fail(res, 500, 'server_error', 'Something went wrong on the server. Try again.');
    }
  });

  return { server, rooms, sweep };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || '127.0.0.1'; // set HOST=0.0.0.0 to accept friends on your network
  const { server } = createServer();
  server.listen(port, host, () => {
    process.stdout.write(`Crowdsy running at http://localhost:${port}\n`);
  });
}

module.exports = { createServer, CODE_RE, STATIC_FILES };
