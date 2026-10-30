// Lightweight analytics abstraction. Events are defined here, and sinks receive them.
// Default sink: development instrumentation in this browser only (localStorage, capped at 500 events).
// To connect a provider later, call Analytics.addSink(fn) with a function that forwards the event.
// Events never include names, answers, room codes or tokens. Properties are short primitives only.
const ANALYTICS_EVENTS = {
  landing_view: 'Landing page visited',
  game_start: 'Solo game started (mode: solo, daily or challenge)',
  question_complete: 'A question was completed (answered or skipped)',
  session_complete: 'A solo session reached its final score',
  replay: 'Play again was pressed on the final screen',
  share_result: 'A result share was attempted (method: native, clipboard or failed)',
  challenge_visit: 'A challenge link with a deck was opened',
  challenge_complete: 'A challenge visitor completed a session',
  returning_session: 'A player with saved history started a new session',
  room_create: 'A multiplayer room was created',
  room_join: 'A player joined a multiplayer room',
  multiplayer_complete: 'A multiplayer game reached its final scoreboard'
};

const ANALYTICS_STORAGE_KEY = 'crowdsy.events';
const ANALYTICS_LOCAL_CAP = 500;

function cleanProps(props) {
  const out = {};
  if (!props || typeof props !== 'object') return out;
  Object.keys(props).slice(0, 5).forEach(k => {
    const v = props[k];
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 40);
  });
  return out;
}

function localSink(storage) {
  return evt => {
    if (!storage) return;
    try {
      const raw = storage.getItem(ANALYTICS_STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      list.push(evt);
      storage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(list.slice(-ANALYTICS_LOCAL_CAP)));
    } catch (e) {
      // Analytics must never break the game.
    }
  };
}

function createAnalytics(storage) {
  const sinks = [localSink(storage)];
  return {
    track(name, props) {
      if (!ANALYTICS_EVENTS[name]) return false;
      const evt = { name, at: new Date().toISOString(), props: cleanProps(props) };
      sinks.forEach(s => { try { s(evt); } catch (e) { /* ignore sink errors */ } });
      return true;
    },
    addSink(fn) {
      if (typeof fn === 'function') sinks.push(fn);
    }
  };
}

const Analytics = createAnalytics(typeof window !== 'undefined' ? safeStorage() : null);

function safeStorage() {
  try { return window.localStorage; } catch (e) { return null; }
}

if (typeof module !== 'undefined') module.exports = { ANALYTICS_EVENTS, createAnalytics, cleanProps };
