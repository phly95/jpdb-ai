// Comprehensive analysis implementing amendments A1, A2, A5
// Evaluates dev, test, and hard splits.

const fs = require('fs');
const path = require('path');

function computePercentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const weight = idx - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function analyzeSplit(results, cases, splitName) {
  const splitCases = splitName === 'overall' ? cases : cases.filter(c => c.split === splitName);
  const caseIds = new Set(splitCases.map(c => c.id));
  const splitResults = results.filter(r => caseIds.has(r.caseId));

  const byCase = {};
  for (const r of splitResults) {
    if (!byCase[r.caseId]) byCase[r.caseId] = [];
    byCase[r.caseId].push(r);
  }

  // --- A1: Case-only False-Flawless (A case is false-flawless if ANY of its 6 conditions is) ---
  const errorCases = splitCases.filter(c => c.label.startsWith('critical_error:') || c.label === 'moderate_error');
  const validCases = splitCases.filter(c => c.label === 'flawless' || c.label === 'valid_paraphrase');

  let falseFlawlessCasesCount = 0;
  const falseFlawlessCaseIds = [];

  for (const ec of errorCases) {
    const runs = byCase[ec.id] || [];
    // Condition: ANY of the 6 runs received overall === 10 or isStrict10Consensus or flawless_fast_path
    const hasFlawless = runs.some(r => r.overall === 10 || r.isStrict10Consensus || r.route === 'flawless_fast_path');
    if (hasFlawless) {
      falseFlawlessCasesCount++;
      falseFlawlessCaseIds.push(ec.id);
    }
  }

  const nErr = errorCases.length;
  const ffRate = nErr > 0 ? (falseFlawlessCasesCount / nErr) : 0;
  const ff95Upper = nErr > 0 ? (falseFlawlessCasesCount === 0 ? (3 / nErr) : ((falseFlawlessCasesCount + 1.96 * Math.sqrt(falseFlawlessCasesCount)) / nErr)) : 0;

  // --- False Deductions (using majority over repeats or canonical R1) ---
  // A valid case is a false deduction if majority or canonical R1 gave < 9/10
  let falseDeductionCasesCount = 0;
  const falseDeductionCaseIds = [];
  for (const vc of validCases) {
    const runs = byCase[vc.id] || [];
    const r1 = runs.find(r => r.orderMode === 'original_r1');
    if (r1 && r1.overall < 9) {
      falseDeductionCasesCount++;
      falseDeductionCaseIds.push(vc.id);
    }
  }
  const nVal = validCases.length;
  const fdRate = nVal > 0 ? (falseDeductionCasesCount / nVal) : 0;

  // --- A2: Decision-level Flips (across the 4 distinct option orders: original_r1, reversed, shuffle_s1, shuffle_s2) ---
  let scoreFlips = 0;
  let fastPathFlips = 0;
  let critiqueCatFlips = 0;
  let anyDecisionFlips = 0;

  for (const c of splitCases) {
    const runs = (byCase[c.id] || []).filter(r => ['original_r1', 'reversed', 'shuffle_s1', 'shuffle_s2'].includes(r.orderMode));
    if (runs.length > 1) {
      const scores = new Set(runs.map(r => r.overall));
      const routes = new Set(runs.map(r => r.route));
      const critiques = new Set(runs.map(r => r.critiqueSource));

      const sFlip = scores.size > 1;
      const fpFlip = routes.size > 1;
      const cFlip = critiques.size > 1;

      if (sFlip) scoreFlips++;
      if (fpFlip) fastPathFlips++;
      if (cFlip) critiqueCatFlips++;
      if (sFlip || fpFlip || cFlip) anyDecisionFlips++;
    }
  }

  const decisionFlipRate = splitCases.length > 0 ? (anyDecisionFlips / splitCases.length) : 0;
  const scoreFlipRate = splitCases.length > 0 ? (scoreFlips / splitCases.length) : 0;
  const fastPathFlipRate = splitCases.length > 0 ? (fastPathFlips / splitCases.length) : 0;
  const critiqueCatFlipRate = splitCases.length > 0 ? (critiqueCatFlips / splitCases.length) : 0;

  // --- Repeat noise on the exact same decision-level metric (across original_r1, original_r2, original_r3) ---
  let repScoreFlips = 0;
  let repFpFlips = 0;
  let repCritiqueFlips = 0;
  let repAnyDecisionFlips = 0;

  for (const c of splitCases) {
    const repRuns = (byCase[c.id] || []).filter(r => ['original_r1', 'original_r2', 'original_r3'].includes(r.orderMode));
    if (repRuns.length > 1) {
      const s = new Set(repRuns.map(r => r.overall));
      const rt = new Set(repRuns.map(r => r.route));
      const cr = new Set(repRuns.map(r => r.critiqueSource));

      const sF = s.size > 1;
      const fpF = rt.size > 1;
      const cF = cr.size > 1;

      if (sF) repScoreFlips++;
      if (fpF) repFpFlips++;
      if (cF) repCritiqueFlips++;
      if (sF || fpF || cF) repAnyDecisionFlips++;
    }
  }

  const repeatDecisionFlipRate = splitCases.length > 0 ? (repAnyDecisionFlips / splitCases.length) : 0;

  // --- Fast-path coverage ---
  const fpCases = splitCases.filter(c => (byCase[c.id] || []).find(r => r.orderMode === 'original_r1')?.isFastPath).length;
  const fpCoverage = splitCases.length > 0 ? (fpCases / splitCases.length) : 0;

  // --- Latencies ---
  const latencies = splitResults.map(r => r.latencyMs).filter(l => typeof l === 'number');
  const p50 = computePercentile(latencies, 50);
  const p95 = computePercentile(latencies, 95);

  // --- User-perceived latency including fallback ---
  // Baseline assumption: Jev latency for fast-path; Jev latency + 800ms fallback for fallback
  const perceivedLatencies = splitResults.map(r => r.latencyMs + (r.isFastPath ? 0 : 800));
  const perceivedP50 = computePercentile(perceivedLatencies, 50);
  const perceivedP95 = computePercentile(perceivedLatencies, 95);

  return {
    split: splitName,
    casesCount: splitCases.length,
    callsCount: splitResults.length,
    errorCasesCount: nErr,
    validCasesCount: nVal,
    falseFlawless: {
      casesCount: falseFlawlessCasesCount,
      caseIds: falseFlawlessCaseIds,
      rate: ffRate,
      upperBound95: ff95Upper
    },
    falseDeduction: {
      casesCount: falseDeductionCasesCount,
      caseIds: falseDeductionCaseIds,
      rate: fdRate
    },
    decisionFlips: {
      anyDecisionFlips,
      rate: decisionFlipRate,
      scoreFlips,
      scoreFlipRate,
      fastPathFlips,
      fastPathFlipRate,
      critiqueCatFlips,
      critiqueCatFlipRate
    },
    repeatDecisionNoise: {
      anyDecisionFlips: repAnyDecisionFlips,
      rate: repeatDecisionFlipRate,
      scoreFlips: repScoreFlips,
      fastPathFlips: repFpFlips
    },
    fastPathCoverage: {
      casesCount: fpCases,
      rate: fpCoverage
    },
    latency: {
      p50: Math.round(p50),
      p95: Math.round(p95)
    },
    userPerceivedLatency: {
      p50: Math.round(perceivedP50),
      p95: Math.round(perceivedP95)
    }
  };
}

// Directional test: how often does the first-listed option win vs the same option listed last?
function analyzeDirectionalBias(results, cases) {
  // Compare original_r1 vs reversed for each case and question
  const byCase = {};
  for (const r of results) {
    if (!byCase[r.caseId]) byCase[r.caseId] = {};
    byCase[r.caseId][r.orderMode] = r;
  }

  let totalQuestionsCompared = 0;
  let firstWonInOriginal = 0;
  let firstWonInReversed = 0;
  let stayedSameOption = 0;
  let shiftedToNewFirst = 0;
  let shiftedToOther = 0;

  for (const c of cases) {
    const pair = byCase[c.id];
    if (!pair || !pair.original_r1 || !pair.reversed) continue;

    const origAns = pair.original_r1.answers || {};
    const revAns = pair.reversed.answers || {};
    const origOrder = pair.original_r1.optionOrderUsed || {};
    const revOrder = pair.reversed.optionOrderUsed || {};

    const qKeys = Object.keys(origAns);
    for (const q of qKeys) {
      if (origAns[q]?.type === 'choice' && origOrder[q] && revOrder[q] && origOrder[q].length > 1) {
        totalQuestionsCompared++;
        const origOptions = origOrder[q];
        const revOptions = revOrder[q];

        const origChoice = origAns[q].choice;
        const revChoice = revAns[q].choice;

        const origFirstOpt = origOptions[0];
        const revFirstOpt = revOptions[0]; // this was origOptions[last]

        if (origChoice === origFirstOpt) firstWonInOriginal++;
        if (revChoice === revFirstOpt) firstWonInReversed++;

        if (origChoice === revChoice) {
          stayedSameOption++;
        } else if (revChoice === revFirstOpt) {
          // Choice switched to the option that was newly moved to position 0!
          shiftedToNewFirst++;
        } else {
          shiftedToOther++;
        }
      }
    }
  }

  return {
    totalQuestionsCompared,
    firstWonInOriginal,
    firstWonInOriginalRate: totalQuestionsCompared > 0 ? (firstWonInOriginal / totalQuestionsCompared) : 0,
    firstWonInReversed,
    firstWonInReversedRate: totalQuestionsCompared > 0 ? (firstWonInReversed / totalQuestionsCompared) : 0,
    stayedSameOption,
    stayedSameRate: totalQuestionsCompared > 0 ? (stayedSameOption / totalQuestionsCompared) : 0,
    shiftedToNewFirst,
    shiftedToNewFirstRate: totalQuestionsCompared > 0 ? (shiftedToNewFirst / totalQuestionsCompared) : 0,
    shiftedToOther,
    shiftedToOtherRate: totalQuestionsCompared > 0 ? (shiftedToOther / totalQuestionsCompared) : 0
  };
}

function runAnalysis() {
  const r1Path = path.join(__dirname, 'baseline_run1.json');
  const casesPath = path.join(__dirname, 'cases.json');
  const hardR1Path = path.join(__dirname, 'baseline_hard_run1.json');
  const hardCasesPath = path.join(__dirname, 'hard_cases.json');

  const r1 = JSON.parse(fs.readFileSync(r1Path, 'utf8')).results;
  const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

  const hardR1 = JSON.parse(fs.readFileSync(hardR1Path, 'utf8')).results;
  const hardCases = JSON.parse(fs.readFileSync(hardCasesPath, 'utf8'));

  const devReport = analyzeSplit(r1, cases, 'dev');
  const testReport = analyzeSplit(r1, cases, 'test');
  const hardReport = analyzeSplit(hardR1, hardCases, 'hard');

  const dirTest = analyzeDirectionalBias(r1, cases);
  const dirHard = analyzeDirectionalBias(hardR1, hardCases);

  const fullReport = {
    dev: devReport,
    test: testReport,
    hard: hardReport,
    directionalBias: {
      standardCases: dirTest,
      hardCases: dirHard
    }
  };

  console.log(JSON.stringify(fullReport, null, 2));
}

runAnalysis();
