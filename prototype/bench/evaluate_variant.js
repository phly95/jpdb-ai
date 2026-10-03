// prototype/bench/evaluate_variant.js
// Automated variant evaluation tool strictly implementing BENCH_SPEC.md.

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    baselineTest1: path.join(__dirname, 'phase2_run1.json'),
    baselineTest2: path.join(__dirname, 'phase2_run2.json'),
    baselineHard1: path.join(__dirname, 'phase2_hard_run1.json'),
    baselineHard2: path.join(__dirname, 'phase2_hard_run2.json'),
    variantTest1: null,
    variantTest2: null,
    variantHard1: null,
    variantHard2: null,
    casesFile: path.join(__dirname, 'cases.json'),
    hardCasesFile: path.join(__dirname, 'hard_cases.json'),
    mode: 'self-check' // 'self-check', 'compare-p1-p2', or 'evaluate'
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--self-check') {
      options.mode = 'self-check';
    } else if (a === '--compare-p1-p2') {
      options.mode = 'compare-p1-p2';
    } else if (a === '--var-test-1' && args[i + 1]) {
      options.variantTest1 = args[++i];
      options.mode = 'evaluate';
    } else if (a === '--var-test-2' && args[i + 1]) {
      options.variantTest2 = args[++i];
    } else if (a === '--var-hard-1' && args[i + 1]) {
      options.variantHard1 = args[++i];
    } else if (a === '--var-hard-2' && args[i + 1]) {
      options.variantHard2 = args[++i];
    } else if (a === '--base-test-1' && args[i + 1]) {
      options.baselineTest1 = args[++i];
    } else if (a === '--base-test-2' && args[i + 1]) {
      options.baselineTest2 = args[++i];
    } else if (a === '--base-hard-1' && args[i + 1]) {
      options.baselineHard1 = args[++i];
    } else if (a === '--base-hard-2' && args[i + 1]) {
      options.baselineHard2 = args[++i];
    }
  }

  if (options.mode === 'self-check') {
    options.variantTest1 = options.baselineTest1;
    options.variantTest2 = options.baselineTest2;
    options.variantHard1 = options.baselineHard1;
    options.variantHard2 = options.baselineHard2;
  } else if (options.mode === 'compare-p1-p2') {
    options.baselineTest1 = path.join(__dirname, 'baseline_run1.json');
    options.baselineTest2 = path.join(__dirname, 'baseline_run2.json');
    options.baselineHard1 = path.join(__dirname, 'baseline_hard_run1.json');
    options.baselineHard2 = path.join(__dirname, 'baseline_hard_run2.json');
    options.variantTest1 = path.join(__dirname, 'phase2_run1.json');
    options.variantTest2 = path.join(__dirname, 'phase2_run2.json');
    options.variantHard1 = path.join(__dirname, 'phase2_hard_run1.json');
    options.variantHard2 = path.join(__dirname, 'phase2_hard_run2.json');
  }

  return options;
}

function getMajority(arr) {
  const counts = {};
  for (const item of arr) {
    counts[item] = (counts[item] || 0) + 1;
  }
  let best = null;
  let max = -1;
  for (const [k, v] of Object.entries(counts)) {
    if (v > max) {
      max = v;
      best = k;
    }
  }
  return isNaN(best) ? best : Number(best);
}

function computeQuantile(arr, q) {
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base] || 0;
}

function analyzeRun(runFilePath, casesFilePath, splitName) {
  const allCases = JSON.parse(fs.readFileSync(casesFilePath, 'utf8'));
  const cases = splitName === 'test' ? allCases.filter(c => c.split === 'test') : allCases;
  const caseMap = new Map(cases.map(c => [c.id, c]));

  const runData = JSON.parse(fs.readFileSync(runFilePath, 'utf8'));
  const results = runData.results.filter(r => caseMap.has(r.caseId));

  const byCase = new Map();
  for (const r of results) {
    if (!byCase.has(r.caseId)) byCase.set(r.caseId, []);
    byCase.get(r.caseId).push(r);
  }

  // 1. Decision Flips across 4 distinct orders (original_r1, reversed, shuffle_s1, shuffle_s2)
  const flippedCaseIds = [];
  for (const [cid, trials] of byCase.entries()) {
    const baseTrial = trials.find(t => t.orderMode === 'original_r1');
    if (!baseTrial) continue;
    const testTrials = trials.filter(t => ['reversed', 'shuffle_s1', 'shuffle_s2'].includes(t.orderMode));
    const hasFlip = testTrials.some(t =>
      t.isFastPath !== baseTrial.isFastPath ||
      t.overall !== baseTrial.overall ||
      (t.critiqueSource || '') !== (baseTrial.critiqueSource || '')
    );
    if (hasFlip) flippedCaseIds.push(cid);
  }
  const flipRate = (flippedCaseIds.length / cases.length) * 100;

  // 2. Fast-Path Coverage (Majority over 3 original repeats) & First-repeat coverage
  let covMajCount = 0;
  let covR1Count = 0;
  for (const [cid, trials] of byCase.entries()) {
    const r1 = trials.find(t => t.orderMode === 'original_r1');
    if (r1 && r1.isFastPath) covR1Count++;

    const origRepeats = trials.filter(t => t.orderMode.startsWith('original_r'));
    const fpCount = origRepeats.filter(t => t.isFastPath).length;
    if (fpCount >= 2) covMajCount++;
  }
  const covMajPct = (covMajCount / cases.length) * 100;
  const covR1Pct = (covR1Count / cases.length) * 100;

  // 3. False Deductions (Valid cases with majority overall < 9, typo_only excluded)
  const validCases = cases.filter(c => c.label === 'flawless' || c.label === 'valid_paraphrase');
  const falseDeductionIds = [];
  for (const vc of validCases) {
    const trials = byCase.get(vc.id) || [];
    const origRepeats = trials.filter(t => t.orderMode.startsWith('original_r'));
    const scores = origRepeats.map(t => t.overall);
    const majScore = getMajority(scores);
    if (majScore < 9) falseDeductionIds.push(vc.id);
  }

  // 4. Typo-Only Pass Rate
  const typoCases = cases.filter(c => c.label === 'typo_only');
  let typoPassCount = 0;
  const typoFailingIds = [];
  for (const tc of typoCases) {
    const trials = byCase.get(tc.id) || [];
    const origRepeats = trials.filter(t => t.orderMode.startsWith('original_r'));
    const scores = origRepeats.map(t => t.overall);
    const majScore = getMajority(scores);
    const critSources = origRepeats.map(t => t.critiqueSource || '');
    const majCrit = getMajority(critSources);
    const isTypoSource = majCrit === 'typo_fast_path' || majCrit === 'english_typo_check';
    if (majScore >= 8 && isTypoSource) {
      typoPassCount++;
    } else {
      typoFailingIds.push(tc.id);
    }
  }

  // 4b. Critique-Type Agreement on critical_error cases
  const criticalCases = cases.filter(c => c.label && c.label.startsWith('critical_error:'));
  let fastPathCriticalCount = 0;
  const typeDisagreeIds = [];

  const CRITIQUE_TYPE_MAP = {
    passive_reversal: [
      { question: 'predicate_mood_and_voice', choice: 'passive_vs_active_error' },
      { question: 'predicate_voice', choice: 'passive_vs_active_error' },
      { question: 'sentence_critique_summary', choice: 'passive_voice_reversed' },
      { question: 'sentence_critique_summary', choice: 'agent_or_passive_reversed' }
    ],
    polarity_inversion: [
      { question: 'polarity_check', choice: 'polarity_inverted' }
    ],
    benefactive_reversal: [
      { question: 'benefactive_direction', choice: 'recipient_reversed_self_vs_other' },
      { question: 'sentence_critique_summary', choice: 'wrong_benefactive_or_recipient' }
    ],
    indefinite_vs_wh: [
      { question: 'question_type_and_scope', choice: 'confused_indefinite_with_wh_word' },
      { question: 'sentence_critique_summary', choice: 'interrogative_or_question_error' }
    ],
    causative_passive_inversion: [
      { question: 'predicate_complex_conjugation', choice: 'causative_passive_inverted' }
    ],
    numeral_mismatch: [
      { question: 'numeral_mismatch', choice: null }
    ]
  };

  function checkCritiqueMatch(trial, expectedType) {
    const src = trial.critiqueSource;
    const answers = trial.answers || {};
    const rules = CRITIQUE_TYPE_MAP[expectedType] || [];
    for (const r of rules) {
      if (r.question === 'numeral_mismatch' && src === 'numeral_mismatch') return true;
      if (src === r.question) {
        if (!r.choice) return true;
        const ans = answers[r.question];
        if (ans && ans.choice === r.choice) return true;
        const dyn = (trial.dynamicCritique || '').toLowerCase();
        if (dyn.includes(r.choice.replace(/_/g, ' '))) return true;
      }
    }
    return false;
  }

  for (const cc of criticalCases) {
    const expectedType = cc.label.split(':', 1)[1] || cc.label.replace('critical_error:', '');
    const trials = byCase.get(cc.id) || [];
    const origRepeats = trials.filter(t => t.orderMode.startsWith('original_r'));
    const fpRepeats = origRepeats.filter(t => t.isFastPath);
    if (fpRepeats.length >= 2) {
      fastPathCriticalCount++;
      const agreeCount = fpRepeats.filter(t => checkCritiqueMatch(t, expectedType)).length;
      if (agreeCount < fpRepeats.length / 2.0) {
        typeDisagreeIds.push(cc.id);
      }
    }
  }

  // 5. False Flawless in ANY of the 6 conditions on error cases
  const errorCases = cases.filter(c => !['flawless', 'valid_paraphrase', 'typo_only'].includes(c.label));
  const falseFlawlessIds = [];
  for (const ec of errorCases) {
    const trials = byCase.get(ec.id) || [];
    const hasFalseFlawless = trials.some(t =>
      t.overall === 10 ||
      t.isStrict10Consensus === true ||
      t.route === 'flawless_fast_path'
    );
    if (hasFalseFlawless) falseFlawlessIds.push(ec.id);
  }

  // 6. Top-Bucket Accuracy (Confidence >= 0.90, fast-path calls)
  let topBucketCalls = 0;
  let topBucketWrong = 0;
  const wrongCallDetails = [];
  for (const r of results) {
    if (r.isFastPath) {
      const conf = r.triggeringConfidence || r.bracketConfidence || 0;
      if (conf >= 0.90) {
        topBucketCalls++;
        if (!r.fastPathAccurate) {
          topBucketWrong++;
          wrongCallDetails.push({ caseId: r.caseId, mode: r.orderMode, route: r.route, conf });
        }
      }
    }
  }
  const topBucketAccPct = topBucketCalls > 0 ? ((topBucketCalls - topBucketWrong) / topBucketCalls) * 100 : 100.0;

  // 7. Latencies
  const latencies = results.map(r => r.latencyMs || 0).filter(l => l > 0);
  const p95Latency = computeQuantile(latencies, 0.95);
  const meanLatency = latencies.length > 0 ? (latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  return {
    runFile: runFilePath,
    split: splitName,
    totalCases: cases.length,
    validCasesCount: validCases.length,
    typoCasesCount: typoCases.length,
    errorCasesCount: errorCases.length,
    criticalCasesCount: criticalCases.length,
    fastPathCriticalCount,
    typeDisagreeCount: typeDisagreeIds.length,
    typeDisagreeIds,
    totalCalls: results.length,
    flipRate,
    flippedCaseIds,
    covMajPct,
    covMajCount,
    covR1Pct,
    covR1Count,
    falseDeductionCount: falseDeductionIds.length,
    falseDeductionIds,
    typoPassCount,
    typoFailingIds,
    falseFlawlessCount: falseFlawlessIds.length,
    falseFlawlessIds,
    topBucketCalls,
    topBucketWrong,
    topBucketAccPct,
    wrongCallDetails,
    p95Latency,
    meanLatency
  };
}

function evaluateSplit(baseRun1, baseRun2, varRun1, varRun2, splitName, latencyAbResult) {
  // Baseline worse-of-two boundaries
  const flipCeiling = Math.max(baseRun1.flipRate, baseRun2.flipRate) + 5.0;
  const covFloor = Math.min(baseRun1.covMajPct, baseRun2.covMajPct) - 3.0;
  const fdCeiling = Math.max(baseRun1.falseDeductionCount, baseRun2.falseDeductionCount) + 1;
  const ffCeiling = 0; // Hard zero tolerance
  const tbWrongCeiling = 0; // Zero tolerance with 100% baseline
  const typeDisagreeCeiling = Math.max(baseRun1.typeDisagreeCount, baseRun2.typeDisagreeCount);
  const baseP95Worse = Math.max(baseRun1.p95Latency, baseRun2.p95Latency);
  const latencyCeiling = Math.min(400, baseP95Worse * 1.15);

  const criteria = [
    {
      name: 'Decision Flip Rate',
      rule: `≤ ${flipCeiling.toFixed(2)}% (worse base + 5.0%)`,
      v1Val: `${varRun1.flipRate.toFixed(2)}% (${varRun1.flippedCaseIds.length}/${varRun1.totalCases})`,
      v2Val: `${varRun2.flipRate.toFixed(2)}% (${varRun2.flippedCaseIds.length}/${varRun2.totalCases})`,
      pass: varRun1.flipRate <= flipCeiling && varRun2.flipRate <= flipCeiling
    },
    {
      name: 'Fast-Path Coverage (Maj)',
      rule: `≥ ${covFloor.toFixed(2)}% (worse base - 3.0%)`,
      v1Val: `${varRun1.covMajPct.toFixed(2)}% (${varRun1.covMajCount}/${varRun1.totalCases})`,
      v2Val: `${varRun2.covMajPct.toFixed(2)}% (${varRun2.covMajCount}/${varRun2.totalCases})`,
      pass: varRun1.covMajPct >= covFloor && varRun2.covMajPct >= covFloor
    },
    {
      name: 'Fast-Path Coverage (r1 info)',
      rule: `Informational`,
      v1Val: `${varRun1.covR1Pct.toFixed(2)}% (${varRun1.covR1Count}/${varRun1.totalCases})`,
      v2Val: `${varRun2.covR1Pct.toFixed(2)}% (${varRun2.covR1Count}/${varRun2.totalCases})`,
      pass: true
    },
    {
      name: 'False Deductions (Valid cases)',
      rule: `≤ ${fdCeiling}/${varRun1.validCasesCount} (worse base + 1 case)`,
      v1Val: `${varRun1.falseDeductionCount}/${varRun1.validCasesCount} (${JSON.stringify(varRun1.falseDeductionIds)})`,
      v2Val: `${varRun2.falseDeductionCount}/${varRun2.validCasesCount} (${JSON.stringify(varRun2.falseDeductionIds)})`,
      pass: varRun1.falseDeductionCount <= fdCeiling && varRun2.falseDeductionCount <= fdCeiling
    },
    {
      name: 'Typo-Only Pass Rate',
      rule: varRun1.typoCasesCount > 0 ? `≥ ${varRun1.typoCasesCount}/${varRun1.typoCasesCount} (not worse than base)` : 'N/A (0 cases)',
      v1Val: varRun1.typoCasesCount > 0 ? `${varRun1.typoPassCount}/${varRun1.typoCasesCount}` : 'N/A',
      v2Val: varRun2.typoCasesCount > 0 ? `${varRun2.typoPassCount}/${varRun2.typoCasesCount}` : 'N/A',
      pass: varRun1.typoCasesCount === 0 || (varRun1.typoPassCount === varRun1.typoCasesCount && varRun2.typoPassCount === varRun2.typoCasesCount)
    },
    {
      name: 'False-Flawless (Error cases)',
      rule: `≤ 0 (hard ceiling, zero tolerance)`,
      v1Val: `${varRun1.falseFlawlessCount}/${varRun1.errorCasesCount} (${JSON.stringify(varRun1.falseFlawlessIds)})`,
      v2Val: `${varRun2.falseFlawlessCount}/${varRun2.errorCasesCount} (${JSON.stringify(varRun2.falseFlawlessIds)})`,
      pass: varRun1.falseFlawlessCount <= ffCeiling && varRun2.falseFlawlessCount <= ffCeiling
    },
    {
      name: 'Top-Bucket Accuracy [0.90, 1.00]',
      rule: `0 wrong calls (not worse than base)`,
      v1Val: `${varRun1.topBucketWrong} wrong (${varRun1.topBucketAccPct.toFixed(2)}%, ${varRun1.topBucketCalls - varRun1.topBucketWrong}/${varRun1.topBucketCalls})`,
      v2Val: `${varRun2.topBucketWrong} wrong (${varRun2.topBucketAccPct.toFixed(2)}%, ${varRun2.topBucketCalls - varRun2.topBucketWrong}/${varRun2.topBucketCalls})`,
      pass: varRun1.topBucketWrong <= tbWrongCeiling && varRun2.topBucketWrong <= tbWrongCeiling
    },
    {
      name: 'Critique-Type Disagreement',
      rule: `≤ ${typeDisagreeCeiling} cases (worse base count)`,
      v1Val: `${varRun1.typeDisagreeCount}/${varRun1.fastPathCriticalCount} FP (${JSON.stringify(varRun1.typeDisagreeIds)})`,
      v2Val: `${varRun2.typeDisagreeCount}/${varRun2.fastPathCriticalCount} FP (${JSON.stringify(varRun2.typeDisagreeIds)})`,
      pass: varRun1.typeDisagreeCount <= typeDisagreeCeiling && varRun2.typeDisagreeCount <= typeDisagreeCeiling
    },
    {
      name: 'Jev p95 Latency',
      rule: `≤ ${latencyCeiling.toFixed(0)} ms (≤400ms & ≤+15% base)`,
      v1Val: `${varRun1.p95Latency.toFixed(0)} ms`,
      v2Val: `${varRun2.p95Latency.toFixed(0)} ms`,
      pass: varRun1.p95Latency <= latencyCeiling && varRun2.p95Latency <= latencyCeiling
    }
  ];

  return { splitName, criteria, overallPass: criteria.every(c => c.pass) };
}

function printTable(title, evalResult) {
  console.log(`\n========================================================================================`);
  console.log(`📊 ADOPTION TABLE: ${title.toUpperCase()} (Overall: ${evalResult.overallPass ? '✅ PASS' : '❌ FAIL'})`);
  console.log(`========================================================================================`);
  console.log(
    'Metric'.padEnd(32) +
    'Variant Run 1'.padEnd(28) +
    'Variant Run 2'.padEnd(28) +
    'Requirement / Margin'.padEnd(36) +
    'Result'
  );
  console.log('-'.repeat(130));

  for (const c of evalResult.criteria) {
    const status = c.pass ? 'PASS' : 'FAIL';
    console.log(
      c.name.padEnd(32) +
      c.v1Val.padEnd(28) +
      c.v2Val.padEnd(28) +
      c.rule.padEnd(36) +
      (c.pass ? '✅ ' + status : '❌ ' + status)
    );
  }
}

function printPerceivedLatency(varRun, splitName) {
  const cov = varRun.covMajPct / 100;
  const tFast = varRun.meanLatency;
  console.log(`\nPerceived Latency Summary (${splitName.toUpperCase()} - Mean Jev: ${tFast.toFixed(1)} ms, Coverage: ${(cov * 100).toFixed(1)}%):`);
  for (const L of [500, 1000, 2000]) {
    const tUser = cov * tFast + (1 - cov) * (tFast + L);
    console.log(`  Fallback L = ${L} ms -> User-Perceived Latency: ${tUser.toFixed(1)} ms`);
  }
}

function main() {
  const opts = parseArgs();
  console.log(`Executing evaluate_variant in mode: [${opts.mode}]`);
  console.log(`Baseline Test: ${opts.baselineTest1} & ${opts.baselineTest2}`);
  console.log(`Baseline Hard: ${opts.baselineHard1} & ${opts.baselineHard2}`);
  console.log(`Variant Test:  ${opts.variantTest1} & ${opts.variantTest2}`);
  console.log(`Variant Hard:  ${opts.variantHard1} & ${opts.variantHard2}`);

  // Analyze all runs
  const bTest1 = analyzeRun(opts.baselineTest1, opts.casesFile, 'test');
  const bTest2 = analyzeRun(opts.baselineTest2, opts.casesFile, 'test');
  const vTest1 = analyzeRun(opts.variantTest1, opts.casesFile, 'test');
  const vTest2 = analyzeRun(opts.variantTest2, opts.casesFile, 'test');

  const bHard1 = analyzeRun(opts.baselineHard1, opts.hardCasesFile, 'hard');
  const bHard2 = analyzeRun(opts.baselineHard2, opts.hardCasesFile, 'hard');
  const vHard1 = analyzeRun(opts.variantHard1, opts.hardCasesFile, 'hard');
  const vHard2 = analyzeRun(opts.variantHard2, opts.hardCasesFile, 'hard');

  const testEval = evaluateSplit(bTest1, bTest2, vTest1, vTest2, 'test');
  const hardEval = evaluateSplit(bHard1, bHard2, vHard1, vHard2, 'hard');

  printTable('Test Split Evaluation', testEval);
  printPerceivedLatency(vTest1, 'test');

  printTable('Hard Split Evaluation', hardEval);
  printPerceivedLatency(vHard1, 'hard');

  const overall = testEval.overallPass && hardEval.overallPass;
  console.log(`\n========================================================================================`);
  console.log(`FINAL DECISION: ${overall ? '🎉 VARIANT ADOPTED (ALL CRITERIA PASSED)' : '⛔ VARIANT REJECTED'}`);
  console.log(`========================================================================================\n`);

  if (!overall) {
    process.exitCode = 1;
  }
}

main();
