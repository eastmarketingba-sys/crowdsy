// Per-viewer session history in localStorage. Pure helpers take the storage object as a parameter,
// so they can be tested without a browser. Every storage call is guarded: private windows and blocked storage fail quietly.
//
// Schema 2: { schema: 2, sessions: [{ at, records: [...] }] }
// Legacy: a bare array of records (no version existed for it) is wrapped as one session.
// Records keep the V1.1 shape: { id, cat, personalChoice, predictedChoice, majority, correct }.

const HISTORY_KEY = 'motc.history';
const HISTORY_SCHEMA = 2;
const HISTORY_MAX_SESSIONS = 50;

function isRecord(r) {
  return !!r && typeof r.id === 'string';
}

function migrateStore(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch (e) { return []; }
  }
  if (Array.isArray(data)) {
    const records = data.filter(isRecord);
    return records.length ? [{ at: null, records }] : [];
  }
  if (data && data.schema === HISTORY_SCHEMA && Array.isArray(data.sessions)) {
    return data.sessions
      .filter(s => s && Array.isArray(s.records))
      .map(s => Object.assign({}, s, { at: typeof s.at === 'string' ? s.at : null, records: s.records.filter(isRecord) }));
  }
  return [];
}

function loadSessions(storage) {
  if (!storage) return [];
  try { return migrateStore(storage.getItem(HISTORY_KEY)); } catch (e) { return []; }
}

// meta is optional: { mode, date, summary }. Sessions saved before V2.0 have no meta and stay valid.
function saveSession(storage, records, at, meta) {
  if (!storage) return false;
  const sessions = loadSessions(storage);
  const session = Object.assign({}, meta || {}, { at: at || null, records: records.map(r => Object.assign({}, r)) });
  sessions.push(session);
  const trimmed = sessions.slice(-HISTORY_MAX_SESSIONS);
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify({ schema: HISTORY_SCHEMA, sessions: trimmed }));
    return true;
  } catch (e) {
    return false;
  }
}

function clearSessions(storage) {
  if (!storage) return false;
  try { storage.removeItem(HISTORY_KEY); return true; } catch (e) { return false; }
}

function allRecords(sessions) {
  return sessions.reduce((acc, s) => acc.concat(s.records), []);
}

if (typeof module !== 'undefined') module.exports = { migrateStore, loadSessions, saveSession, clearSessions, allRecords, HISTORY_KEY, HISTORY_SCHEMA };
