// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { wilsonInterval, computeProfile } = require('../scoring.js');
const { DIMENSION_RULES, DIMENSION_MAP } = require('../dimensions.js');

// Load the real question bank without modifying questions.js.
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'questions.js'), 'utf8') + '\n;this.QUESTION_BANK = QUESTION_BANK;', ctx);
const BANK = ctx.QUESTION_BANK;

// Minimal bank for records-only tests: each ID must exist, nothing else matters to the engine.
const FAKE_BANK = ['MA03', 'MA04', 'HS09', 'RD01', 'RD04', 'RD05', 'RD11', 'RD13', 'RD15',
  'MD01', 'MD02', 'MD03', 'MD12', 'RF04', 'RF05', 'EP01', 'EP02', 'EP03', 'EP04', 'EP05', 'EP06', 'EP07', 'EP08', 'EP09', 'EP10']
  .map(id => ({ id }));

// Helper: a record in the V1.1 shape. personal and predicted are option indexes.
function rec(id, personal, majority, predicted) {
  const pred = predicted === undefined ? personal : predicted;
  return { id, cat: 'x', personalChoice: personal, predictedChoice: pred, majority, correct: pred === majority };
}

test('Wilson interval matches the known value for 8 of 10', () => {
  const ci = wilsonInterval(8, 10);
  assert.ok(Math.abs(ci.low - 0.4902) < 0.001, `low ${ci.low}`);
  assert.ok(Math.abs(ci.high - 0.9432) < 0.001, `high ${ci.high}`);
});

test('Social independence: 3 of 10 personal choices differ from the majority', () => {
  const records = [];
  for (let i = 0; i < 10; i++) {
    const majority = 0;
    const personal = i < 3 ? 1 : 0;
    records.push(rec('EP0' + ((i % 9) + 1), personal, majority));
  }
  const p = computeProfile(records, FAKE_BANK, DIMENSION_MAP, DIMENSION_RULES);
  const d = p.dimensions.find(x => x.key === 'socialIndependence');
  assert.equal(d.ready, true);
  assert.equal(d.k, 3);
  assert.equal(d.n, 10);
  assert.equal(d.value, 0.3);
});

test('Social independence: 9 answers is below the minimum and shows no score', () => {
  const records = [];
  for (let i = 0; i < 9; i++) records.push(rec('EP01', 1, 0));
  const d = computeProfile(records, FAKE_BANK, DIMENSION_MAP, DIMENSION_RULES).dimensions[0];
  assert.equal(d.ready, false);
  assert.equal(d.value, null);
  assert.equal(d.ci, null);
});

test('Crowd intuition: 7 correct predictions of 10 gives 0.7', () => {
  const records = [];
  for (let i = 0; i < 10; i++) {
    records.push(rec('EP01', 0, 0, i < 7 ? 0 : 1));
  }
  const d = computeProfile(records, FAKE_BANK, DIMENSION_MAP, DIMENSION_RULES).dimensions[1];
  assert.equal(d.key, 'crowdIntuition');
  assert.equal(d.ready, true);
  assert.equal(d.k, 7);
  assert.equal(d.value, 0.7);
});

test('Personal choices and predictions are kept separate', () => {
  // The personal choice matches the majority, but the prediction does not.
  const records = [rec('EP01', 0, 0, 1)];
  const p = computeProfile(records, FAKE_BANK, DIMENSION_MAP, { ...DIMENSION_RULES, socialIndependence: { minN: 1 }, crowdIntuition: { minN: 1 } });
  const si = p.dimensions.find(d => d.key === 'socialIndependence');
  const ci = p.dimensions.find(d => d.key === 'crowdIntuition');
  assert.equal(si.k, 0, 'personal choice matches majority, so no difference');
  assert.equal(ci.k, 0, 'prediction was wrong, so no hit');
});

test('Risk orientation: 4 risky picks of 5 mapped questions gives 0.8', () => {
  const records = [
    rec('MA03', 1, 0), // risky: one huge payout
    rec('MA04', 1, 0), // risky: quit immediately
    rec('HS09', 0, 0), // safe: sure €200
    rec('RD01', 1, 0), // risky: 50/50 shot
    rec('RD04', 0, 0)  // risky: move with no job
  ];
  const d = computeProfile(records, FAKE_BANK, DIMENSION_MAP, DIMENSION_RULES).dimensions.find(x => x.key === 'riskOrientation');
  assert.equal(d.n, 5);
  assert.equal(d.k, 4);
  assert.equal(d.value, 0.8);
});

test('Risk orientation ignores questions that are not mapped to risk', () => {
  const records = [
    rec('MA03', 1, 0), rec('MA04', 1, 0), rec('HS09', 1, 0), rec('RD01', 1, 0),
    rec('EP01', 0, 0), rec('EP02', 0, 0), rec('EP03', 0, 0), rec('EP04', 0, 0), rec('EP05', 0, 0)
  ];
  const d = computeProfile(records, FAKE_BANK, DIMENSION_MAP, DIMENSION_RULES).dimensions.find(x => x.key === 'riskOrientation');
  assert.equal(d.n, 4, 'only the four risk-mapped answers count');
  assert.equal(d.ready, false, 'four is below the minimum of five');
});

test('Decision consistency: two consistent groups and one inconsistent gives 2/3', () => {
  const records = [
    // security: both on the security pole (option 0)
    rec('MA03', 0, 0), rec('HS09', 0, 0),
    // honesty: both off the honest pole (option 0 for MD01 is the white lie)
    rec('MD01', 0, 0), rec('RF04', 1, 0),
    // loyalty: MD02 on pole (1), MD03 off pole (1 is not the loyalty side)
    rec('MD02', 1, 0), rec('MD03', 1, 0)
  ];
  const d = computeProfile(records, FAKE_BANK, DIMENSION_MAP, DIMENSION_RULES).dimensions.find(x => x.key === 'decisionConsistency');
  assert.equal(d.n, 3);
  assert.equal(d.k, 2);
  assert.ok(Math.abs(d.value - 2 / 3) < 1e-9);
  assert.deepEqual(d.groups.map(g => g.consistent), [true, true, false]);
});

test('Decision consistency needs at least two eligible groups', () => {
  const records = [rec('MA03', 0, 0), rec('HS09', 0, 0)];
  const d = computeProfile(records, FAKE_BANK, DIMENSION_MAP, DIMENSION_RULES).dimensions.find(x => x.key === 'decisionConsistency');
  assert.equal(d.n, 1);
  assert.equal(d.ready, false);
});

test('Perspective shifting is never scored in this version', () => {
  const d = computeProfile([rec('EP01', 0, 0)], FAKE_BANK, DIMENSION_MAP, DIMENSION_RULES).dimensions.find(x => x.key === 'perspectiveShifting');
  assert.equal(d.ready, false);
  assert.equal(d.value, null);
  assert.match(d.reason, /Not measured/);
});

test('Unknown question IDs are ignored', () => {
  const records = [rec('ZZ99', 1, 0), rec('EP01', 1, 0)];
  const p = computeProfile(records, FAKE_BANK, DIMENSION_MAP, { ...DIMENSION_RULES, socialIndependence: { minN: 1 } });
  assert.equal(p.sample.answers, 1);
});

test('Every mapped question exists in the real bank with a valid option index', () => {
  const byId = new Map(BANK.map(q => [q.id, q]));
  for (const [id, idx] of Object.entries(DIMENSION_MAP.risk)) {
    assert.ok(byId.has(id), `risk ${id} missing from bank`);
    assert.ok(idx >= 0 && idx < byId.get(id).o.length, `risk ${id} index out of range`);
  }
  for (const [group, members] of Object.entries(DIMENSION_MAP.consistency)) {
    for (const [id, pole] of Object.entries(members)) {
      assert.ok(byId.has(id), `${group}: ${id} missing from bank`);
      const q = byId.get(id);
      assert.equal(q.o.length, 2, `${group}: ${id} must be binary`);
      assert.ok(pole === 0 || pole === 1, `${group}: ${id} pole must be 0 or 1`);
    }
  }
});

test('The real bank shows no ties, and simulated votes sum to 100', () => {
  for (const q of BANK) {
    const max = Math.max(...q.v);
    assert.equal(q.v.filter(x => x === max).length, 1, `${q.id} has a tie`);
    assert.equal(q.v.reduce((a, b) => a + b, 0), 100, `${q.id} does not sum to 100`);
  }
});
