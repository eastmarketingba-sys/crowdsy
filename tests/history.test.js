// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateStore, loadSessions, saveSession, clearSessions, allRecords, HISTORY_KEY } = require('../history.js');

// Fake storage with the same methods as window.localStorage.
function fakeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    raw: m
  };
}

const sample = [{ id: 'EP01', cat: 'Everyday preferences', personalChoice: 0, predictedChoice: 1, majority: 0, correct: false }];

test('Empty or missing storage migrates to no sessions', () => {
  assert.deepEqual(migrateStore(null), []);
  assert.deepEqual(migrateStore(undefined), []);
  assert.deepEqual(migrateStore(''), []);
});

test('Corrupt JSON is treated as empty instead of throwing', () => {
  assert.deepEqual(migrateStore('{not json'), []);
});

test('A legacy array of records is wrapped as one session', () => {
  const sessions = migrateStore(JSON.stringify(sample));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].at, null);
  assert.equal(sessions[0].records.length, 1);
});

test('Schema 2 data loads and drops malformed records', () => {
  const raw = JSON.stringify({ schema: 2, sessions: [{ at: '2026-10-29T10:00:00Z', records: [sample[0], { nope: true }] }, { bad: true }] });
  const sessions = migrateStore(raw);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].records.length, 1);
  assert.equal(sessions[0].at, '2026-10-29T10:00:00Z');
});

test('Save then load round-trips and appends sessions', () => {
  const s = fakeStorage();
  assert.equal(saveSession(s, sample, '2026-10-29T10:00:00Z'), true);
  assert.equal(saveSession(s, sample, '2026-10-29T11:00:00Z'), true);
  const sessions = loadSessions(s);
  assert.equal(sessions.length, 2);
  assert.equal(allRecords(sessions).length, 2);
  assert.equal(JSON.parse(s.raw.get(HISTORY_KEY)).schema, 2);
});

test('Saving does not mutate the caller records', () => {
  const s = fakeStorage();
  const records = [{ ...sample[0] }];
  saveSession(s, records, null);
  assert.deepEqual(records[0], sample[0]);
});

test('Clear removes all saved sessions', () => {
  const s = fakeStorage();
  saveSession(s, sample, null);
  assert.equal(clearSessions(s), true);
  assert.deepEqual(loadSessions(s), []);
});

test('Blocked storage fails quietly', () => {
  const blocked = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); }
  };
  assert.deepEqual(loadSessions(blocked), []);
  assert.equal(saveSession(blocked, sample, null), false);
  assert.equal(clearSessions(blocked), false);
  assert.deepEqual(loadSessions(null), []);
  assert.equal(saveSession(null, sample, null), false);
});
