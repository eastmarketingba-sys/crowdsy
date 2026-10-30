// Behavioral dimensions: definitions, scoring rules and the explicit question mapping.
// Only questions listed here count toward a dimension. Question text lives in questions.js.
// To add a question to a dimension, add its ID here with the index of the option it counts for.

// Display definitions. Each definition states what is measured, not what is good.
const DIMENSION_DEFS = [
  { key: 'socialIndependence', label: 'Social independence', definition: 'How often your own choice differed from the simulated crowd majority. Neither end of this scale is better.' },
  { key: 'crowdIntuition', label: 'Crowd intuition', definition: 'How often your prediction matched the simulated crowd majority.' },
  { key: 'riskOrientation', label: 'Risk orientation', definition: 'Share of risk-tagged questions where you chose the riskier option. Only questions mapped to risk are counted.' },
  { key: 'decisionConsistency', label: 'Decision consistency', definition: 'Share of trade-off groups where your choices stayed on the same side across the group.' },
  { key: 'perspectiveShifting', label: 'Perspective shifting', definition: 'How well you predict what specific groups prefer. Not measured in this version.' }
];

// Minimum data before a score is shown.
const DIMENSION_RULES = {
  socialIndependence: { minN: 10 },
  crowdIntuition: { minN: 10 },
  riskOrientation: { minN: 5 },
  decisionConsistency: { minGroups: 2, minPerGroup: 2 },
  perspectiveShifting: { minN: 0 }
};

// Explicit mapping. Each value is the option index that counts for the dimension.
const DIMENSION_MAP = {
  // Risk: index of the riskier option.
  risk: {
    MA03: 1, // "One huge payout" over a stable income
    MA04: 1, // "Yes, immediately" to quitting a secure job
    HS09: 1, // "The 1-in-3 shot" over a sure €200
    RD01: 1, // "50/50 at €6,000 or nothing" over a safe €3,000
    RD04: 0, // "Yes" to moving with no job lined up
    RD05: 0, // "Fast and risky" over slow and certain
    RD11: 0, // "Well-paid but uncertain" over steady but slow
    RD13: 1, // "No, they would wait" after a 20% loss
    RD15: 0  // "Ask high and risk it" in an interview
  },
  // Consistency: each group is one trade-off. The value is the option index on the group's chosen side (the pole).
  // Consistency is judged on which side a player takes, never on whether they agree with the crowd.
  consistency: {
    security: { MA03: 0, HS09: 0, RD01: 0, RD04: 1, RD11: 1, RD13: 0, RD15: 1 },
    honesty: { MD01: 1, MD12: 0, RF04: 0, RF05: 0 },
    loyalty: { MD02: 1, MD03: 0 }
  },
  // Perspective: no group-level prompts exist yet. Entries would need { questionId: { group: index } } plus group-level crowd data.
  perspective: {}
};

if (typeof module !== 'undefined') module.exports = { DIMENSION_DEFS, DIMENSION_RULES, DIMENSION_MAP };
