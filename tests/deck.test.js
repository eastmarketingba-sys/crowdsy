// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { mulberry32, hashSeed, buildDeck, seededDeck, dailySeed, deckFromIds, encodeDeck, DECK_POOL } = require('../deck.js');
const { loadBank } = require('./helpers.js');

const BANK = loadBank();

test('Seeded decks are reproducible for the same seed and differ across seeds', () => {
  const a = encodeDeck(seededDeck(BANK, 'crowdsy-daily-2026-10-29', DECK_POOL));
  const b = encodeDeck(seededDeck(BANK, 'crowdsy-daily-2026-10-29', DECK_POOL));
  const c = encodeDeck(seededDeck(BANK, 'crowdsy-daily-2026-10-30', DECK_POOL));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('Daily seed is the same for everyone on the same date', () => {
  assert.equal(dailySeed('2026-10-29'), 'crowdsy-daily-2026-10-29');
});

test('mulberry32 is deterministic and within [0, 1)', () => {
  const r1 = mulberry32(42);
  const r2 = mulberry32(42);
  for (let i = 0; i < 50; i++) {
    const v = r1();
    assert.equal(v, r2());
    assert.ok(v >= 0 && v < 1);
  }
  assert.equal(typeof hashSeed('abc'), 'number');
});

test('Decks have no repeats, at most 2 per category, and no back-to-back category', () => {
  for (let s = 0; s < 1000; s++) {
    const d = buildDeck(BANK, Math.random, DECK_POOL);
    assert.equal(d.length, DECK_POOL);
    assert.equal(new Set(d.map(q => q.id)).size, d.length);
    const counts = {};
    d.forEach(q => { counts[q.cat] = (counts[q.cat] || 0) + 1; });
    assert.ok(Object.values(counts).every(c => c <= 2), 'category cap');
    for (let i = 1; i < d.length; i++) assert.notEqual(d[i].cat, d[i - 1].cat);
  }
});

test('deckFromIds rebuilds the same deck and round-trips with encodeDeck', () => {
  const deck = seededDeck(BANK, 'roundtrip', DECK_POOL);
  const res = deckFromIds(BANK, encodeDeck(deck).split(','));
  assert.equal(res.ok, true);
  assert.equal(encodeDeck(res.deck), encodeDeck(deck));
});

test('deckFromIds rejects unknown, duplicate, empty and oversized input', () => {
  assert.equal(deckFromIds(BANK, ['NOPE01']).ok, false);
  assert.equal(deckFromIds(BANK, ['EP01', 'EP01']).ok, false);
  assert.equal(deckFromIds(BANK, []).ok, false);
  assert.equal(deckFromIds(BANK, 'EP01').ok, false);
  assert.equal(deckFromIds(BANK, BANK.slice(0, DECK_POOL + 1).map(q => q.id)).ok, false);
  assert.equal(deckFromIds(BANK, [42]).ok, false);
});
