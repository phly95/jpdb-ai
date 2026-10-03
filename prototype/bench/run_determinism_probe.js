// Determinism probe: sends the exact same payload x10 on 5 representative cases
// Measures max probability difference and choice stability across identical requests.

const fs = require('fs');
const path = require('path');
const { callJev, config } = require('../jev_client');
const { runSingleTrial } = require('../run_comprehensive_benchmark');

const userscriptPath = path.join(__dirname, '..', '..', 'jpdb-ai.user.js');
const casesPath = path.join(__dirname, 'cases.json');
const allCases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

// 5 representative cases
const probeIds = [
  'dev_flawless_01',
  'dev_flawless_03',
  'dev_crit_passive_01',
  'dev_crit_polarity_01',
  'dev_mod_01'
];
const probeCases = probeIds.map(id => allCases.find(c => c.id === id));

const REPEATS = 10;

async function runDeterminismProbe() {
  console.log(`======================================================================`);
  console.log(`🔬 DETERMINISM PROBE: 5 cases x ${REPEATS} identical repeats`);
  console.log(`Endpoint: ${config.jevEndpoint} (${config.jevModel})`);
  console.log(`======================================================================\n`);

  const { exportedCode } = (function load() {
    const src = fs.readFileSync(userscriptPath, 'utf8');
    const exportedCode = src.replace(/\}\)\(\);\s*$/, `
      if (typeof globalThis.__USERSCRIPT_EXPORTS__ !== 'undefined') {
        globalThis.__USERSCRIPT_EXPORTS__.callJevEvaluation = callJevEvaluation;
        globalThis.__USERSCRIPT_EXPORTS__.parseJevScores = parseJevScores;
      }
    })();
    `);
    return { exportedCode };
  })();

  const probeResults = {};

  for (const tc of probeCases) {
    console.log(`Testing case: ${tc.id} (${tc.japanese})...`);
    probeResults[tc.id] = [];

    for (let r = 0; r < REPEATS; r++) {
      const trial = await runSingleTrial(tc, 'original_r1', exportedCode);
      probeResults[tc.id].push(trial);
      process.stdout.write(`  [${r + 1}/${REPEATS}] score=${trial.overall} route=${trial.route} lat=${trial.latencyMs}ms\n`);
    }
  }

  // Analyze probability differences across identical runs
  console.log(`\n======================================================================`);
  console.log(`📊 DETERMINISM PROBE ANALYSIS`);
  console.log(`======================================================================`);

  let globalMaxProbDiff = 0;
  let maxDiffDetail = null;
  const caseSummaries = [];

  for (const [caseId, runs] of Object.entries(probeResults)) {
    const scores = runs.map(r => r.overall);
    const routes = runs.map(r => r.route);
    const scoreFlipped = new Set(scores).size > 1;
    const routeFlipped = new Set(routes).size > 1;

    // Check all probabilities across all questions
    const qKeys = Object.keys(runs[0].answers || {});
    let caseMaxDiff = 0;
    let caseMaxQuestion = '';
    let caseMaxOpt = '';

    for (const q of qKeys) {
      // If choice question with probabilities
      const firstAns = runs[0].answers[q];
      if (firstAns && firstAns.probabilities && typeof firstAns.probabilities === 'object') {
        const optKeys = Object.keys(firstAns.probabilities);
        for (const opt of optKeys) {
          const probs = runs.map(r => r.answers[q]?.probabilities?.[opt] ?? 0);
          const minP = Math.min(...probs);
          const maxP = Math.max(...probs);
          const diff = Number((maxP - minP).toFixed(4));
          if (diff > caseMaxDiff) {
            caseMaxDiff = diff;
            caseMaxQuestion = q;
            caseMaxOpt = opt;
          }
          if (diff > globalMaxProbDiff) {
            globalMaxProbDiff = diff;
            maxDiffDetail = { caseId, question: q, option: opt, minP, maxP, diff, probs };
          }
        }
      }
    }

    caseSummaries.push({
      caseId,
      scores: Array.from(new Set(scores)).join(','),
      routes: Array.from(new Set(routes)).join(','),
      scoreFlipped,
      routeFlipped,
      maxProbDiff: caseMaxDiff,
      maxDiffQuestion: caseMaxQuestion,
      maxDiffOpt: caseMaxOpt
    });
  }

  console.table(caseSummaries);
  console.log(`\nGlobal Max Probability Difference: ${(globalMaxProbDiff * 100).toFixed(2)}%`);
  console.log(`Detail of largest shift:`, JSON.stringify(maxDiffDetail, null, 2));

  const outPath = path.join(__dirname, 'determinism_probe_results.json');
  fs.writeFileSync(outPath, JSON.stringify({ metadata: { timestamp: new Date().toISOString(), casesCount: probeCases.length, repeats: REPEATS, globalMaxProbDiff, maxDiffDetail }, summaries: caseSummaries, probeResults }, null, 2), 'utf8');
  console.log(`Saved probe results to ${outPath}`);
}

runDeterminismProbe().catch(err => {
  console.error('Fatal probe error:', err);
  process.exit(1);
});
