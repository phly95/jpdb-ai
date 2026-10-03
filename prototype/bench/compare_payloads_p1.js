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
    headerNames: Object.keys(capturedOpts.headers || {}).sort(),
    body: JSON.parse(capturedOpts.data)
  };
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function getInstructionText(q) {
  if (!q || !q.instructions) return '';
  if (typeof q.instructions === 'string') return q.instructions;
  if (typeof q.instructions === 'object') {
    return JSON.stringify(q.instructions);
  }
  return String(q.instructions);
}

async function main() {
  const baseCode = loadUserscriptExports(path.join(__dirname, '../baseline_6ae92ae.tmp.js'));
  const headCode = loadUserscriptExports(path.join(__dirname, '../../jpdb-ai.user.js'));

  const casesData = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
  const hardData = JSON.parse(fs.readFileSync(path.join(__dirname, 'hard_cases.json'), 'utf8'));

  const allCases = [...casesData, ...hardData];
  console.log(`Total cases to compare: ${allCases.length} (cases.json: ${casesData.length}, hard_cases.json: ${hardData.length})`);

  let countStateDiff = 0;
  let countQIdDiff = 0;
  let countOptionsDiff = 0;
  let countInstructionsDiff = 0;
  let countModelEndpointHeadersReasoningDiff = 0;

  const changedInstructionsMap = {}; // questionKey -> { before, after, count }
  const unexpectedDiffs = [];

  for (const tc of allCases) {
    const basePayload = await getPayload(baseCode, tc);
    const headPayload = await getPayload(headCode, tc);

    // (a) state keys and values
    const stateEqual = deepEqual(basePayload.body.state, headPayload.body.state);
    if (!stateEqual) {
      countStateDiff++;
      unexpectedDiffs.push({ id: tc.id, field: 'state', base: basePayload.body.state, head: headPayload.body.state });
    }

    // (b) list of question IDs, in order
    const baseQIds = Object.keys(basePayload.body.questions || {});
    const headQIds = Object.keys(headPayload.body.questions || {});
    const qIdsEqual = deepEqual(baseQIds, headQIds);
    if (!qIdsEqual) {
      countQIdDiff++;
      unexpectedDiffs.push({ id: tc.id, field: 'question_ids', base: baseQIds, head: headQIds });
    }

    // (c) each question's option labels, in order
    let optionsEqual = true;
    for (const qId of headQIds) {
      const bQ = basePayload.body.questions[qId];
      const hQ = headPayload.body.questions[qId];
      if (bQ && hQ) {
        if (!deepEqual(bQ.options || null, hQ.options || null)) {
          optionsEqual = false;
          unexpectedDiffs.push({ id: tc.id, field: `options:${qId}`, base: bQ.options, head: hQ.options });
        }
      }
    }
    if (!optionsEqual) {
      countOptionsDiff++;
    }

    // (d) each question's instruction text
    let instructionsEqual = true;
    for (const qId of headQIds) {
      const bQ = basePayload.body.questions[qId];
      const hQ = headPayload.body.questions[qId];
      if (bQ && hQ) {
        const bText = getInstructionText(bQ);
        const hText = getInstructionText(hQ);
        if (bText !== hText) {
          instructionsEqual = false;
          // Normalize dynamic word question key to pattern word_${i}_sense
          const groupKey = qId.startsWith('word_') && qId.endsWith('_sense') ? 'word_${i}_sense' : qId;
          if (!changedInstructionsMap[groupKey]) {
            changedInstructionsMap[groupKey] = { before: bText, after: hText, count: 0, examples: [] };
          }
          changedInstructionsMap[groupKey].count++;
          if (changedInstructionsMap[groupKey].examples.length < 1) {
            changedInstructionsMap[groupKey].examples.push({ caseId: tc.id, qId, before: bText, after: hText });
          }
        }
      }
    }
    if (!instructionsEqual) {
      countInstructionsDiff++;
    }

    // (e) model, endpoint, headers (names only), reasoning effort
    const modelEqual = basePayload.body.model === headPayload.body.model;
    const urlEqual = basePayload.url === headPayload.url;
    const headersEqual = deepEqual(basePayload.headerNames, headPayload.headerNames);
    const reasoningEqual = basePayload.body.reasoning_effort === headPayload.body.reasoning_effort;

    if (!modelEqual || !urlEqual || !headersEqual || !reasoningEqual) {
      countModelEndpointHeadersReasoningDiff++;
      unexpectedDiffs.push({
        id: tc.id,
        field: 'conn/meta',
        base: { model: basePayload.body.model, url: basePayload.url, headers: basePayload.headerNames, reasoning: basePayload.body.reasoning_effort },
        head: { model: headPayload.body.model, url: headPayload.url, headers: headPayload.headerNames, reasoning: headPayload.body.reasoning_effort }
      });
    }
  }

  console.log('\n--- FIELD-BY-FIELD DIFFERENCE COUNTS (Total cases: ' + allCases.length + ') ---');
  console.log(`(a) state keys and values:                     ${countStateDiff} / ${allCases.length} differing`);
  console.log(`(b) question IDs list and order:               ${countQIdDiff} / ${allCases.length} differing`);
  console.log(`(c) question option labels and order:          ${countOptionsDiff} / ${allCases.length} differing`);
  console.log(`(d) question instruction text:                 ${countInstructionsDiff} / ${allCases.length} differing`);
  console.log(`(e) model, endpoint, headers, reasoning_effort: ${countModelEndpointHeadersReasoningDiff} / ${allCases.length} differing`);

  console.log('\n--- CHANGED INSTRUCTION GROUPS ---');
  for (const [key, info] of Object.entries(changedInstructionsMap)) {
    console.log(`Question key pattern: "${key}" (differs in ${info.count} questions)`);
    const ex = info.examples[0];
    console.log(`  Example case ID: ${ex.caseId} (question: ${ex.qId})`);
    console.log(`  BEFORE (6ae92ae):\n    ${ex.before}`);
    console.log(`  AFTER (HEAD):\n    ${ex.after}\n`);
  }

  console.log('--- UNEXPECTED DIFFS ---');
  const nonInstructionDiffs = unexpectedDiffs.filter(d => !d.field.startsWith('instruction'));
  if (nonInstructionDiffs.length === 0) {
    console.log('None. Only instruction text of target_vocab_handling and word_${i}_sense differs across all 150 cases.');
  } else {
    console.log(`Found ${nonInstructionDiffs.length} unexpected differences:`, JSON.stringify(nonInstructionDiffs, null, 2));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
