// Analysis script for comprehensive benchmark results
// Computes metrics specified in S1.5 for dev and test separately.

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

function analyzeDataset(results, cases) {
  // Group results by caseId
  const byCase = {};
  for (const r of results) {
    if (!byCase[r.caseId]) byCase[r.caseId] = [];
    byCase[r.caseId].push(r);
  }

  const splits = ['dev', 'test', 'overall'];
  const report = {};

  for (const sp of splits) {
    const splitCases = sp === 'overall' ? cases : cases.filter(c => c.split === sp);
    const caseIds = new Set(splitCases.map(c => c.id));
    const splitResults = results.filter(r => caseIds.has(r.caseId));

    // 1. Latency (all calls in split)
    const latencies = splitResults.map(r => r.latencyMs).filter(l => typeof l === 'number');
    const p50 = computePercentile(latencies, 50);
    const p95 = computePercentile(latencies, 95);

    // 2. Error cases vs Valid cases
    const errorCases = splitCases.filter(c => c.label.startsWith('critical_error:') || c.label === 'moderate_error');
    const errorCaseIds = new Set(errorCases.map(c => c.id));
    const validCases = splitCases.filter(c => c.label === 'flawless' || c.label === 'valid_paraphrase');
    const validCaseIds = new Set(validCases.map(c => c.id));

    // Count false-flawless across calls on error cases:
    // (Also per-case: did this error case EVER or in canonical run receive false-flawless?)
    const errorResults = splitResults.filter(r => errorCaseIds.has(r.caseId));
    const nErrorCalls = errorResults.length;
    const nErrorCases = errorCases.length;

    // A call is false-flawless if overall === 10 or isStrict10Consensus === true or route === 'flawless_fast_path'
    const falseFlawlessCalls = errorResults.filter(r => r.overall === 10 || r.isStrict10Consensus || r.route === 'flawless_fast_path').length;
    
    // Per-case in canonical original_r1:
    const errorR1 = errorResults.filter(r => r.orderMode === 'original_r1');
    const falseFlawlessR1Cases = errorR1.filter(r => r.overall === 10 || r.isStrict10Consensus || r.route === 'flawless_fast_path').length;
    // 95% upper bound: rule of three if 0, else Wilson score upper bound
    const ruleOfThreeCases = (3 / nErrorCases);
    const ruleOfThreeCalls = (3 / nErrorCalls);

    // 3. False-deduction rate on valid cases (valid_paraphrase and flawless receiving < 9/10 or flagged error)
    const validResults = splitResults.filter(r => validCaseIds.has(r.caseId));
    const validR1 = validResults.filter(r => r.orderMode === 'original_r1');
    const falseDeductionCalls = validResults.filter(r => r.overall < 9).length;
    const falseDeductionRateCalls = validResults.length > 0 ? (falseDeductionCalls / validResults.length) : 0;
    const falseDeductionR1Cases = validR1.filter(r => r.overall < 9).length;
    const falseDeductionRateCases = validR1.length > 0 ? (falseDeductionR1Cases / validR1.length) : 0;

    // 4. Option-order flip rate across the 4 distinct option orders:
    // original_r1, reversed, shuffle_s1, shuffle_s2
    let optionOrderFlips = 0;
    for (const c of splitCases) {
      const cRuns = byCase[c.id] || [];
      const distinctRuns = cRuns.filter(r => ['original_r1', 'reversed', 'shuffle_s1', 'shuffle_s2'].includes(r.orderMode));
      if (distinctRuns.length > 1) {
        const scores = new Set(distinctRuns.map(r => r.overall));
        let choicesFlipped = false;
        // Check if any question's choice changed
        const qKeys = Object.keys(distinctRuns[0].answers || {});
        for (const q of qKeys) {
          const choices = new Set(distinctRuns.map(r => r.answers?.[q]?.choice).filter(Boolean));
          if (choices.size > 1) {
            choicesFlipped = true;
            break;
          }
        }
        if (scores.size > 1 || choicesFlipped) {
          optionOrderFlips++;
        }
      }
    }
    const optionOrderFlipRate = splitCases.length > 0 ? (optionOrderFlips / splitCases.length) : 0;

    // 5. Repeat noise (run-to-run variation across original_r1, original_r2, original_r3)
    let repeatFlips = 0;
    for (const c of splitCases) {
      const cRuns = byCase[c.id] || [];
      const repRuns = cRuns.filter(r => ['original_r1', 'original_r2', 'original_r3'].includes(r.orderMode));
      if (repRuns.length > 1) {
        const scores = new Set(repRuns.map(r => r.overall));
        let choicesFlipped = false;
        const qKeys = Object.keys(repRuns[0].answers || {});
        for (const q of qKeys) {
          const choices = new Set(repRuns.map(r => r.answers?.[q]?.choice).filter(Boolean));
          if (choices.size > 1) {
            choicesFlipped = true;
            break;
          }
        }
        if (scores.size > 1 || choicesFlipped) {
          repeatFlips++;
        }
      }
    }
    const repeatFlipRate = splitCases.length > 0 ? (repeatFlips / splitCases.length) : 0;

    // 6. Fast-path coverage (share of cases/calls routed to fast path)
    const fastPathCalls = splitResults.filter(r => r.isFastPath).length;
    const fastPathCoverage = splitResults.length > 0 ? (fastPathCalls / splitResults.length) : 0;
    const fastPathR1Cases = (byCase ? splitCases.filter(c => (byCase[c.id] || []).find(r => r.orderMode === 'original_r1')?.isFastPath).length : 0);
    const fastPathCaseCoverage = splitCases.length > 0 ? (fastPathR1Cases / splitCases.length) : 0;

    // 7. Calibration of Fast Path by confidence bucket:
    // Buckets: [0.5, 0.6), [0.6, 0.7), [0.7, 0.8), [0.8, 0.9), [0.9, 1.0]
    const buckets = [
      { min: 0.5, max: 0.6, label: '0.5-0.6' },
      { min: 0.6, max: 0.7, label: '0.6-0.7' },
      { min: 0.7, max: 0.8, label: '0.7-0.8' },
      { min: 0.8, max: 0.9, label: '0.8-0.9' },
      { min: 0.9, max: 1.01, label: '0.9-1.0' }
    ];

    const calibration = buckets.map(b => {
      // Look at fast path decisions with triggering confidence in range
      const inBucket = splitResults.filter(r => r.isFastPath && (r.triggeringConfidence ?? 0) >= b.min && (r.triggeringConfidence ?? 0) < b.max);
      const accurate = inBucket.filter(r => r.fastPathAccurate).length;
      return {
        bucket: b.label,
        total: inBucket.length,
        accurate,
        accuracy: inBucket.length > 0 ? (accurate / inBucket.length) : null
      };
    });

    report[sp] = {
      totalCases: splitCases.length,
      totalCalls: splitResults.length,
      latency: { p50: Math.round(p50), p95: Math.round(p95) },
      falseFlawless: {
        cases: falseFlawlessR1Cases,
        totalErrorCases: nErrorCases,
        upperBoundCases: ruleOfThreeCases,
        calls: falseFlawlessCalls,
        totalErrorCalls: nErrorCalls,
        upperBoundCalls: ruleOfThreeCalls
      },
      falseDeduction: {
        cases: falseDeductionR1Cases,
        totalValidCases: validCases.length,
        rateCases: falseDeductionRateCases,
        calls: falseDeductionCalls,
        totalValidCalls: validResults.length,
        rateCalls: falseDeductionRateCalls
      },
      optionOrderFlipRate,
      optionOrderFlips,
      repeatFlipRate,
      repeatFlips,
      fastPathCoverageCalls: fastPathCoverage,
      fastPathCoverageCases: fastPathCaseCoverage,
      calibration
    };
  }

  return report;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const benchPath = args[0] || path.join(__dirname, 'baseline_run1.json');
  const casesPath = path.join(__dirname, 'cases.json');

  const benchData = JSON.parse(fs.readFileSync(benchPath, 'utf8'));
  const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
  const report = analyzeDataset(benchData.results, cases);

  console.log(JSON.stringify(report, null, 2));
}

module.exports = { analyzeDataset };
