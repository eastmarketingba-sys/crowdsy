// Progress across sessions. Derived only from saved sessions, nothing is stored separately.
// Progress means discoveries (a dimension or archetype becoming readable for the first time) and accuracy totals.
// A change in gameplay scores is not a change in personality, and the UI says so.
// In Node (tests and tooling) the helpers come from their modules. In the browser they are already global.
if (typeof module !== 'undefined' && typeof require !== 'undefined') {
  var { computeProfile } = require('./scoring.js');
  var { assignArchetype } = require('./archetypes.js');
}

const PROGRESS_LABELS = {
  socialIndependence: 'Social independence',
  crowdIntuition: 'Crowd intuition',
  riskOrientation: 'Risk orientation',
  decisionConsistency: 'Decision consistency'
};

function buildProgress(sessions, bank, map, rules) {
  const unlocks = [];
  const archetypes = [];
  const unlocked = new Set();
  let cumulative = [];
  sessions.forEach((s, i) => {
    cumulative = cumulative.concat(s.records || []);
    const profile = computeProfile(cumulative, bank, map, rules, 'simulated');
    profile.dimensions.forEach(d => {
      if (d.ready && PROGRESS_LABELS[d.key] && !unlocked.has(d.key)) {
        unlocked.add(d.key);
        unlocks.push({ key: d.key, label: PROGRESS_LABELS[d.key], sessionIndex: i, at: s.at || null });
      }
    });
    const assignment = assignArchetype(profile);
    if (assignment.key && !archetypes.some(a => a.key === assignment.key)) {
      archetypes.push({ key: assignment.key, name: assignment.archetype.name, sessionIndex: i, at: s.at || null });
    }
  });
  const predictions = cumulative.filter(r => typeof r.correct === 'boolean');
  const hits = predictions.filter(r => r.correct).length;
  return {
    sessions: sessions.length,
    unlocks,
    archetypes,
    accuracy: { k: hits, n: predictions.length, value: predictions.length ? hits / predictions.length : null }
  };
}

if (typeof module !== 'undefined') module.exports = { buildProgress, PROGRESS_LABELS };
