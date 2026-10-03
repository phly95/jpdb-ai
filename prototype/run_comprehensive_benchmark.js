// Comprehensive benchmark runner for JPDB AI translation grading
// Tests across 4 option orders (original, reversed, 2 seeded shuffles) and 3 repeats of original order.

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { callJev, config } = require('./jev_client');

const SEED_1 = 1337;
const SEED_2 = 424242;

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, seed) {
  const rng = mulberry32(seed);
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function transformQuestions(questions, mode) {
  const cloned = JSON.parse(JSON.stringify(questions));
  const optionOrderUsed = {};

  for (const [qKey, qVal] of Object.entries(cloned)) {
    if (qVal && qVal.type === 'choice' && Array.isArray(qVal.options)) {
      let newOptions = [...qVal.options];
      if (mode === 'reversed') {
        newOptions.reverse();
      } else if (mode === 'shuffle_s1') {
        newOptions = seededShuffle(newOptions, SEED_1);
      } else if (mode === 'shuffle_s2') {
        newOptions = seededShuffle(newOptions, SEED_2);
      }
      qVal.options = newOptions;
      optionOrderUsed[qKey] = newOptions;

      // Also align criteria keys if criteria object is present
      if (qVal.criteria && typeof qVal.criteria === 'object' && !Array.isArray(qVal.criteria)) {
        const newCrit = {};
        for (const opt of newOptions) {
          if (opt in qVal.criteria) {
            newCrit[opt] = qVal.criteria[opt];
          }
        }
        for (const [k, v] of Object.entries(qVal.criteria)) {
          if (!(k in newCrit)) newCrit[k] = v;
        }
        qVal.criteria = newCrit;
      }
    }
  }

  return { questions: cloned, optionOrderUsed };
}

function loadUserscriptExports(userscriptPath) {
  const src = fs.readFileSync(userscriptPath, 'utf8');
  const exportedCode = src.replace(/\}\)\(\);\s*$/, `
    if (typeof globalThis.__USERSCRIPT_EXPORTS__ !== 'undefined') {
      globalThis.__USERSCRIPT_EXPORTS__.callJevEvaluation = callJevEvaluation;
      globalThis.__USERSCRIPT_EXPORTS__.parseJevScores = parseJevScores;
    }
  })();
  `);

  return { exportedCode };
}

function createSandbox(exportedCode, onPost) {
  const sandbox = {
    location: { pathname: '/review' },
    document: { readyState: 'loading', addEventListener: () => {} },
    window: {},
    GM_getValue: (k, d) => {
      if (k === 'jpdb_ai_jev_endpoint') return config.jevEndpoint;
      if (k === 'jpdb_ai_jev_key') return config.jevKey;
      if (k === 'jpdb_ai_jev_model') return config.jevModel;
      return d;
    },
    GM_setValue: () => {},
    GM_registerMenuCommand: () => {},
    GM_xmlhttpRequest: onPost,
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    __USERSCRIPT_EXPORTS__: {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(exportedCode, sandbox);
  return sandbox;
}

async function runSingleTrial(tc, mode, exportedCode) {
  let optionOrderUsed = null;
  let requestElapsed = 0;

  const sandbox = createSandbox(exportedCode, (opts) => {
    const requestBody = JSON.parse(opts.data);
    const transformed = transformQuestions(requestBody.questions, mode);
    requestBody.questions = transformed.questions;
    optionOrderUsed = transformed.optionOrderUsed;

    const t0 = Date.now();
    callJev(requestBody.state, requestBody.questions)
      .then((res) => {
        requestElapsed = res.elapsedMs || (Date.now() - t0);
        opts.onload({
          status: 200,
          responseText: JSON.stringify({ answers: res.answers, usage: res.usage })
        });
      })
      .catch((err) => {
        opts.onerror(err);
      });
  });

  const { callJevEvaluation } = sandbox.__USERSCRIPT_EXPORTS__;
  const info = {
    vocab: tc.target || '',
    meanings: tc.meanings || [],
    sentenceJP: tc.japanese,
    sentenceEN: tc.reference || ''
  };

  const tStart = Date.now();
  const result = await callJevEvaluation(info, tc.draft);
  const totalElapsed = Date.now() - tStart;
  const metrics = result?.metrics || null;

  if (!metrics) {
    throw new Error(`callJevEvaluation returned null metrics for case ${tc.id}`);
  }

  // Fast-path routing calculation according to jpdb-ai.user.js
  let route = 'fallback';
  if (metrics.overall === 10 && metrics.isStrict10Consensus) {
    route = 'flawless_fast_path';
  } else if (metrics.typoFastPathOk) {
    route = 'typo_fast_path';
  } else if (metrics.critiqueFastPathOk && metrics.triggeringConfidence >= 0.75 && metrics.bracketConfidence >= 0.65) {
    route = 'critique_fast_path';
  }

  const isFastPath = route !== 'fallback';

  // Fast path accuracy check
  let fastPathAccurate = false;
  const isErrLabel = tc.label.startsWith('critical_error:') || tc.label === 'moderate_error';
  if (route === 'flawless_fast_path') {
    fastPathAccurate = !isErrLabel && tc.label !== 'typo_only';
  } else if (route === 'typo_fast_path') {
    fastPathAccurate = tc.label === 'typo_only';
  } else if (route === 'critique_fast_path') {
    fastPathAccurate = isErrLabel;
  }

  return {
    caseId: tc.id,
    split: tc.split,
    label: tc.label,
    orderMode: mode,
    seed: mode === 'shuffle_s1' ? SEED_1 : (mode === 'shuffle_s2' ? SEED_2 : null),
    optionOrderUsed,
    answers: metrics.rawAnswers,
    overall: metrics.overall,
    bracketLabel: metrics.bracketLabel,
    isStrict10Consensus: metrics.isStrict10Consensus,
    route,
    isFastPath,
    fastPathAccurate,
    triggeringConfidence: metrics.triggeringConfidence,
    bracketConfidence: metrics.bracketConfidence,
    minConfidence: metrics.minConfidence,
    avgConfidence: metrics.avgConfidence,
    dynamicCritique: metrics.dynamicCritique || '',
    critiqueSource: metrics.critiqueSource || '',
    fastPathBlockers: metrics.fastPathBlockers || [],
    latencyMs: requestElapsed || totalElapsed
  };
}

async function runBenchmark(options = {}) {
  const userscriptPath = options.userscriptPath || path.join(__dirname, '..', 'jpdb-ai.user.js');
  const casesPath = options.casesPath || path.join(__dirname, 'bench', 'cases.json');
  const outputPath = options.outputPath || path.join(__dirname, 'bench', 'benchmark_run.json');
  const concurrency = options.concurrency || 2;

  const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
  const { exportedCode } = loadUserscriptExports(userscriptPath);

  const orderModes = [
    'original_r1',
    'original_r2',
    'original_r3',
    'reversed',
    'shuffle_s1',
    'shuffle_s2'
  ];

  console.log(`======================================================================`);
  console.log(`🚀 COMPREHENSIVE BENCHMARK RUNNER`);
  console.log(`Cases: ${cases.length} | Conditions: ${orderModes.length} (${orderModes.join(', ')})`);
  console.log(`Total Planned Calls: ${cases.length * orderModes.length}`);
  console.log(`Userscript: ${userscriptPath}`);
  console.log(`Endpoint:   ${config.jevEndpoint} (${config.jevModel})`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`======================================================================\n`);

  // Build task list
  const tasks = [];
  for (const tc of cases) {
    for (const mode of orderModes) {
      tasks.push({ tc, mode });
    }
  }

  const results = [];
  let completed = 0;
  const t0 = Date.now();

  async function worker() {
    while (tasks.length > 0) {
      const { tc, mode } = tasks.shift();
      try {
        const res = await runSingleTrial(tc, mode, exportedCode);
        results.push(res);
        completed++;
        if (completed % 20 === 0 || completed === cases.length * orderModes.length) {
          const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
          console.log(`[${completed}/${cases.length * orderModes.length}] (${elapsedSec}s) Last: ${tc.id} [${mode}] -> ${res.overall}/10 (${res.route}) in ${res.latencyMs}ms`);
        }
      } catch (err) {
        console.error(`Error on case ${tc.id} [${mode}]:`, err.message);
        throw err;
      }
    }
  }

  const pool = [];
  for (let i = 0; i < concurrency; i++) {
    pool.push(worker());
  }
  await Promise.all(pool);

  const totalTime = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nAll trials completed in ${totalTime}s! Saving to ${outputPath}...`);
  const payloadHash = require('crypto').createHash('sha256').update(fs.readFileSync(casesPath, 'utf8') + exportedCode).digest('hex');
  const userscriptSha256 = require('crypto').createHash('sha256').update(fs.readFileSync(userscriptPath, 'utf8')).digest('hex');
  let gitHead = '';
  try {
    gitHead = require('child_process').execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch (e) {}

  const metadata = {
    timestamp: new Date().toISOString(),
    gitHead,
    userscriptSha256,
    endpoint: config.jevEndpoint,
    model: config.jevModel,
    casesPath,
    payloadHash,
    totalTimeSec: totalTime,
    concurrency,
    casesCount: cases.length,
    conditionsCount: orderModes.length
  };
  fs.writeFileSync(outputPath, JSON.stringify({ metadata, results }, null, 2), 'utf8');
  console.log(`Saved ${results.length} trial results.`);
  return results;
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

async function runLatencyAB(options = {}) {
  const baseScriptPath = options.baselineUserscript || path.join(__dirname, '..', 'jpdb-ai.user.js');
  const varScriptPath = options.variantUserscript || path.join(__dirname, '..', 'jpdb-ai.user.js');
  const casesPath = options.casesPath || path.join(__dirname, 'bench', 'cases.json');
  const pairsCount = options.pairsCount || 100;
  const outputPath = options.outputPath || path.join(__dirname, 'bench', 'latency_ab_results.json');

  console.log(`======================================================================`);
  console.log(`⏱️ INTERLEAVED LATENCY A/B RUNNER (Concurrency 1)`);
  console.log(`Baseline script: ${baseScriptPath}`);
  console.log(`Variant script:  ${varScriptPath}`);
  console.log(`Pairs:           ${pairsCount} (${pairsCount * 2} calls total, alternating sequentially)`);
  console.log(`Cases file:      ${casesPath}`);
  console.log(`Endpoint:        ${config.jevEndpoint} (${config.jevModel})`);
  console.log(`======================================================================\n`);

  const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
  const { exportedCode: baseExported } = loadUserscriptExports(baseScriptPath);
  const { exportedCode: varExported } = loadUserscriptExports(varScriptPath);

  const callLog = [];
  const baseLatencies = [];
  const varLatencies = [];

  const tStartAll = Date.now();

  for (let i = 0; i < pairsCount; i++) {
    const tc = cases[i % cases.length];

    // Arm A (Baseline)
    const t0A = Date.now();
    const resA = await runSingleTrial(tc, 'original_r1', baseExported);
    const latA = resA.latencyMs;
    baseLatencies.push(latA);
    callLog.push({
      pairIndex: i,
      arm: 'baseline',
      caseId: tc.id,
      timestamp: new Date().toISOString(),
      latencyMs: latA
    });

    // Arm B (Variant)
    const t0B = Date.now();
    const resB = await runSingleTrial(tc, 'original_r1', varExported);
    const latB = resB.latencyMs;
    varLatencies.push(latB);
    callLog.push({
      pairIndex: i,
      arm: 'variant',
      caseId: tc.id,
      timestamp: new Date().toISOString(),
      latencyMs: latB
    });

    if ((i + 1) % 10 === 0 || i === pairsCount - 1) {
      const elapsed = ((Date.now() - tStartAll) / 1000).toFixed(1);
      console.log(`[Pair ${i + 1}/${pairsCount}] (${elapsed}s) Last pair: Base ${latA}ms | Var ${latB}ms (${tc.id})`);
    }
  }

  const baseP50 = computeQuantile(baseLatencies, 0.50);
  const baseP95 = computeQuantile(baseLatencies, 0.95);
  const varP50 = computeQuantile(varLatencies, 0.50);
  const varP95 = computeQuantile(varLatencies, 0.95);

  const p95Ceiling = Math.min(400, baseP95 * 1.15);
  const p95DeltaPct = ((varP95 - baseP95) / baseP95) * 100;
  const pass = varP95 <= 400 && varP95 <= baseP95 * 1.15;

  console.log(`\n======================================================================`);
  console.log(`📊 LATENCY A/B SUMMARY (${pairsCount} pairs = ${pairsCount * 2} calls):`);
  console.log(`Baseline Arm: p50 = ${baseP50.toFixed(1)} ms | p95 = ${baseP95.toFixed(1)} ms`);
  console.log(`Variant  Arm: p50 = ${varP50.toFixed(1)} ms | p95 = ${varP95.toFixed(1)} ms`);
  console.log(`p95 Difference: ${p95DeltaPct >= 0 ? '+' : ''}${p95DeltaPct.toFixed(2)}% (Ceiling: ≤ 400 ms and ≤ +15.0%)`);
  console.log(`Result:         ${pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`======================================================================\n`);

  const summary = {
    timestamp: new Date().toISOString(),
    baselineUserscript: baseScriptPath,
    variantUserscript: varScriptPath,
    pairsCount,
    totalCalls: pairsCount * 2,
    baseP50,
    baseP95,
    varP50,
    varP95,
    p95Ceiling,
    p95DeltaPct,
    pass,
    callLog
  };

  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`A/B latency results saved to ${outputPath}`);
  return summary;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const outArg = args.find(a => a.startsWith('--out='))?.split('=')[1];
  const casesArg = args.find(a => a.startsWith('--casesPath=') || a.startsWith('--cases='))?.split('=')[1];
  const concArg = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '2', 10);
  const userScriptArg = args.find(a => a.startsWith('--userscript='))?.split('=')[1] || (args.includes('--userscript') ? args[args.indexOf('--userscript') + 1] : null);

  if (args.includes('--latency-ab')) {
    const baseScript = args.find(a => a.startsWith('--baseline-userscript='))?.split('=')[1] || (args.includes('--baseline-userscript') ? args[args.indexOf('--baseline-userscript') + 1] : userScriptArg);
    const varScript = args.find(a => a.startsWith('--variant-userscript='))?.split('=')[1] || (args.includes('--variant-userscript') ? args[args.indexOf('--variant-userscript') + 1] : userScriptArg);
    const pairs = parseInt(args.find(a => a.startsWith('--pairs='))?.split('=')[1] || '100', 10);
    runLatencyAB({
      baselineUserscript: baseScript,
      variantUserscript: varScript,
      casesPath: casesArg,
      pairsCount: pairs,
      outputPath: outArg
    }).catch(err => {
      console.error('Latency A/B fatal error:', err);
      process.exit(1);
    });
  } else {
    runBenchmark({ outputPath: outArg, casesPath: casesArg, concurrency: concArg, userscriptPath: userScriptArg }).catch(err => {
      console.error('Benchmark fatal error:', err);
      process.exit(1);
    });
  }
}

module.exports = { runBenchmark, runSingleTrial, runLatencyAB, transformQuestions };
