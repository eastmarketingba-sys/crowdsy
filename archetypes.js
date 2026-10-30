// Personality archetypes and results. Built on the V1.2 profile from scoring.js. Never recalculates scores.
//
// Assignment rules (checked in order, first match wins). v = ready dimension values (null if not ready):
//   si = socialIndependence, ci = crowdIntuition, ro = riskOrientation, dc = decisionConsistency
// No archetype is assigned until socialIndependence and crowdIntuition are both ready (10 answers and 10 predictions).

const ARCHETYPES = [
  {
    key: 'contrarian-architect', name: 'The Contrarian Architect',
    rule: 'si >= 0.60 and ci >= 0.60: often differs from the crowd and predicts it well.',
    test: v => v.si >= 0.6 && v.ci >= 0.6,
    sentence: 'You often choose differently from the crowd, yet you read it accurately.',
    blindSpot: 'You may understand what others prefer while underweighting how much your own taste is the one that matters to you.',
    question: 'When you disagree with the crowd, is it because you know something they do not, or because you want to stand apart?'
  },
  {
    key: 'independent-thinker', name: 'The Independent Thinker',
    rule: 'si >= 0.60 and ci < 0.50: differs from the crowd and often misreads it.',
    test: v => v.si >= 0.6 && v.ci < 0.5,
    sentence: 'You follow your own compass, and the crowd often surprises you.',
    blindSpot: 'You may underestimate how predictable your choices look to people who know you well.',
    question: 'What would it take for you to predict the crowd as confidently as you judge your own taste?'
  },
  {
    key: 'pattern-hunter', name: 'The Pattern Hunter',
    rule: 'dc >= 0.75 and ci >= 0.50: decisions stay on one side across trade-offs and predictions are reasonable.',
    test: v => v.dc !== null && v.dc >= 0.75 && v.ci >= 0.5,
    sentence: 'Your choices hold a steady line across trade-offs, and you read the crowd with care.',
    blindSpot: 'Consistency can hide situations where your values should shift.',
    question: 'Which of your consistent choices would you most like to test against a friend\'s?'
  },
  {
    key: 'wildcard', name: 'The Wildcard',
    rule: 'ro >= 0.65 and si >= 0.40: reaches for the riskier option and differs from the crowd at least sometimes.',
    test: v => v.ro !== null && v.ro >= 0.65 && v.si >= 0.4,
    sentence: 'You reach for the riskier option, and the crowd does not always follow you there.',
    blindSpot: 'You may underweight the downside when the upside is vivid.',
    question: 'What is the riskiest choice you made in this session, and what would have made it feel safer?'
  },
  {
    key: 'cautious-anchor', name: 'The Cautious Anchor',
    rule: 'ro <= 0.30 and dc >= 0.50: prefers the safer option and keeps trade-offs steady.',
    test: v => v.ro !== null && v.ro <= 0.3 && v.dc !== null && v.dc >= 0.5,
    sentence: 'You prefer the safer option and keep your trade-offs steady.',
    blindSpot: 'You may pass over chances where a little more risk would have paid off.',
    question: 'Which safe choice would you make differently with more time to think?'
  },
  {
    key: 'consensus-seeker', name: 'The Consensus Seeker',
    rule: 'si <= 0.35 and ci >= 0.60: usually lands with the crowd and reads it well.',
    test: v => v.si <= 0.35 && v.ci >= 0.6,
    sentence: 'You usually land with the crowd, and you read it well.',
    blindSpot: 'You may find it harder to see what you would choose if nobody else were there.',
    question: 'Would any of your answers change if nobody else would ever see them?'
  },
  {
    key: 'social-cartographer', name: 'The Social Cartographer',
    rule: 'ci >= 0.70 and 0.35 < si < 0.60: maps the crowd precisely while keeping a mix of its own preferences.',
    test: v => v.ci >= 0.7 && v.si > 0.35 && v.si < 0.6,
    sentence: 'You map the crowd precisely, while keeping a mixed set of your own preferences.',
    blindSpot: 'Accurate mapping can make it harder to tell which preferences are your own.',
    question: 'Which prediction surprised you most, and why do you think you got it right?'
  },
  {
    key: 'quiet-strategist', name: 'The Quiet Strategist',
    rule: 'si <= 0.35 and 0.50 <= ci < 0.60: mostly follows the crowd with a steady, careful read of it.',
    test: v => v.si <= 0.35 && v.ci >= 0.5 && v.ci < 0.6,
    sentence: 'You keep your own counsel: your choices track the crowd, and your predictions are careful.',
    blindSpot: 'You may hold back a view that would be worth testing out loud.',
    question: 'What is one choice you keep to yourself, and why?'
  },
  {
    key: 'adaptive-mind', name: 'The Adaptive Mind',
    rule: 'Fallback when si and ci are ready and no rule above matches.',
    test: () => true,
    sentence: 'Your answers sit in the middle of most measures, so your profile is still taking shape.',
    blindSpot: 'Middle scores can reflect a mix of situations rather than one stable style.',
    question: 'Which kind of question makes you change your mind most?'
  }
];

const ARCHETYPE_BY_KEY = new Map(ARCHETYPES.map(a => [a.key, a]));

function dimValues(profile) {
  const get = key => {
    const d = profile.dimensions.find(x => x.key === key);
    return d && d.ready ? d.value : null;
  };
  return { si: get('socialIndependence'), ci: get('crowdIntuition'), ro: get('riskOrientation'), dc: get('decisionConsistency') };
}

function assignArchetype(profile) {
  const v = dimValues(profile);
  if (v.si === null || v.ci === null) {
    return { key: null, status: 'insufficient', archetype: null, values: v, reason: 'Needs 10 answers and 10 predictions to unlock your archetype.' };
  }
  const archetype = ARCHETYPES.find(a => a.test(v));
  return { key: archetype.key, status: 'assigned', archetype, values: v, reason: null };
}

function sampleLevel(answers) {
  if (answers >= 40) return 'high';
  if (answers >= 20) return 'medium';
  return 'low';
}

const DIM_TEXT = {
  socialIndependence: (d) => `In ${d.k} of ${d.n} answers, your own choice differed from the simulated crowd majority.`,
  crowdIntuition: (d) => `You predicted the simulated crowd majority in ${d.k} of ${d.n} predictions.`,
  riskOrientation: (d) => `You chose the riskier option in ${d.k} of ${d.n} risk-tagged questions.`,
  decisionConsistency: (d) => `${d.k} of ${d.n} trade-off groups stayed on one side.`
};

// Builds the results view model. sessionRecords are this session's records (used for examples).
function buildResults(profile, sessionRecords, bank, map, assignment) {
  const byId = new Map(bank.map(q => [q.id, q]));
  const ready = profile.dimensions.filter(d => d.ready && DIM_TEXT[d.key]);
  let strongest = null;
  let bestDistance = 0.15; // below this distance from 0.5 there is no strong pattern to report
  ready.forEach(d => {
    const distance = Math.abs(d.value - 0.5);
    if (distance >= bestDistance) {
      bestDistance = distance;
      strongest = { key: d.key, text: DIM_TEXT[d.key](d) };
    }
  });

  const v = assignment.values;
  const contradiction = v.si !== null && v.ci !== null && v.si >= 0.6 && v.ci >= 0.6
    ? 'You often choose differently from the simulated crowd, yet you predict it well. Your own taste and your reading of others are both strong.'
    : null;

  const examples = [];
  const differing = sessionRecords.filter(r => Number.isInteger(r.personalChoice) && Number.isInteger(r.majority) && r.personalChoice !== r.majority);
  const pool = differing.length ? differing : sessionRecords.filter(r => Number.isInteger(r.personalChoice));
  pool.slice(0, 3).forEach(r => {
    const q = byId.get(r.id);
    if (!q || r.majority === null || r.majority === undefined) return;
    examples.push({
      question: q.q,
      chose: q.o[r.personalChoice],
      majority: q.o[r.majority],
      majorityPct: q.v[r.majority],
      differs: r.personalChoice !== r.majority
    });
  });

  const answers = profile.sample.answers;
  return {
    status: assignment.status,
    reason: assignment.reason,
    archetype: assignment.archetype ? {
      key: assignment.archetype.key,
      name: assignment.archetype.name,
      sentence: assignment.archetype.sentence,
      blindSpot: assignment.archetype.blindSpot,
      question: assignment.archetype.question
    } : null,
    dimensions: ready,
    strongest,
    contradiction,
    examples,
    sample: {
      level: sampleLevel(answers),
      answers,
      predictions: profile.sample.predictions,
      note: sampleLevel(answers) === 'low' ? 'Early read: based on few answers. Treat this as a first impression.' : null
    }
  };
}

if (typeof module !== 'undefined') module.exports = { ARCHETYPES, ARCHETYPE_BY_KEY, assignArchetype, buildResults, dimValues, sampleLevel };
