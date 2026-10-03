// Live translation rating fixture evaluation against real Jev-1.13
// Exercises the complete callJevEvaluation pipeline from jpdb-ai.user.js

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { callJev, config } = require('./jev_client');

const src = fs.readFileSync(path.join(__dirname, '..', 'jpdb-ai.user.js'), 'utf8');

// Inject exports for callJevEvaluation and gmPost stubbing
const exportedCode = src.replace(/\}\)\(\);\s*$/, `
  if (typeof globalThis.__USERSCRIPT_EXPORTS__ !== 'undefined') {
    globalThis.__USERSCRIPT_EXPORTS__.callJevEvaluation = callJevEvaluation;
    globalThis.__USERSCRIPT_EXPORTS__.parseJevScores = parseJevScores;
    globalThis.__USERSCRIPT_EXPORTS__.buildVocabExplanationQuestions = buildVocabExplanationQuestions;
    globalThis.__USERSCRIPT_EXPORTS__.generateVocabExplanation = generateVocabExplanation;
  }
})();
`);

function createSandbox(onPost) {
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
    GM_xmlhttpRequest: (opts) => {
      onPost(opts);
    },
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    __USERSCRIPT_EXPORTS__: {}
  };
  sandbox.window = sandbox;
  return sandbox;
}

const testCases = [
  {
    name: "1. Known-Good Translation (Expect 10/10 Flawless)",
    info: {
      vocab: "言葉",
      meanings: ["word", "language", "phrase"],
      sentenceJP: "私にはこの言葉の意味が分かりません。",
      sentenceEN: "I don't understand the meaning of this word."
    },
    draft: "I don't understand the meaning of this word.",
    expectedRoute: "10_flawless"
  },
  {
    name: "2. Passive Reversal (Active translated instead of passive)",
    info: {
      vocab: "待たせる",
      meanings: ["to keep waiting"],
      sentenceJP: "病院で二時間も待たされた。",
      sentenceEN: "I was kept waiting for two hours at the hospital."
    },
    draft: "I made them wait for two hours at the hospital.",
    expectedRoute: "critique_or_llm"
  },
  {
    name: "3. Polarity Flip (Affirmative translated instead of negative)",
    info: {
      vocab: "聞こえる",
      meanings: ["to be heard", "to be audible"],
      sentenceJP: "何も聞こえなかった。",
      sentenceEN: "I couldn't hear anything."
    },
    draft: "I heard everything.",
    expectedRoute: "critique_or_llm"
  },
  {
    name: "4. Numeral Error (Contradicting number)",
    info: {
      vocab: "待たせる",
      meanings: ["to keep waiting"],
      sentenceJP: "病院で二時間も待たされた。",
      sentenceEN: "I was kept waiting for two whole hours at the hospital."
    },
    draft: "I was kept waiting for five hours at the hospital.",
    expectedRoute: "numeral_mismatch"
  },
  {
    name: "5. Grounded Typo (now for not)",
    info: {
      vocab: "知る",
      meanings: ["to know", "to understand"],
      sentenceJP: "それを知らなくても大丈夫です。",
      sentenceEN: "It's okay not to know that."
    },
    draft: "It's okay to now know that.",
    expectedRoute: "typo_fast_path"
  },
  {
    name: "6. Acceptable Paraphrase (Clause nominalization)",
    info: {
      vocab: "この",
      meanings: ["this (close to speaker)"],
      sentenceJP: "私はこの言葉が何を意味するのか知りません。",
      sentenceEN: "I don't know what this word means."
    },
    draft: "I don't know the meaning of this word.",
    expectedRoute: "10_flawless_or_safe"
  }
];

async function runLiveEvaluation() {
  console.log('======================================================================');
  console.log('🚀 LIVE JEV-1.13 TRANSLATION RATING EVALUATION');
  console.log(`Endpoint: ${config.jevEndpoint} | Model: ${config.jevModel}`);
  console.log('======================================================================\n');

  for (const tc of testCases) {
    console.log(`----------------------------------------------------------------------`);
    console.log(`Case: ${tc.name}`);
    console.log(`JP:    "${tc.info.sentenceJP}"`);
    console.log(`Ref:   "${tc.info.sentenceEN}"`);
    console.log(`Draft: "${tc.draft}"`);

    let requestBody = null;
    const sandbox = createSandbox((opts) => {
      requestBody = JSON.parse(opts.data);
      // Execute the request via jev_client.postJson
      callJev(requestBody.state, requestBody.questions)
        .then((res) => {
          opts.onload({
            status: 200,
            responseText: JSON.stringify({ answers: res.answers, usage: res.usage })
          });
        })
        .catch((err) => {
          opts.onerror(err);
        });
    });

    vm.createContext(sandbox);
    vm.runInContext(exportedCode, sandbox);
    const { callJevEvaluation } = sandbox.__USERSCRIPT_EXPORTS__;

    const t0 = Date.now();
    const result = await callJevEvaluation(tc.info, tc.draft);
    const elapsed = Date.now() - t0;
    const m = result.metrics;

    if (!m) {
      console.log(`❌ No metrics returned (call failed or timed out) in ${elapsed}ms\n`);
      continue;
    }

    console.log(`Elapsed: ${elapsed}ms`);
    console.log(`Overall: ${m.overall}/10 (${m.bracketLabel})`);
    console.log(`Strict 10 Consensus: ${m.isStrict10Consensus}`);
    console.log(`Failed Guards:        ${JSON.stringify(m.failedGuards || [])}`);
    console.log(`Fast-path Blockers:   ${JSON.stringify(m.fastPathBlockers || [])}`);
    console.log(`Critique Source:      ${m.critiqueSource || 'none'} (triggeringConf: ${m.triggeringConfidence})`);
    console.log(`Dynamic Critique:     ${m.dynamicCritique || '(none)'}`);
    console.log(`Numeral Status:       ${m.hasNumeralMismatch ? 'MISMATCH' : 'clean'}`);
    console.log(`Grounded Typo:        ${m.isTypo ? `YES ("${m.typoWord}")` : 'no'}`);

    // Compute route:
    let route = 'llm_fallback';
    if (m.overall === 10 && m.isStrict10Consensus) {
      route = '10_flawless_fast_path';
    } else if (m.isTypo && m.typoConfidence >= 0.80) {
      route = 'typo_fast_path';
    } else if (m.dynamicCritique && m.triggeringConfidence >= 0.75 && m.bracketConfidence >= 0.65 && (!m.fastPathBlockers || m.fastPathBlockers.length === 0)) {
      route = 'critique_fast_path';
    }
    console.log(`⚡ Final Route:        ${route}\n`);
  }

  console.log('======================================================================');
  console.log('✅ LIVE EVALUATION RUN COMPLETE');
  console.log('======================================================================');
}

runLiveEvaluation().catch(console.error);
