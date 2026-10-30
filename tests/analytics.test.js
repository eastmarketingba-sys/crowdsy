// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { ANALYTICS_EVENTS, createAnalytics, cleanProps } = require('../analytics.js');

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), raw: m };
}

test('Only defined events are tracked', () => {
  const a = createAnalytics(null);
  assert.equal(a.track('not_a_real_event'), false);
  assert.equal(a.track('landing_view'), true);
  assert.ok(ANALYTICS_EVENTS.room_create && ANALYTICS_EVENTS.challenge_conversion === undefined);
});

test('Every required event from the brief is defined', () => {
  const required = ['landing_view', 'game_start', 'question_complete', 'session_complete', 'replay', 'share_result',
    'challenge_visit', 'challenge_complete', 'room_create', 'room_join', 'multiplayer_complete', 'returning_session'];
  required.forEach(name => assert.ok(ANALYTICS_EVENTS[name], name));
});

test('Properties are reduced to short primitives', () => {
  const props = cleanProps({ mode: 'daily', name: 'Ann Smith', nested: { a: 1 }, long: 'x'.repeat(100), n: 3, ok: true, a: 1, b: 2, c: 3, d: 4 });
  assert.equal(props.mode, 'daily');
  assert.equal(props.name, 'Ann Smith');
  assert.equal(props.nested, undefined);
  assert.equal(props.long.length, 40);
  assert.equal(Object.keys(props).length <= 5, true);
  assert.deepEqual(cleanProps(null), {});
});

test('Local sink stores events and caps the log at 500', () => {
  const s = memStorage();
  const a = createAnalytics(s);
  for (let i = 0; i < 510; i++) a.track('landing_view');
  const list = JSON.parse(s.raw.get('crowdsy.events'));
  assert.equal(list.length, 500);
  assert.equal(list[0].name, 'landing_view');
});

test('Blocked storage and throwing sinks never break tracking', () => {
  const blocked = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  const a = createAnalytics(blocked);
  assert.equal(a.track('landing_view'), true);
  a.addSink(() => { throw new Error('provider down'); });
  assert.equal(a.track('replay'), true);
});

test('Custom sinks receive events without personal data fields', () => {
  const a = createAnalytics(null);
  const seen = [];
  a.addSink(e => seen.push(e));
  a.track('room_join', { players: 3 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, 'room_join');
  assert.deepEqual(Object.keys(seen[0]).sort(), ['at', 'name', 'props']);
});
