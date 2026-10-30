// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadBank, ROOT } = require('./helpers.js');
const { buildProgress } = require('../progress.js');
const { computeProfile } = require('../scoring.js');
const { DIMENSION_RULES, DIMENSION_MAP } = require('../dimensions.js');
const { assignArchetype, ARCHETYPES } = require('../archetypes.js');

const BANK = loadBank();

// A session of 10 answered questions. Personal and predicted values are chosen explicitly.
function session(at, personalChoices, predicted) {
  const ids = ['EP01', 'EP02', 'EP03', 'EP04', 'EP05', 'EP06', 'EP07', 'EP08', 'EP09', 'EP10'];
  const records = ids.map((id, i) => {
    const q = BANK.find(x => x.id === id);
    const majority = q.v.indexOf(Math.max(...q.v));
    const pred = predicted ? majority : (majority + 1) % q.o.length;
    return { id, cat: q.cat, personalChoice: personalChoices[i], predictedChoice: pred, majority, correct: pred === majority };
  });
  return { at, records };
}

test('No sessions gives an empty progress view', () => {
  const p = buildProgress([], BANK, DIMENSION_MAP, DIMENSION_RULES);
  assert.equal(p.sessions, 0);
  assert.deepEqual(p.unlocks, []);
  assert.deepEqual(p.archetypes, []);
  assert.equal(p.accuracy.value, null);
});

test('Accuracy totals come from all sessions', () => {
  const sessions = [session('a', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], true), session('b', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], false)];
  const p = buildProgress(sessions, BANK, DIMENSION_MAP, DIMENSION_RULES);
  assert.equal(p.accuracy.k, 10);
  assert.equal(p.accuracy.n, 20);
  assert.equal(p.accuracy.value, 0.5);
});

test('A dimension is recorded as a discovery in the session where it first becomes readable', () => {
  // Session 1 has 10 answers and 10 predictions, so social independence and crowd intuition unlock together.
  const sessions = [session('a', [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], true), session('b', [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], true)];
  const p = buildProgress(sessions, BANK, DIMENSION_MAP, DIMENSION_RULES);
  const si = p.unlocks.find(u => u.key === 'socialIndependence');
  assert.equal(si.sessionIndex, 0);
  assert.equal(si.at, 'a');
  assert.equal(p.unlocks.filter(u => u.key === 'socialIndependence').length, 1, 'recorded once');
});

test('Archetypes seen are listed once with the session they first appeared in', () => {
  const sessions = [session('a', [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], true), session('b', [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], true)];
  const p = buildProgress(sessions, BANK, DIMENSION_MAP, DIMENSION_RULES);
  assert.equal(p.archetypes.length, 1);
  assert.equal(p.archetypes[0].sessionIndex, 0);
  assert.ok(ARCHETYPES.some(a => a.name === p.archetypes[0].name));
});

test('Progress agrees with a direct profile computation on the same records', () => {
  const sessions = [session('a', [0, 1, 0, 1, 0, 1, 0, 1, 0, 1], true)];
  const p = buildProgress(sessions, BANK, DIMENSION_MAP, DIMENSION_RULES);
  const direct = assignArchetype(computeProfile(sessions[0].records, BANK, DIMENSION_MAP, DIMENSION_RULES, 'simulated'));
  if (direct.key) assert.equal(p.archetypes[0].name, direct.archetype.name);
  else assert.equal(p.archetypes.length, 0);
});

// Sanity check: all browser scripts load into one shared scope without redeclaration errors.
test('All browser scripts load together without name collisions', () => {
  const files = ['questions.js', 'dimensions.js', 'history.js', 'scoring.js', 'deck.js', 'archetypes.js', 'progress.js', 'analytics.js'];
  const ctx = {};
  vm.createContext(ctx);
  files.forEach(f => {
    assert.doesNotThrow(() => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }), f);
  });
  // Top-level const names are not properties of the context object, so check them inside the sandbox.
  assert.equal(vm.runInContext('typeof buildProgress === "function" && typeof Analytics.track === "function"', ctx), true);
});
