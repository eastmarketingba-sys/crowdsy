// Deck construction. Pure functions: the random source is a parameter, so decks can be seeded, shared and tested.
const DECK_ROUND = 10;
const DECK_POOL = 12; // 10 answered plus up to 2 skips
const DECK_MAX_PER_CATEGORY = 2;

// Small seeded PRNG (mulberry32). Same seed gives the same sequence.
function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a string hash, used to turn a seed string into a number.
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffleWith(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// At most 2 questions per category, no same category back to back, and no same dimension back to back where possible.
function buildDeck(bank, rng, poolSize) {
  const random = rng || Math.random;
  const size = poolSize || DECK_POOL;
  const pool = shuffleWith(bank, random);
  const picked = [];
  const perCat = {};
  while (picked.length < size && pool.length) {
    const last = picked[picked.length - 1];
    const fits = q => (perCat[q.cat] || 0) < DECK_MAX_PER_CATEGORY && (!last || last.cat !== q.cat);
    let i = pool.findIndex(q => fits(q) && (!last || last.dim !== q.dim));
    if (i < 0) i = pool.findIndex(fits);
    if (i < 0) i = 0;
    const q = pool.splice(i, 1)[0];
    picked.push(q);
    perCat[q.cat] = (perCat[q.cat] || 0) + 1;
  }
  return picked;
}

function seededDeck(bank, seed, poolSize) {
  return buildDeck(bank, mulberry32(hashSeed(seed)), poolSize);
}

function dailySeed(dateStr) {
  return 'crowdsy-daily-' + dateStr;
}

// Rebuilds a deck from question IDs (used by challenge links). IDs are validated against the bank.
function deckFromIds(bank, ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > DECK_POOL) return { ok: false, error: 'invalid_deck' };
  const byId = new Map(bank.map(q => [q.id, q]));
  const seen = new Set();
  const deck = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !byId.has(id) || seen.has(id)) return { ok: false, error: 'invalid_deck' };
    seen.add(id);
    deck.push(byId.get(id));
  }
  return { ok: true, deck };
}

function encodeDeck(deck) {
  return deck.map(q => q.id).join(',');
}

if (typeof module !== 'undefined') module.exports = { DECK_ROUND, DECK_POOL, DECK_MAX_PER_CATEGORY, mulberry32, hashSeed, buildDeck, seededDeck, dailySeed, deckFromIds, encodeDeck };
