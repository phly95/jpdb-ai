// Comprehensive Directional Test & Repeat Noise Analysis (C4)
// Evaluates Run 1 and Run 2 separately across Standard (Dev/Test) and Hard splits.

const fs = require('fs');
const path = require('path');

// Exact binomial test (two-sided)
function binomialCoeff(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let c = 1;
  for (let i = 1; i <= k; i++) {
    c = (c * (n - (k - i))) / i;
  }
  return c;
}

function exactBinomialTest(k, n, p = 0.5) {
  if (n === 0) return { pValue: 1.0, significant: false };
  // Two-sided p-value
  const obsProb = binomialCoeff(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
  let pVal = 0;
  for (let i = 0; i <= n; i++) {
    const prob = binomialCoeff(n, i) * Math.pow(p, i) * Math.pow(1 - p, n - i);
    if (prob <= obsProb + 1e-9) {
      pVal += prob;
    }
  }
  return { pValue: Math.min(1.0, pVal), significant: pVal < 0.05 };
}

function analyzeDirectionalFlips(results, cases) {
  const byCase = {};
  for (const r of results) {
    if (!byCase[r.caseId]) byCase[r.caseId] = {};
    byCase[r.caseId][r.orderMode] = r;
  }

  const optionBuckets = {
    '2': { flips: 0, toFirst: 0, toLast: 0, toMiddle: 0 },
    '3': { flips: 0, toFirst: 0, toLast: 0, toMiddle: 0 },
    '4+': { flips: 0, toFirst: 0, toLast: 0, toMiddle: 0 },
    'overall': { flips: 0, toFirst: 0, toLast: 0, toMiddle: 0, totalQuestions: 0, unchanged: 0 }
  };

  // Question-level repeat noise: r1 vs r2, r1 vs r3
  let qComparedR1R2 = 0;
  let qFlippedR1R2 = 0;
  let qComparedR1R3 = 0;
  let qFlippedR1R3 = 0;

  for (const c of cases) {
    const pair = byCase[c.id];
    if (!pair) continue;

    const r1 = pair.original_r1;
    const r2 = pair.original_r2;
    const r3 = pair.original_r3;
    const rev = pair.reversed;

    // Check repeat noise (r1 vs r2)
    if (r1 && r2 && r1.answers && r2.answers) {
      for (const q of Object.keys(r1.answers)) {
        if (r1.answers[q]?.type === 'choice' && r2.answers[q]) {
          qComparedR1R2++;
          if (r1.answers[q].choice !== r2.answers[q].choice) {
            qFlippedR1R2++;
          }
        }
      }
    }

    // Check repeat noise (r1 vs r3)
    if (r1 && r3 && r1.answers && r3.answers) {
      for (const q of Object.keys(r1.answers)) {
        if (r1.answers[q]?.type === 'choice' && r3.answers[q]) {
          qComparedR1R3++;
          if (r1.answers[q].choice !== r3.answers[q].choice) {
            qFlippedR1R3++;
          }
        }
      }
    }

    // Directional test on r1 vs rev
    if (r1 && rev && r1.answers && rev.answers && r1.optionOrderUsed && rev.optionOrderUsed) {
      for (const q of Object.keys(r1.answers)) {
        if (r1.answers[q]?.type === 'choice' && rev.answers[q] && r1.optionOrderUsed[q] && rev.optionOrderUsed[q]) {
          const origOpts = r1.optionOrderUsed[q];
          const revOpts = rev.optionOrderUsed[q];
          const numOpts = origOpts.length;
          if (numOpts < 2) continue;

          optionBuckets.overall.totalQuestions++;
          const origChoice = r1.answers[q].choice;
          const revChoice = rev.answers[q].choice;

          if (origChoice === revChoice) {
            optionBuckets.overall.unchanged++;
          } else {
            // Choice flipped between original and reversed
            const bucketKey = numOpts === 2 ? '2' : (numOpts === 3 ? '3' : '4+');
            optionBuckets[bucketKey].flips++;
            optionBuckets.overall.flips++;

            // In reversed order:
            // revOpts[0] is the newly first-listed option (was origOpts[last])
            // revOpts[last] is the newly last-listed option (was origOpts[0])
            // revOpts[1..last-1] are middle options
            const firstOptInRev = revOpts[0];
            const lastOptInRev = revOpts[revOpts.length - 1];

            if (revChoice === firstOptInRev) {
              optionBuckets[bucketKey].toFirst++;
              optionBuckets.overall.toFirst++;
            } else if (revChoice === lastOptInRev) {
              optionBuckets[bucketKey].toLast++;
              optionBuckets.overall.toLast++;
            } else {
              optionBuckets[bucketKey].toMiddle++;
              optionBuckets.overall.toMiddle++;
            }
          }
        }
      }
    }
  }

  // Exact binomial test of toFirst vs toLast among flips
  const nSign = optionBuckets.overall.toFirst + optionBuckets.overall.toLast;
  const binom = exactBinomialTest(optionBuckets.overall.toFirst, nSign);

  return {
    optionBuckets,
    signTest: {
      toFirst: optionBuckets.overall.toFirst,
      toLast: optionBuckets.overall.toLast,
      totalFirstOrLast: nSign,
      pValue: binom.pValue,
      significant: binom.significant,
      tooSmallToConclude: nSign < 15
    },
    repeatNoise: {
      r1_vs_r2: { total: qComparedR1R2, flipped: qFlippedR1R2, rate: qComparedR1R2 > 0 ? (qFlippedR1R2 / qComparedR1R2) : 0 },
      r1_vs_r3: { total: qComparedR1R3, flipped: qFlippedR1R3, rate: qComparedR1R3 > 0 ? (qFlippedR1R3 / qComparedR1R3) : 0 }
    }
  };
}

// Compute decision-level metrics with all 4 rows
function computeDecisionLevelTable(results, cases, splitName) {
  const splitCases = splitName === 'overall' ? cases : cases.filter(c => c.split === splitName);
  const caseIds = new Set(splitCases.map(c => c.id));
  const splitResults = results.filter(r => caseIds.has(r.caseId));

  const byCase = {};
  for (const r of splitResults) {
    if (!byCase[r.caseId]) byCase[r.caseId] = [];
    byCase[r.caseId].push(r);
  }

  // Flips across 4 orders
  let anyFlips = 0, scoreFlips = 0, fpFlips = 0, critFlips = 0;
  for (const c of splitCases) {
    const runs = (byCase[c.id] || []).filter(r => ['original_r1', 'reversed', 'shuffle_s1', 'shuffle_s2'].includes(r.orderMode));
    if (runs.length > 1) {
      const s = new Set(runs.map(r => r.overall));
      const fp = new Set(runs.map(r => r.route));
      const cr = new Set(runs.map(r => r.critiqueSource));
      if (s.size > 1) scoreFlips++;
      if (fp.size > 1) fpFlips++;
      if (cr.size > 1) critFlips++;
      if (s.size > 1 || fp.size > 1 || cr.size > 1) anyFlips++;
    }
  }

  // Repeat noise across original_r1, r2, r3
  let repAny = 0, repScore = 0, repFp = 0, repCrit = 0;
  for (const c of splitCases) {
    const reps = (byCase[c.id] || []).filter(r => ['original_r1', 'original_r2', 'original_r3'].includes(r.orderMode));
    if (reps.length > 1) {
      const s = new Set(reps.map(r => r.overall));
      const fp = new Set(reps.map(r => r.route));
      const cr = new Set(reps.map(r => r.critiqueSource));
      if (s.size > 1) repScore++;
      if (fp.size > 1) repFp++;
      if (cr.size > 1) repCrit++;
      if (s.size > 1 || fp.size > 1 || cr.size > 1) repAny++;
    }
  }

  const n = splitCases.length;
  return {
    split: splitName,
    casesCount: n,
    orderFlips: {
      any: { count: anyFlips, rate: n > 0 ? anyFlips / n : 0 },
      score: { count: scoreFlips, rate: n > 0 ? scoreFlips / n : 0 },
      fastPath: { count: fpFlips, rate: n > 0 ? fpFlips / n : 0 },
      critique: { count: critFlips, rate: n > 0 ? critFlips / n : 0 }
    },
    repeatNoise: {
      any: { count: repAny, rate: n > 0 ? repAny / n : 0 },
      score: { count: repScore, rate: n > 0 ? repScore / n : 0 },
      fastPath: { count: repFp, rate: n > 0 ? repFp / n : 0 },
      critique: { count: repCrit, rate: n > 0 ? repCrit / n : 0 }
    }
  };
}

function main() {
  const cases = JSON.parse(fs.readFileSync('prototype/bench/cases.json', 'utf8'));
  const hardCases = JSON.parse(fs.readFileSync('prototype/bench/hard_cases.json', 'utf8'));

  const r1 = JSON.parse(fs.readFileSync('prototype/bench/baseline_run1.json', 'utf8')).results;
  const r2 = JSON.parse(fs.readFileSync('prototype/bench/baseline_run2.json', 'utf8')).results;

  const hr1 = JSON.parse(fs.readFileSync('prototype/bench/baseline_hard_run1.json', 'utf8')).results;
  const hr2 = JSON.parse(fs.readFileSync('prototype/bench/baseline_hard_run2.json', 'utf8')).results;

  console.log('=== RUN 1 ANALYSIS ===');
  const dir_std_r1 = analyzeDirectionalFlips(r1, cases);
  const dir_hard_r1 = analyzeDirectionalFlips(hr1, hardCases);
  const dec_dev_r1 = computeDecisionLevelTable(r1, cases, 'dev');
  const dec_test_r1 = computeDecisionLevelTable(r1, cases, 'test');
  const dec_hard_r1 = computeDecisionLevelTable(hr1, hardCases, 'hard');

  console.log('=== RUN 2 ANALYSIS ===');
  const dir_std_r2 = analyzeDirectionalFlips(r2, cases);
  const dir_hard_r2 = analyzeDirectionalFlips(hr2, hardCases);
  const dec_dev_r2 = computeDecisionLevelTable(r2, cases, 'dev');
  const dec_test_r2 = computeDecisionLevelTable(r2, cases, 'test');
  const dec_hard_r2 = computeDecisionLevelTable(hr2, hardCases, 'hard');

  const output = {
    run1: {
      directional: { standard: dir_std_r1, hard: dir_hard_r1 },
      decisionFlips: { dev: dec_dev_r1, test: dec_test_r1, hard: dec_hard_r1 }
    },
    run2: {
      directional: { standard: dir_std_r2, hard: dir_hard_r2 },
      decisionFlips: { dev: dec_dev_r2, test: dec_test_r2, hard: dec_hard_r2 }
    }
  };

  fs.writeFileSync('prototype/bench/directional_analysis_results.json', JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify(output, null, 2));
}

main();
