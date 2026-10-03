const fs = require('fs');
const vm = require('vm');
const path = require('path');

function loadUserscriptExports(scriptPath) {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const exportedCode = src.replace(/\}\)\(\);\s*$/, `
    if (typeof globalThis.__USERSCRIPT_EXPORTS__ !== 'undefined') {
      globalThis.__USERSCRIPT_EXPORTS__.callJevEvaluation = callJevEvaluation;
      globalThis.__USERSCRIPT_EXPORTS__.parseJevScores = parseJevScores;
    }
  })();
  `);
  return exportedCode;
}

function createSandbox(exportedCode, captureCallback) {
  const sandbox = {
    location: { pathname: '/review' },
    document: { readyState: 'loading', addEventListener: () => {} },
    window: {},
    GM_getValue: (k, d) => {
      if (k === 'jpdb_ai_jev_endpoint') return 'https://openrouter.ai/api/alpha/decisions';
      if (k === 'jpdb_ai_jev_key') return 'dummy-key';
      if (k === 'jpdb_ai_jev_model') return 'typesafe/jev-1.13';
      return d;
    },
    GM_setValue: () => {},
    GM_registerMenuCommand: () => {},
    GM_xmlhttpRequest: (opts) => {
      captureCallback(opts);
      opts.onload({
        status: 200,
        responseText: JSON.stringify({ answers: {}, usage: {} })
      });
    },
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

async function getPayload(exportedCode, tc) {
  let capturedOpts = null;
  const sandbox = createSandbox(exportedCode, (opts) => {
    capturedOpts = opts;
  });

  const info = {
    vocab: tc.target || '',
    meanings: tc.meanings || [],
    sentenceJP: tc.japanese,
    sentenceEN: tc.reference || ''
  };

  const { callJevEvaluation } = sandbox.__USERSCRIPT_EXPORTS__;
  await callJevEvaluation(info, tc.draft);

  if (!capturedOpts) {
    throw new Error(`No request captured for case ${tc.id}`);
  }

  return {
    url: capturedOpts.url,
    headers: capturedOpts.headers,
    body: JSON.parse(capturedOpts.data),
    rawBody: capturedOpts.data
  };
}

async function main() {
  const baseCode = loadUserscriptExports(path.join(__dirname, '../baseline_phase2_5e3ef48.tmp.js'));
  const variantCode = loadUserscriptExports(path.join(__dirname, '../../jpdb-ai.user.js'));

  const casesData = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
  const hardData = JSON.parse(fs.readFileSync(path.join(__dirname, 'hard_cases.json'), 'utf8'));
  const allCases = [...casesData, ...hardData];

  console.log(`Analyzing payload diff across all ${allCases.length} cases (106 test catalog + 44 hard split)...`);

  let totalQBefore = 0;
  let totalQAfter = 0;
  const qCountPerCaseBefore = [];
  const qCountPerCaseAfter = [];

  const bytesBefore = [];
  const bytesAfter = [];

  const unexpectedDifferences = [];

  let sampleBeforeJson = null;
  let sampleAfterJson = null;
  let sampleCaseId = null;

  for (const tc of allCases) {
    const pBase = await getPayload(baseCode, tc);
    const pVar = await getPayload(variantCode, tc);

    const qKeysBase = Object.keys(pBase.body.questions);
    const qKeysVar = Object.keys(pVar.body.questions);

    totalQBefore += qKeysBase.length;
    totalQAfter += qKeysVar.length;
    qCountPerCaseBefore.push(qKeysBase.length);
    qCountPerCaseAfter.push(qKeysVar.length);

    const bLenBase = Buffer.byteLength(pBase.rawBody, 'utf8');
    const bLenVar = Buffer.byteLength(pVar.rawBody, 'utf8');
    bytesBefore.push(bLenBase);
    bytesAfter.push(bLenVar);

    // Verify state matches exactly
    if (JSON.stringify(pBase.body.state) !== JSON.stringify(pVar.body.state)) {
      unexpectedDifferences.push({ caseId: tc.id, type: 'state_difference' });
    }

    // Verify model, reasoning_effort, etc
    if (pBase.body.model !== pVar.body.model) {
      unexpectedDifferences.push({ caseId: tc.id, type: 'model_difference' });
    }

    // Verify question keys diff:
    // Base must have 'predicate_mood_and_voice'
    // Var must NOT have 'predicate_mood_and_voice'
    // Var must have 'predicate_voice', 'predicate_tense', 'predicate_modality', 'predicate_action'
    // All other question keys must be identical
    const baseWithoutPred = qKeysBase.filter(k => k !== 'predicate_mood_and_voice').sort();
    const varWithoutNewPred = qKeysVar.filter(k => !['predicate_voice', 'predicate_tense', 'predicate_modality', 'predicate_action'].includes(k)).sort();

    if (JSON.stringify(baseWithoutPred) !== JSON.stringify(varWithoutNewPred)) {
      unexpectedDifferences.push({
        caseId: tc.id,
        type: 'question_keys_mismatch',
        baseKeys: qKeysBase,
        varKeys: qKeysVar
      });
    }

    // Check that all other questions are identical in definition
    for (const k of baseWithoutPred) {
      if (JSON.stringify(pBase.body.questions[k]) !== JSON.stringify(pVar.body.questions[k])) {
        unexpectedDifferences.push({
          caseId: tc.id,
          type: `question_definition_changed_${k}`
        });
      }
    }

    if (!sampleCaseId) {
      sampleCaseId = tc.id;
      sampleBeforeJson = {
        predicate_mood_and_voice: pBase.body.questions.predicate_mood_and_voice
      };
      sampleAfterJson = {
        predicate_voice: pVar.body.questions.predicate_voice,
        predicate_tense: pVar.body.questions.predicate_tense,
        predicate_modality: pVar.body.questions.predicate_modality,
        predicate_action: pVar.body.questions.predicate_action
      };
    }
  }

  function stats(arr) {
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const sum = arr.reduce((a, b) => a + b, 0);
    const mean = (sum / arr.length).toFixed(1);
    return { min, mean, max, sum };
  }

  const beforeByteStats = stats(bytesBefore);
  const afterByteStats = stats(bytesAfter);

  // Per case counts: check if all cases have the same count diff
  const allDelta3 = qCountPerCaseAfter.every((count, idx) => count - qCountPerCaseBefore[idx] === 3);

  console.log('\n--- PAYLOAD COMPARISON SUMMARY ---');
  console.log(`Total cases evaluated: ${allCases.length}`);
  console.log(`Unexpected differences: ${unexpectedDifferences.length}`);
  if (unexpectedDifferences.length > 0) {
    console.log(JSON.stringify(unexpectedDifferences.slice(0, 5), null, 2));
  }

  console.log(`\nQuestions before: total ${totalQBefore}, min ${Math.min(...qCountPerCaseBefore)}, max ${Math.max(...qCountPerCaseBefore)} (avg ${(totalQBefore / allCases.length).toFixed(2)}/case)`);
  console.log(`Questions after:  total ${totalQAfter}, min ${Math.min(...qCountPerCaseAfter)}, max ${Math.max(...qCountPerCaseAfter)} (avg ${(totalQAfter / allCases.length).toFixed(2)}/case)`);
  console.log(`Every case net questions added: ${allDelta3 ? '+3 (exactly 4 added, 1 removed)' : 'MISMATCH'}`);

  console.log(`\nByte size before: min=${beforeByteStats.min}, mean=${beforeByteStats.mean}, max=${beforeByteStats.max} bytes`);
  console.log(`Byte size after:  min=${afterByteStats.min}, mean=${afterByteStats.mean}, max=${afterByteStats.max} bytes`);
  console.log(`Byte size diff (mean): +${(afterByteStats.mean - beforeByteStats.mean).toFixed(1)} bytes (+${(((afterByteStats.mean - beforeByteStats.mean) / beforeByteStats.mean) * 100).toFixed(2)}%)`);

  console.log(`\nSample Case: ${sampleCaseId}`);
  console.log('--- BEFORE (Phase 2 affected question): ---');
  console.log(JSON.stringify(sampleBeforeJson, null, 2));
  console.log('--- AFTER (E1 affected questions): ---');
  console.log(JSON.stringify(sampleAfterJson, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
