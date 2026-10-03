// Script for C6: Confidence floor boundary proximity and repeat pass/fail flip analysis
// Evaluates existing repeat data (original_r1, original_r2, original_r3) across baseline runs.

const fs = require('fs');
const path = require('path');

const runFiles = [
  'prototype/bench/baseline_run1.json',
  'prototype/bench/baseline_run2.json',
  'prototype/bench/baseline_hard_run1.json',
  'prototype/bench/baseline_hard_run2.json'
];

// Define key fast-path confidence floors in jpdb-ai.user.js
const floors = [
  {
    name: 'triggering_conf_critique_fastpath',
    floor: 0.75,
    getVal: (r) => r.triggeringConfidence
  },
  {
    name: 'bracket_conf_critique_eligibility',
    floor: 0.55,
    getVal: (r) => r.bracketConfidence
  },
  {
    name: 'bracket_conf_critique_execution',
    floor: 0.65,
    getVal: (r) => r.bracketConfidence
  },
  {
    name: 'guard_floor_polarity_check',
    floor: 0.60,
    getVal: (r) => r.answers?.polarity_check?.confidence
  },
  {
    name: 'guard_floor_predicate_mood_and_voice',
    floor: 0.60,
    getVal: (r) => r.answers?.predicate_mood_and_voice?.confidence
  },
  {
    name: 'guard_floor_benefactive_direction',
    floor: 0.60,
    getVal: (r) => r.answers?.benefactive_direction?.confidence
  },
  {
    name: 'guard_floor_predicate_complex_conjugation',
    floor: 0.60,
    getVal: (r) => r.answers?.predicate_complex_conjugation?.confidence
  },
  {
    name: 'strict10_is_flawless_prob',
    floor: 0.85,
    getVal: (r) => r.answers?.is_flawless?.noul
  }
];

function analyzeFloorProximity() {
  const stats = {};
  for (const f of floors) {
    stats[f.name] = {
      floor: f.floor,
      totalClaimsEvaluated: 0,
      within017OfFloor: 0,
      casesEvaluatedAcrossRepeats: 0,
      casesChangedPassFailBetweenRepeats: 0
    };
  }

  for (const rf of runFiles) {
    const data = JSON.parse(fs.readFileSync(rf, 'utf8'));
    const results = data.results;

    // Group by caseId
    const byCase = {};
    for (const r of results) {
      if (!byCase[r.caseId]) byCase[r.caseId] = {};
      byCase[r.caseId][r.orderMode] = r;
    }

    for (const [caseId, modes] of Object.entries(byCase)) {
      const reps = [modes.original_r1, modes.original_r2, modes.original_r3].filter(Boolean);
      if (reps.length < 3) continue;

      for (const f of floors) {
        const vals = reps.map(r => f.getVal(r)).filter(v => typeof v === 'number');
        if (vals.length < 3) continue;

        stats[f.name].casesEvaluatedAcrossRepeats++;

        // Check if any rep had confidence within 0.17 of floor (|val - floor| <= 0.17)
        for (const v of vals) {
          stats[f.name].totalClaimsEvaluated++;
          if (Math.abs(v - f.floor) <= 0.17) {
            stats[f.name].within017OfFloor++;
          }
        }

        // Check if pass/fail flipped across the 3 repeats (val >= floor)
        const passes = vals.map(v => v >= f.floor);
        const allPass = passes.every(p => p === true);
        const allFail = passes.every(p => p === false);
        if (!allPass && !allFail) {
          stats[f.name].casesChangedPassFailBetweenRepeats++;
        }
      }
    }
  }

  const report = [];
  for (const [name, st] of Object.entries(stats)) {
    const shareWithin017 = st.totalClaimsEvaluated > 0 ? (st.within017OfFloor / st.totalClaimsEvaluated * 100).toFixed(2) + '%' : 'N/A';
    const flipRate = st.casesEvaluatedAcrossRepeats > 0 ? (st.casesChangedPassFailBetweenRepeats / st.casesEvaluatedAcrossRepeats * 100).toFixed(2) + '%' : 'N/A';
    report.push({
      claimName: name,
      floor: st.floor,
      totalClaims: st.totalClaimsEvaluated,
      within017Count: st.within017OfFloor,
      shareWithin017,
      casesChecked: st.casesEvaluatedAcrossRepeats,
      casesFlippedPassFail: st.casesChangedPassFailBetweenRepeats,
      caseFlipRate: flipRate
    });
  }

  console.table(report);
  fs.writeFileSync('prototype/bench/confidence_floor_boundary_analysis.json', JSON.stringify(report, null, 2), 'utf8');
}

analyzeFloorProximity();
