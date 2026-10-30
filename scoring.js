// Pure scoring engine for the behavioral profile. No DOM access.
// Inputs: records (from one or more sessions), the question bank, DIMENSION_MAP and DIMENSION_RULES.
//
// Formulas
//   socialIndependence  = answers where personalChoice !== crowd majority / answers with a personal choice
//   crowdIntuition      = correct predictions / predictions made
//   riskOrientation     = risk-mapped answers where personalChoice === riskier option / risk-mapped answers
//   decisionConsistency = consistent groups / groups with >= minPerGroup answers
//                         a group is consistent when every answer in it is on the pole side, or every answer is off it
//   perspectiveShifting = not measured yet (no group-level prompts exist)
// Every ratio carries a 95% Wilson interval. A score is shown only when its minimum sample is met.

function wilsonInterval(k, n, z) {
  const zz = z || 1.96;
  if (n === 0) return { low: 0, high: 0 };
  const p = k / n;
  const z2 = zz * zz;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (zz * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

function hasKey(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function ratioResult(key, k, n, minN, extra) {
  const ready = n >= minN && n > 0;
  return Object.assign({
    key,
    k,
    n,
    minN,
    ready,
    value: ready ? k / n : null,
    ci: ready ? wilsonInterval(k, n) : null
  }, extra || {});
}

function scoreSocialIndependence(records, rules) {
  const rows = records.filter(r => Number.isInteger(r.personalChoice) && Number.isInteger(r.majority));
  const differs = rows.filter(r => r.personalChoice !== r.majority).length;
  return ratioResult('socialIndependence', differs, rows.length, rules.socialIndependence.minN);
}

function scoreCrowdIntuition(records, rules) {
  const rows = records.filter(r => typeof r.correct === 'boolean');
  const hits = rows.filter(r => r.correct).length;
  return ratioResult('crowdIntuition', hits, rows.length, rules.crowdIntuition.minN);
}

function scoreRiskOrientation(records, map, rules) {
  const rows = records.filter(r => Number.isInteger(r.personalChoice) && hasKey(map.risk, r.id));
  const risky = rows.filter(r => r.personalChoice === map.risk[r.id]).length;
  return ratioResult('riskOrientation', risky, rows.length, rules.riskOrientation.minN);
}

function scoreDecisionConsistency(records, map, rules) {
  const groups = [];
  Object.keys(map.consistency).forEach(name => {
    const members = map.consistency[name];
    const rows = records.filter(r => Number.isInteger(r.personalChoice) && hasKey(members, r.id));
    if (rows.length < rules.decisionConsistency.minPerGroup) return;
    const sides = rows.map(r => r.personalChoice === members[r.id]);
    groups.push({ name, answers: rows.length, consistent: sides.every(s => s === sides[0]) });
  });
  const consistent = groups.filter(g => g.consistent).length;
  return ratioResult('decisionConsistency', consistent, groups.length, rules.decisionConsistency.minGroups, { groups });
}

function scorePerspectiveShifting() {
  return {
    key: 'perspectiveShifting',
    k: 0,
    n: 0,
    minN: 0,
    ready: false,
    value: null,
    ci: null,
    reason: 'Not measured yet: the game does not ask for predictions about specific groups.'
  };
}

// Computes the profile. Records with IDs missing from the bank are ignored, so retired questions do not break scoring.
function computeProfile(records, bank, map, rules, dataSource) {
  const known = new Set(bank.map(q => q.id));
  const usable = records.filter(r => r && known.has(r.id));
  return {
    dataSource: dataSource || 'simulated',
    sample: {
      answers: usable.filter(r => Number.isInteger(r.personalChoice)).length,
      predictions: usable.filter(r => typeof r.correct === 'boolean').length
    },
    dimensions: [
      scoreSocialIndependence(usable, rules),
      scoreCrowdIntuition(usable, rules),
      scoreRiskOrientation(usable, map, rules),
      scoreDecisionConsistency(usable, map, rules),
      scorePerspectiveShifting(usable, map, rules)
    ]
  };
}

if (typeof module !== 'undefined') module.exports = { wilsonInterval, computeProfile };
