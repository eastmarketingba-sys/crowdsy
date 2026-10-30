// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { ARCHETYPES, assignArchetype, buildResults, sampleLevel } = require('../archetypes.js');
const { loadBank } = require('./helpers.js');

// Builds a profile where every dimension is either ready with a value, or not ready.
function profileWith(values, answers) {
  const ready = (key, value) => value === undefined || value === null
    ? { key, ready: false, value: null, n: 0, k: 0, minN: 10, ci: null }
    : { key, ready: true, value, n: 20, k: Math.round(value * 20), minN: 10, ci: { low: value - 0.1, high: value + 0.1 } };
  return {
    dataSource: 'simulated',
    sample: { answers: answers === undefined ? 20 : answers, predictions: 20 },
    dimensions: [
      ready('socialIndependence', values.si),
      ready('crowdIntuition', values.ci),
      ready('riskOrientation', values.ro),
      ready('decisionConsistency', values.dc),
      { key: 'perspectiveShifting', ready: false, value: null, n: 0, ci: null, reason: 'Not measured yet' }
    ]
  };
}

test('No archetype is assigned without social independence and crowd intuition', () => {
  const a = assignArchetype(profileWith({ si: 0.9, ci: null }));
  assert.equal(a.key, null);
  assert.equal(a.status, 'insufficient');
  assert.match(a.reason, /10 answers/);
});

test('Contrarian Architect: differs often and predicts well', () => {
  assert.equal(assignArchetype(profileWith({ si: 0.7, ci: 0.8 })).key, 'contrarian-architect');
  assert.equal(assignArchetype(profileWith({ si: 0.6, ci: 0.6 })).key, 'contrarian-architect', 'boundary inclusive');
});

test('Independent Thinker: differs often and misreads the crowd', () => {
  assert.equal(assignArchetype(profileWith({ si: 0.8, ci: 0.3 })).key, 'independent-thinker');
});

test('Pattern Hunter needs decision consistency of 0.75 or more', () => {
  assert.equal(assignArchetype(profileWith({ si: 0.5, ci: 0.6, dc: 0.75 })).key, 'pattern-hunter');
  assert.notEqual(assignArchetype(profileWith({ si: 0.5, ci: 0.6, dc: 0.7 })).key, 'pattern-hunter');
  assert.notEqual(assignArchetype(profileWith({ si: 0.5, ci: 0.6, dc: null })).key, 'pattern-hunter', 'missing dc never matches');
});

test('Wildcard needs risk orientation of 0.65 or more and some independence', () => {
  assert.equal(assignArchetype(profileWith({ si: 0.5, ci: 0.4, ro: 0.7 })).key, 'wildcard');
  assert.notEqual(assignArchetype(profileWith({ si: 0.3, ci: 0.4, ro: 0.7 })).key, 'wildcard');
});

test('Cautious Anchor: low risk orientation and steady decisions', () => {
  assert.equal(assignArchetype(profileWith({ si: 0.5, ci: 0.4, ro: 0.2, dc: 0.6 })).key, 'cautious-anchor');
});

test('Consensus Seeker: follows the crowd and reads it well', () => {
  assert.equal(assignArchetype(profileWith({ si: 0.2, ci: 0.7 })).key, 'consensus-seeker');
});

test('Social Cartographer: very accurate with a mixed independence score', () => {
  assert.equal(assignArchetype(profileWith({ si: 0.5, ci: 0.75 })).key, 'social-cartographer');
});

test('Quiet Strategist: follows the crowd with a moderate read', () => {
  assert.equal(assignArchetype(profileWith({ si: 0.2, ci: 0.55 })).key, 'quiet-strategist');
});

test('Adaptive Mind is the fallback for the middle of the field', () => {
  assert.equal(assignArchetype(profileWith({ si: 0.5, ci: 0.5 })).key, 'adaptive-mind');
});

test('Every archetype has a rule, a sentence, a blind spot and a question', () => {
  assert.equal(ARCHETYPES.length, 9);
  for (const a of ARCHETYPES) {
    assert.ok(a.rule && a.sentence && a.blindSpot && a.question, a.key);
    assert.ok(!/diagnos|disorder|clinical/i.test(a.sentence + a.blindSpot), `${a.key} uses clinical wording`);
  }
});

test('Rules are checked in order, so each profile maps to exactly one archetype', () => {
  // A profile that matches several tests must return the first matching archetype.
  const a = assignArchetype(profileWith({ si: 0.7, ci: 0.8, dc: 0.9, ro: 0.9 }));
  assert.equal(a.key, 'contrarian-architect');
});

test('Sample level thresholds', () => {
  assert.equal(sampleLevel(10), 'low');
  assert.equal(sampleLevel(20), 'medium');
  assert.equal(sampleLevel(40), 'high');
});

test('Results: contradiction only when both independence and intuition are high', () => {
  const bank = loadBank();
  const profile = profileWith({ si: 0.7, ci: 0.8 });
  const r = buildResults(profile, [], bank, null, assignArchetype(profile));
  assert.match(r.contradiction, /differently from the simulated crowd/);
  const none = profileWith({ si: 0.5, ci: 0.5 });
  assert.equal(buildResults(none, [], bank, null, assignArchetype(none)).contradiction, null);
});

test('Results: strongest pattern uses the dimension furthest from 0.5 and shows the counts', () => {
  const bank = loadBank();
  const profile = profileWith({ si: 0.9, ci: 0.55 });
  const r = buildResults(profile, [], bank, null, assignArchetype(profile));
  assert.equal(r.strongest.key, 'socialIndependence');
  assert.match(r.strongest.text, /In 18 of 20 answers/);
});

test('Results: no strong pattern when every ready value is near 0.5', () => {
  const bank = loadBank();
  const profile = profileWith({ si: 0.5, ci: 0.55 });
  assert.equal(buildResults(profile, [], bank, null, assignArchetype(profile)).strongest, null);
});

test('Results: examples come from the real bank and state the simulated majority', () => {
  const bank = loadBank();
  const profile = profileWith({ si: 0.7, ci: 0.8 });
  const records = [{ id: 'EP01', personalChoice: 1, majority: 0, correct: false }];
  const r = buildResults(profile, records, bank, null, assignArchetype(profile));
  assert.equal(r.examples.length, 1);
  assert.equal(r.examples[0].chose, 'Movies');
  assert.equal(r.examples[0].majority, 'Music');
  assert.equal(r.examples[0].majorityPct, 72);
  assert.equal(r.examples[0].differs, true);
});

test('Results: a low sample is labelled as an early read', () => {
  const bank = loadBank();
  const profile = profileWith({ si: 0.7, ci: 0.8 }, 10);
  const r = buildResults(profile, [], bank, null, assignArchetype(profile));
  assert.equal(r.sample.level, 'low');
  assert.match(r.sample.note, /Early read/);
});
