// Test Suite for Hardened Jev System One Architecture & Fast-Paths
// Tests the exact functions shipped in jpdb-ai.user.js directly via VM sandbox

const fs = require('fs');
const vm = require('vm');
const { callJev } = require('./jev_client');

// Extract the exact shipped functions from jpdb-ai.user.js
const src = fs.readFileSync(__dirname + '/../jpdb-ai.user.js', 'utf8');
const exportedCode = src.replace(/\}\)\(\);\s*$/, `
  if (typeof globalThis.__USERSCRIPT_EXPORTS__ !== 'undefined') {
    globalThis.__USERSCRIPT_EXPORTS__.parseCompoundKanjiNum = parseCompoundKanjiNum;
    globalThis.__USERSCRIPT_EXPORTS__.extractJapaneseNumbers = extractJapaneseNumbers;
    globalThis.__USERSCRIPT_EXPORTS__.extractEnglishNumbers = extractEnglishNumbers;
    globalThis.__USERSCRIPT_EXPORTS__.assessNumeralStatus = assessNumeralStatus;
    globalThis.__USERSCRIPT_EXPORTS__.buildVocabExplanationQuestions = buildVocabExplanationQuestions;
    globalThis.__USERSCRIPT_EXPORTS__.generateVocabExplanation = generateVocabExplanation;
    globalThis.__USERSCRIPT_EXPORTS__.parseJevScores = parseJevScores;
  }
})();
`);

const sandbox = {
  location: { pathname: '/review' },
  document: { readyState: 'loading', addEventListener: () => {} },
  window: {},
  GM_getValue: () => '',
  GM_setValue: () => {},
  GM_registerMenuCommand: () => {},
  console: console,
  __USERSCRIPT_EXPORTS__: {}
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(exportedCode, sandbox);

const {
  parseCompoundKanjiNum,
  extractJapaneseNumbers,
  extractEnglishNumbers,
  assessNumeralStatus,
  buildVocabExplanationQuestions,
  generateVocabExplanation,
  parseJevScores
} = sandbox.__USERSCRIPT_EXPORTS__;

console.log('======================================================================');
console.log('🧪 1. ADVERSARIAL NUMERAL & COUNTER ENGINE UNIT TESTS (CLAUDE TABLE)');
console.log('======================================================================');

const adversarialNumeralTests = [
  {
    jp: "これは私にはちょっと高い",
    student: "This one is a bit expensive",
    ref: "This is a bit expensive.",
    expectedStatus: "clean",
    label: "Idiom にはちょっと (contains に/はち) + 'This one' (pronoun)"
  },
  {
    jp: "三千円",
    student: "It's 3,000 yen",
    ref: "3000 yen",
    expectedStatus: "clean",
    label: "三千 (3000) vs comma-formatted '3,000'"
  },
  {
    jp: "二千円",
    student: "two thousand yen",
    ref: "2000 yen",
    expectedStatus: "clean",
    label: "二千 (2000) vs 'two thousand'"
  },
  {
    jp: "一万二千円",
    student: "12,000 yen",
    ref: "12000 yen",
    expectedStatus: "clean",
    label: "一万二千 (12000) vs comma-formatted '12,000'"
  },
  {
    jp: "二人で…",
    student: "The two of us used this one",
    ref: "The two of us...",
    expectedStatus: "clean",
    label: "二人 (2) vs 'two' with 'this one' (pronoun)"
  },
  {
    jp: "田中さんが来た",
    student: "Three people including Tanaka came",
    ref: "Tanaka came",
    expectedStatus: "mismatch",
    label: "田中さん (さん != 3) vs hallucinated 'Three people'"
  },
  {
    jp: "ありがとうございます",
    student: "five times over",
    ref: "Thank you very much",
    expectedStatus: "mismatch",
    label: "ございます (ご != 5) vs hallucinated 'five times'"
  },
  {
    jp: "三月五日",
    student: "March 7th",
    ref: "March 5th",
    expectedStatus: "mismatch",
    label: "三月五日 (3, 5) vs ordinal contradiction 'March 7th' (7)"
  },
  {
    jp: "りんごを三つ買った。",
    student: "I bought a few apples.",
    ref: "I bought three apples.",
    expectedStatus: "unverified",
    label: "三つ (3) vs unparsed paraphrase 'a few' -> unverified (routes to LLM, no false critique)"
  },
  {
    jp: "30分待った。",
    student: "I waited half an hour.",
    ref: "I waited for 30 minutes.",
    expectedStatus: "clean",
    label: "30分 (30) vs duration idiom 'half an hour' (30)"
  }
];

let numeralPassed = 0;
for (const nt of adversarialNumeralTests) {
  const res = assessNumeralStatus(nt.jp, nt.student, nt.ref);
  const ok = res.status === nt.expectedStatus;
  if (ok) numeralPassed++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${nt.label} -> got '${res.status}', expected '${nt.expectedStatus}'`);
}
console.log(`Numeral check result: ${numeralPassed}/${adversarialNumeralTests.length} passed.\n`);

console.log('======================================================================');
console.log('🧪 2. SHIPPED PARSE_JEV_SCORES & DILUTION-PROOF TRIGGERING TESTS');
console.log('======================================================================');

// Test 2a: Dilution prevention on passive error
// Summary flags passive error at 0.45, but voice question says "correct" at 0.98
const dilutionAnswers = {
  grade_bracket: { choice: '5_moderate_error', confidence: 0.90 },
  is_flawless: { noul: 0.10, confidence: 0.90 },
  sentence_critique_summary: { choice: 'passive_voice_reversed', confidence: 0.45 },
  predicate_mood_and_voice: { choice: 'correct_or_not_applicable', confidence: 0.98 },
  benefactive_direction: { choice: 'correct_or_not_applicable', confidence: 0.99 },
  severity_rating: { choice: 'moderate_error', confidence: 0.90 }
};

const dilutionParsed = parseJevScores(dilutionAnswers, ['食べられた'], '食べる', 'I ate it', 'It was eaten', '食べられた');
const isTriggeringDiluted = dilutionParsed.triggeringConfidence === 0.98;
const isTriggeringAccurate = dilutionParsed.triggeringConfidence === 0.45;
const isCritiqueSourceAccurate = dilutionParsed.critiqueSource === 'sentence_critique_summary';
console.log(`  [${isTriggeringAccurate ? 'PASS' : 'FAIL'}] Triggering confidence bound strictly to error question (0.45, NOT diluted 0.98): ${dilutionParsed.triggeringConfidence}`);
console.log(`  [${isCritiqueSourceAccurate ? 'PASS' : 'FAIL'}] Critique source recorded as 'sentence_critique_summary': ${dilutionParsed.critiqueSource}`);
const passesFastPathGate = dilutionParsed.triggeringConfidence >= 0.75;
console.log(`  [${!passesFastPathGate ? 'PASS' : 'FAIL'}] Low-confidence critique (0.45) rejected by >= 0.75 fast-path gate: ${!passesFastPathGate}`);

// Test 2b: Excerpt contrast min-confidence gate (< 0.70 aborted)
const lowConfExcerptAnswers = {
  grade_bracket: { choice: '8_minor_nuance', confidence: 0.85 },
  flawed_student_excerpt: { choice: 'walked', confidence: 0.95 },
  correct_reference_excerpt: { choice: 'ran', confidence: 0.90 },
  contrast_relation: { choice: 'minor_word_choice_difference', confidence: 0.45 }
};
const excerptParsed = parseJevScores(lowConfExcerptAnswers, ['走った'], '走る', 'I walked', 'I ran', '走った');
const excerptAborted = excerptParsed.critiqueSource !== 'contrast_relation';
console.log(`  [${excerptAborted ? 'PASS' : 'FAIL'}] Excerpt contrast with weak relation (0.45) aborts contrast branch: ${excerptAborted}`);

// Test 2c: Fail-closed strict 10/10 consensus tests
const perfectAnswers = {
  grade_bracket: { choice: '10_flawless', confidence: 0.92 },
  is_flawless: { noul: 0.95, confidence: 0.92 },
  sentence_critique_summary: { choice: 'no_flaws_accurate', confidence: 0.88 },
  predicate_mood_and_voice: { choice: 'correct_or_not_applicable', confidence: 0.99 },
  benefactive_direction: { choice: 'correct_or_not_applicable', confidence: 0.99 },
  severity: { score: 3.8, confidence: 0.95 }
};
const perfectParsed = parseJevScores(perfectAnswers, ['猫がいる'], '猫', 'There is a cat', 'There is a cat', '猫がいる');
console.log(`  [${perfectParsed.isStrict10Consensus && perfectParsed.overall === 10 ? 'PASS' : 'FAIL'}] Perfect translation achieves strict 10/10 consensus: ${perfectParsed.overall}/10`);

// Incomplete consensus (missing summary)
const incompleteAnswers = { ...perfectAnswers };
delete incompleteAnswers.sentence_critique_summary;
const incompleteParsed = parseJevScores(incompleteAnswers, ['猫がいる'], '猫', 'There is a cat', 'There is a cat', '猫がいる');
console.log(`  [${!incompleteParsed.isStrict10Consensus && incompleteParsed.overall !== 10 ? 'PASS' : 'FAIL'}] Missing summary critique fails closed (blocks 10/10): overall=${incompleteParsed.overall}\n`);

console.log('======================================================================');
console.log('🧪 3. SHIPPED VOCAB EXPLAINER GATES & TIGHTENED CRITERIA TESTS');
console.log('======================================================================');

const polyMeaningCard = {
  vocab: "かける",
  meanings: ["to hang", "to put on", "to spend"],
  sentenceJP: "眼鏡をかけた。",
  sentenceEN: "I put on glasses."
};
const singleMeaningCard = {
  vocab: "猫",
  meanings: ["cat"],
  sentenceJP: "可愛い猫がいる。",
  sentenceEN: "There is a cute cat."
};

const polyQuestions = buildVocabExplanationQuestions(polyMeaningCard);
const criteriaText = polyQuestions.grammatical_role.criteria.other_or_unclear;
const isTightened = criteriaText.includes('Use ONLY if the word has an idiosyncratic syntactic role');
console.log(`  [${isTightened ? 'PASS' : 'FAIL'}] other_or_unclear criteria is strictly tightened: ${isTightened}`);

// Test 3b: Confident prose at 0.81 confidence (>= 0.80 threshold)
const highConfGen = generateVocabExplanation({
  grammatical_role: { choice: 'direct_object', confidence: 0.81 }
}, singleMeaningCard, '猫');
const hasConfidentProse = highConfGen.markdown.includes('functioning as') && !highConfGen.markdown.includes('likely functioning as');
console.log(`  [${hasConfidentProse ? 'PASS' : 'FAIL'}] role confidence 0.81 uses confident 'functioning as': ${hasConfidentProse}`);

// Test 3c: Hedged prose at 0.72 confidence
const midConfGen = generateVocabExplanation({
  grammatical_role: { choice: 'direct_object', confidence: 0.72 }
}, singleMeaningCard, '猫');
const hasHedge = midConfGen.markdown.includes('likely functioning as');
console.log(`  [${hasHedge ? 'PASS' : 'FAIL'}] role confidence 0.72 hedges with 'likely functioning as': ${hasHedge}\n`);

console.log('======================================================================');
console.log('🚀 4. LIVE JEV SYSTEM ONE EXECUTION (HARDENED GATES & TIGHT CRITERIA)');
console.log('======================================================================');

async function testLiveJev() {
  console.log('\n--- Live Test 1: Polysemous Vocab (眼鏡をかける) ---');
  const t0 = Date.now();
  const polyQ = buildVocabExplanationQuestions(polyMeaningCard);
  const state1 = {
    japanese_sentence: polyMeaningCard.sentenceJP,
    target_vocabulary: polyMeaningCard.vocab,
    target_meanings: polyMeaningCard.meanings,
    reference_translation: polyMeaningCard.sentenceEN,
    words: ['眼鏡を', 'かけた']
  };

  const res1 = await callJev(state1, polyQ);
  const elapsed1 = Date.now() - t0;
  console.log(`  Jev Response time: ${elapsed1}ms`);
  if (res1 && res1.answers) {
    const roleAns = res1.answers.grammatical_role;
    const senseAns = res1.answers.applied_meaning;
    console.log(`  Role: ${roleAns?.choice} (conf: ${roleAns?.confidence})`);
    console.log(`  Applied sense: ${senseAns?.choice} (conf: ${senseAns?.confidence})`);

    const gen = generateVocabExplanation(res1.answers, polyMeaningCard, 'かける');
    console.log(`  Generated explanation role: ${gen.role}`);
    console.log(`  Explanation snippet:\n    ${gen.markdown.split('\n').filter(l => l.trim()).join('\n    ')}`);
  }

  console.log('\n--- Live Test 2: Pre-noun Determiner (この言葉) ---');
  const konoCard = {
    vocab: "この",
    meanings: ["this (close to speaker)"],
    sentenceJP: "私はこの言葉の意味を知りません。",
    sentenceEN: "I don't know the meaning of this word."
  };
  const konoQ = buildVocabExplanationQuestions(konoCard);
  const state2 = {
    japanese_sentence: konoCard.sentenceJP,
    target_vocabulary: konoCard.vocab,
    target_meanings: konoCard.meanings,
    reference_translation: konoCard.sentenceEN,
    words: ['私は', 'この', '言葉の', '意味を', '知りません']
  };

  const res2 = await callJev(state2, konoQ);
  if (res2 && res2.answers) {
    console.log(`  Role: ${res2.answers.grammatical_role?.choice} (conf: ${res2.answers.grammatical_role?.confidence})`);
    const gen2 = generateVocabExplanation(res2.answers, konoCard, 'この');
    console.log(`  Explanation snippet:\n    ${gen2.markdown.split('\n').filter(l => l.trim()).join('\n    ')}`);
  }

  console.log('\n======================================================================');
  console.log('✅ ALL TEST RUN CHECKS COMPLETE');
  console.log('======================================================================');
}

testLiveJev().catch(console.error);
