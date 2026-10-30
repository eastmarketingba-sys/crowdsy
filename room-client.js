// Multiplayer client for room.html. The server is the source of truth. This file only renders server state
// and sends actions. All user-provided text is inserted with textContent, never innerHTML.
(function () {
  const POLL_MS = 1500;
  const $ = id => document.getElementById(id);
  const screens = ['entry', 'lobby', 'play', 'reveal', 'finished'];

  let session = null;      // { code, playerId, token }
  let state = null;        // last projection from the server
  let lastKey = '';        // render only when the visible state changes
  let pick = null;         // local selection for the current stage
  let pickKey = '';
  let pollTimer = null;
  let sending = false;
  let finishedTracked = '';

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function storageRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* storage blocked */ }
  }

  function savedSession(code) {
    const raw = storageGet('crowdsy.room.' + code);
    if (!raw) return null;
    try {
      const v = JSON.parse(raw);
      return v && typeof v.playerId === 'string' && typeof v.token === 'string' ? { code, playerId: v.playerId, token: v.token } : null;
    } catch (e) {
      return null;
    }
  }

  function saveSession(s) {
    session = s;
    storageSet('crowdsy.room.' + s.code, JSON.stringify({ playerId: s.playerId, token: s.token }));
    const url = new URL(window.location.href);
    url.searchParams.set('code', s.code);
    window.history.replaceState(null, '', url.pathname + url.search);
  }

  function clearSession() {
    if (session) storageRemove('crowdsy.room.' + session.code);
    session = null;
    state = null;
    lastKey = '';
    stopPolling();
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    window.history.replaceState(null, '', url.pathname);
  }

  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (session) headers['X-Room-Token'] = session.token;
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) {
      const err = new Error(data.message || 'Something went wrong. Try again.');
      err.code = data.error;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function setError(msg) {
    const box = $('error');
    box.textContent = msg || '';
    box.hidden = !msg;
  }

  function setConnection(ok) {
    const box = $('connection');
    box.textContent = ok ? '' : 'Connection lost. Reconnecting…';
    box.hidden = ok;
  }

  function showScreen(name) {
    screens.forEach(s => { $(s).hidden = s !== name; });
    window.scrollTo(0, 0);
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(poll, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function applyState(next) {
    state = next;
    setConnection(true);
    startPolling();
    render();
  }

  async function poll() {
    if (!session || sending) return;
    try {
      const data = await api('GET', '/api/rooms/' + session.code);
      applyState(data.state);
    } catch (err) {
      if (err.status === 403 || err.status === 404) {
        clearSession();
        showScreen('entry');
        setError(err.message);
        return;
      }
      setConnection(false);
    }
  }

  async function act(body) {
    if (!session || sending) return;
    sending = true;
    setError('');
    try {
      const data = await api('POST', '/api/rooms/' + session.code + '/action', body);
      applyState(data.state);
    } catch (err) {
      setError(err.message);
      if (err.status === 403) { clearSession(); showScreen('entry'); }
      else if (err.status === undefined) setConnection(false);
    } finally {
      sending = false;
    }
  }

  async function createRoom(name) {
    setError('');
    try {
      const data = await api('POST', '/api/rooms', { name });
      Analytics.track('room_create');
      saveSession({ code: data.code, playerId: data.playerId, token: data.token });
      applyState(data.state);
    } catch (err) {
      setError(err.message);
    }
  }

  async function joinRoom(code, name) {
    setError('');
    try {
      const data = await api('POST', '/api/rooms/' + code + '/join', { name });
      Analytics.track('room_join');
      saveSession({ code, playerId: data.playerId, token: data.token });
      applyState(data.state);
    } catch (err) {
      setError(err.status === 404 ? 'That room code does not exist or has expired.' : err.message);
    }
  }

  async function leave() {
    if (!session) return;
    try { await api('POST', '/api/rooms/' + session.code + '/leave'); } catch (e) { /* leaving is best effort */ }
    clearSession();
    showScreen('entry');
    setError('');
  }

  async function resume(code) {
    const s = savedSession(code);
    if (!s) return false;
    session = s;
    try {
      const data = await api('GET', '/api/rooms/' + code);
      applyState(data.state);
      return true;
    } catch (err) {
      clearSession();
      if (err.status === 403 || err.status === 404) setError('Your saved seat in that room is no longer available.');
      else setError('Could not reconnect. Check your connection and try again.');
      return false;
    }
  }

  function percents(votes) {
    const total = votes.reduce((a, b) => a + b, 0);
    if (total === 0) return votes.map(() => 0);
    const raw = votes.map(v => (v * 100) / total);
    const floors = raw.map(Math.floor);
    let rest = 100 - floors.reduce((a, b) => a + b, 0);
    const order = raw.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r);
    for (let k = 0; k < order.length && rest > 0; k++, rest--) floors[order[k].i] += 1;
    return floors;
  }

  function renderEntry() {
    showScreen('entry');
    const params = new URLSearchParams(window.location.search);
    const code = (params.get('code') || '').toUpperCase();
    $('joinCode').value = code;
    $('joinNotice').textContent = code ? 'You were invited to room ' + code + '. Enter your name to join.' : '';
  }

  function renderLobby() {
    showScreen('lobby');
    const me = state.me;
    const link = window.location.origin + window.location.pathname + '?code=' + state.code;
    $('lobbyCode').textContent = state.code;
    $('inviteLink').value = link;
    const list = $('players');
    list.textContent = '';
    state.players.forEach(p => {
      const li = el('li', 'player');
      li.append(el('span', 'player-name', p.name + (p.id === me.id ? ' (you)' : '')));
      const tags = el('span', 'tags');
      if (p.isHost) tags.append(el('span', 'tag', 'Host'));
      tags.append(el('span', p.ready ? 'tag on' : 'tag', p.ready ? 'Ready' : 'Not ready'));
      if (!p.connected) tags.append(el('span', 'tag off', 'Disconnected'));
      li.append(tags);
      list.appendChild(li);
    });
    const ready = state.players.filter(p => p.ready).length;
    const enough = state.players.length >= 2;
    const everyone = enough && ready === state.players.length;
    $('readyBtn').textContent = me.ready ? 'Not ready' : 'I am ready';
    $('startBtn').hidden = !me.isHost;
    $('startBtn').disabled = !everyone;
    $('lobbyHint').textContent = !enough
      ? 'Waiting for at least one more player. Share the invite link below.'
      : everyone ? (me.isHost ? 'Everyone is ready. Start when you like.' : 'Waiting for the host to start.')
      : 'Waiting for everyone to press ready (' + ready + ' of ' + state.players.length + ').';
  }

  function renderPlay() {
    showScreen('play');
    const r = state.round;
    const key = r.index + ':' + r.stage;
    if (pickKey !== key) { pick = null; pickKey = key; }
    const predicting = r.stage === 'predict';
    const mineDone = predicting ? r.mine.predicted !== null : r.mine.chose !== null;
    const submittedIds = predicting ? r.predictedBy : r.choseBy;
    const connectedPending = state.players.filter(p => r.participants.includes(p.id) && p.connected && !submittedIds.includes(p.id));

    $('roundLabel').textContent = 'Round ' + (r.index + 1) + ' of ' + state.total;
    $('stageLabel').textContent = predicting ? 'Step 1 · Predict the room' : 'Step 2 · Your choice';
    $('stageHint').textContent = predicting
      ? 'Predict which answer the room will pick most. Nobody sees predictions until the reveal.'
      : 'Now choose for yourself. Your prediction is already locked.';
    $('qText').textContent = r.question.q;

    const opts = $('options');
    opts.textContent = '';
    r.question.o.forEach((label, i) => {
      const b = el('button', 'opt', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(pick === i));
      b.disabled = mineDone;
      b.addEventListener('click', () => { if (!mineDone) { pick = i; render(true); } });
      opts.appendChild(b);
    });

    const lock = $('lockBtn');
    lock.textContent = predicting ? 'Lock prediction' : 'Lock my choice';
    lock.hidden = mineDone;
    lock.disabled = pick === null;
    $('lockedNote').hidden = !mineDone;
    $('lockedNote').textContent = predicting ? 'Prediction locked in. Waiting for others.' : 'Choice locked in. Waiting for others.';
    $('pendingNote').textContent = connectedPending.length
      ? 'Still waiting for: ' + connectedPending.map(p => p.name).join(', ')
      : 'Everyone connected has submitted.';
    $('hostReveal').hidden = !(state.me.isHost && r.stage === 'choose');
    $('hostReveal').disabled = submittedIds.length === 0;
  }

  function renderReveal() {
    showScreen('reveal');
    const result = state.round.result;
    const q = result.question;
    $('revRound').textContent = 'Round ' + (result.index + 1) + ' of ' + state.total;
    $('revQ').textContent = q.q;
    const counts = result.votes;
    const pct = percents(counts);
    const bars = $('revBars');
    bars.textContent = '';
    q.o.forEach((label, i) => {
      const row = el('div', 'row');
      const lbl = el('div', 'lbl');
      lbl.append(el('span', '', label), el('span', 'pct', pct[i] + '% · ' + counts[i] + (counts[i] === 1 ? ' vote' : ' votes')));
      const track = el('div', 'track');
      const fill = el('div', 'fill' + (result.majority === i ? ' maj' : ''));
      fill.style.width = pct[i] + '%';
      track.appendChild(fill);
      row.append(lbl, track);
      bars.appendChild(row);
    });
    $('revMajority').textContent = result.tie
      ? 'Tie or no votes: no majority this round, so nobody scores.'
      : 'Room majority: ' + q.o[result.majority] + '.';
    $('revSource').textContent = 'Real votes from this room. Not population data.';

    const list = $('revPlayers');
    list.textContent = '';
    state.players.forEach(p => {
      if (!(p.id in result.predictions) && !(p.id in result.choices)) return;
      const li = el('li', 'player');
      const top = el('div', 'rev-top');
      top.append(el('span', 'player-name', p.name + (p.id === state.me.id ? ' (you)' : '')));
      const verdict = result.correct[p.id];
      const badge = verdict === true ? 'Predicted it' : verdict === false ? 'Missed' : 'No score';
      top.append(el('span', 'tag ' + (verdict === true ? 'on' : verdict === false ? 'off' : ''), badge));
      const detail = el('p', 'rev-detail');
      const predicted = result.predictions[p.id] !== undefined ? q.o[result.predictions[p.id]] : 'no prediction';
      const chose = result.choices[p.id] !== undefined ? q.o[result.choices[p.id]] : 'no choice';
      detail.textContent = 'Prediction: ' + predicted + ' · Choice: ' + chose + ' · +' + (result.points[p.id] || 0) + ' · streak ' + p.streak;
      li.append(top, detail);
      list.appendChild(li);
    });
    $('nextBtn').hidden = !state.me.isHost;
    $('nextBtn').textContent = state.round.index + 1 >= state.total ? 'See final scoreboard' : 'Next round';
    $('revWait').hidden = state.me.isHost;
  }

  function renderFinished() {
    showScreen('finished');
    if (finishedTracked !== state.code) {
      finishedTracked = state.code;
      Analytics.track('multiplayer_complete', { players: state.players.length });
    }
    const board = $('board');
    board.textContent = '';
    state.players.slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).forEach((p, i) => {
      const li = el('li', 'player board-row');
      li.append(el('span', 'rank', String(i + 1)));
      li.append(el('span', 'player-name', p.name + (p.id === state.me.id ? ' (you)' : '')));
      li.append(el('span', 'score', p.score + ' pts'));
      li.append(el('span', 'streak', 'best streak ' + p.bestStreak));
      board.appendChild(li);
    });
    $('rematchBtn').hidden = !state.me.isHost;
  }

  function render(onlyPick) {
    if (!state) return renderEntry();
    if (onlyPick && state.status === 'round' && state.round) return renderPlay();
    const key = JSON.stringify(state) + '|' + pick;
    if (key === lastKey) return;
    lastKey = key;
    if (state.status === 'lobby') renderLobby();
    else if (state.status === 'round' && state.round) renderPlay();
    else if (state.status === 'reveal' && state.round && state.round.result) renderReveal();
    else if (state.status === 'finished') renderFinished();
    else renderLobby();
  }

  // ---- Wiring ----
  $('createForm').addEventListener('submit', e => {
    e.preventDefault();
    createRoom($('createName').value);
  });
  $('joinForm').addEventListener('submit', e => {
    e.preventDefault();
    joinRoom($('joinCode').value.trim().toUpperCase(), $('joinName').value);
  });
  $('readyBtn').addEventListener('click', () => act({ type: 'ready', ready: !state.me.ready }));
  $('startBtn').addEventListener('click', () => act({ type: 'start' }));
  $('lockBtn').addEventListener('click', () => {
    if (pick === null) return;
    act({ type: state.round.stage === 'predict' ? 'predict' : 'choose', idx: pick });
  });
  $('hostReveal').addEventListener('click', () => act({ type: 'reveal' }));
  $('nextBtn').addEventListener('click', () => act({ type: 'next' }));
  $('rematchBtn').addEventListener('click', () => act({ type: 'rematch' }));
  document.querySelectorAll('.leave').forEach(b => b.addEventListener('click', leave));
  $('copyInvite').addEventListener('click', async () => {
    const box = $('copyMsg');
    try {
      await navigator.clipboard.writeText($('inviteLink').value);
      box.textContent = 'Invite link copied.';
    } catch (e) {
      $('inviteLink').select();
      box.textContent = 'Copy failed. The link is selected so you can copy it manually.';
    }
  });
  document.querySelectorAll('.mode-off').forEach(b => { b.disabled = true; });

  // ---- Boot ----
  (async function boot() {
    Analytics.track('landing_view', { page: 'room' });
    const code = (new URLSearchParams(window.location.search).get('code') || '').toUpperCase();
    if (code && savedSession(code)) {
      const ok = await resume(code);
      if (ok) return;
    }
    renderEntry();
  })();
})();
