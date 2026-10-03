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
  generateVocabExplanation
} = sandbox.__USERSCRIPT_EXPORTS__;

console.log('======================================================================');
console.log('🧪 1. SHIPPED NUMERAL & COUNTER CONSISTENCY UNIT TESTS');
console.log('======================================================================');

const numeralTests = [
  {
    jp: "病院で２時間も待たされた。",
    ref: "I was kept waiting for 2 whole hours at the hospital.",
    student: "I was kept waiting for two hours.",
    expectedStatus: "clean",
    label: "Matching numbers (2 vs two)"
  },
  {
    jp: "病院で２時間も待たされた。",
    ref: "I was kept waiting for 2 whole hours at the hospital.",
    student: "I was kept waiting for five hours.",
    expectedStatus: "mismatch",
    label: "Mismatched numbers (2 vs 5)"
  },
  {
    jp: "病院で２時間も待たされた。",
    ref: "I was kept waiting for 2 whole hours at the hospital.",
    student: "I was kept waiting at the hospital.",
    expectedStatus: "unverified",
    label: "Missing number (omitted 2) -> unverified (routes to LLM)"
  },
  {
    jp: "会議室には二十五人います。",
    ref: "There are twenty-five people in the meeting room.",
    student: "There are 25 people in the meeting room.",
    expectedStatus: "clean",
    label: "Compound Kanji 二十五 -> 25 vs 25"
  },
  {
    jp: "この本は三百円です。",
    ref: "This book is 300 yen.",
    student: "This book is three hundred yen.",
    expectedStatus: "clean",
    label: "Compound Kanji 三百 -> 300 vs three hundred"
  },
  {
    jp: "一方で、彼は何も言わなかった。",
    ref: "On the other hand, no one said anything.",
    student: "On the other hand, no one said anything.",
    expectedStatus: "clean",
    label: "Idiom 一方で + pronoun 'no one' (non-numeric)"
  },
  {
    jp: "30分待った。",
    ref: "I waited half an hour.",
    student: "I waited half an hour.",
    expectedStatus: "clean",
    label: "Paraphrase: 30分 vs 'half an hour'"
  },
  {
    jp: "三時に会いましょう。",
    ref: "Let's meet at 3 o'clock.",
    student: "Let's meet at 5 o'clock.",
    expectedStatus: "mismatch",
    label: "Direct contradiction: 三時 vs 5 o'clock"
  },
  {
    jp: "りんごを三つ買った。",
    ref: "I bought three apples.",
    student: "I bought a few apples.",
    expectedStatus: "unverified",
    label: "Unparsed paraphrase: 三つ vs 'a few' -> unverified (routes to LLM, no false critique)"
  },
  {
    jp: "ひとつ、ふたりで分けよう。",
    ref: "One item, let's share it between two people.",
    student: "Let the two of us share this one.",
    expectedStatus: "clean",
    label: "Kana numerals: ひとつ (1), ふたり (2) vs 'one', 'two'"
  }
];

let numeralPassed = 0;
for (const nt of numeralTests) {
  const res = assessNumeralStatus(nt.jp, nt.student, nt.ref);
  const ok = res.status === nt.expectedStatus;
  if (ok) numeralPassed++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${nt.label} -> got status '${res.status}', expected '${nt.expectedStatus}'`);
}
console.log(`Numeral check result: ${numeralPassed}/${numeralTests.length} passed.\n`);

console.log('======================================================================');
console.log('🧪 2. SHIPPED VOCAB EXPLAINER GATES & HEDGING UNIT TESTS');
console.log('======================================================================');

// Test 2a: Single meaning card omits applied_meaning
const singleMeaningCard = {
  vocab: "猫",
  meanings: ["cat"],
  sentenceJP: "可愛い猫がいる。",
  sentenceEN: "There is a cute cat."
};
const singleQuestions = buildVocabExplanationQuestions(singleMeaningCard);
const hasAppliedMeaningInSingle = 'applied_meaning' in singleQuestions;
console.log(`  [${!hasAppliedMeaningInSingle ? 'PASS' : 'FAIL'}] Single-meaning card omits applied_meaning: ${!hasAppliedMeaningInSingle}`);

// Test 2b: Polysemous card includes applied_meaning
const polyMeaningCard = {
  vocab: "かける",
  meanings: ["to hang", "to put on", "to spend"],
  sentenceJP: "眼鏡をかけた。",
  sentenceEN: "I put on glasses."
};
const polyQuestions = buildVocabExplanationQuestions(polyMeaningCard);
const hasAppliedMeaningInPoly = 'applied_meaning' in polyQuestions;
console.log(`  [${hasAppliedMeaningInPoly ? 'PASS' : 'FAIL'}] Polysemous card includes applied_meaning: ${hasAppliedMeaningInPoly}`);

// Test 2c: Empty meanings card aborts fast-path (role is null)
const emptyMeaningsCard = {
  vocab: "謎",
  meanings: [],
  sentenceJP: "謎の言葉。",
  sentenceEN: "A mystery word."
};
const emptyMeaningsGen = generateVocabExplanation({
  grammatical_role: { choice: 'demonstrative_determiner', confidence: 0.90 }
}, emptyMeaningsCard, '謎');
console.log(`  [${emptyMeaningsGen.role === null ? 'PASS' : 'FAIL'}] Empty-meaning card aborts fast-path: ${emptyMeaningsGen.role === null}`);

// Test 2d: Rejection of other_or_unclear
const unclearGen = generateVocabExplanation({
  grammatical_role: { choice: 'other_or_unclear', confidence: 0.90 }
}, singleMeaningCard, '猫');
console.log(`  [${unclearGen.role === null ? 'PASS' : 'FAIL'}] other_or_unclear rejects fast-path (role is null): ${unclearGen.role === null}`);

// Test 2e: Rejection below 0.65 threshold
const lowConfGen = generateVocabExplanation({
  grammatical_role: { choice: 'direct_object', confidence: 0.52 }
}, singleMeaningCard, '猫');
console.log(`  [${lowConfGen.role === null ? 'PASS' : 'FAIL'}] role confidence 0.52 rejects fast-path (< 0.65): ${lowConfGen.role === null}`);

// Test 2f: Rejection of unrecognized role
const unkRoleGen = generateVocabExplanation({
  grammatical_role: { choice: 'unrecognized_role', confidence: 0.95 }
}, singleMeaningCard, '猫');
console.log(`  [${unkRoleGen.role === null ? 'PASS' : 'FAIL'}] unrecognized role rejects fast-path: ${unkRoleGen.role === null}`);

// Test 2g: connected_target_word confidence gate (<0.70 ignored)
const lowConfTargetWordGen = generateVocabExplanation({
  grammatical_role: { choice: 'direct_object', confidence: 0.90 },
  connected_target_word: { choice: '食べた', confidence: 0.55 }
}, singleMeaningCard, '猫');
console.log(`  [${lowConfTargetWordGen.targetWord === null ? 'PASS' : 'FAIL'}] connected_target_word confidence 0.55 ignored (< 0.70): ${lowConfTargetWordGen.targetWord === null}`);

// Test 2h: pedagogical_tip_type confidence gate (<0.70 fallbacks to standard_usage)
const lowConfTipGen = generateVocabExplanation({
  grammatical_role: { choice: 'direct_object', confidence: 0.90 },
  pedagogical_tip_type: { choice: 'passive_adversative_nuance', confidence: 0.50 }
}, singleMeaningCard, '猫');
console.log(`  [${lowConfTipGen.markdown.includes('Focus on how the attached particle') ? 'PASS' : 'FAIL'}] pedagogical_tip_type confidence 0.50 fallbacks to standard: ${lowConfTipGen.markdown.includes('Focus on how the attached particle')}`);

// Test 2i: Hedging prose at 0.72 confidence
const midConfGen = generateVocabExplanation({
  grammatical_role: { choice: 'direct_object', confidence: 0.72 }
}, singleMeaningCard, '猫');
const hasHedge = midConfGen.markdown.includes('likely functioning as');
console.log(`  [${hasHedge ? 'PASS' : 'FAIL'}] role confidence 0.72 hedges with 'likely functioning as': ${hasHedge}`);

// Test 2j: Confident prose at 0.92 confidence
const highConfGen = generateVocabExplanation({
  grammatical_role: { choice: 'direct_object', confidence: 0.92 }
}, singleMeaningCard, '猫');
const hasConfidentProse = highConfGen.markdown.includes('functioning as') && !highConfGen.markdown.includes('likely functioning as');
console.log(`  [${hasConfidentProse ? 'PASS' : 'FAIL'}] role confidence 0.92 uses confident 'functioning as': ${hasConfidentProse}\n`);

console.log('======================================================================');
console.log('🚀 3. LIVE JEV SYSTEM ONE EXECUTION (HARDENED GATES)');
console.log('======================================================================');

async function testLiveJev() {
  console.log('\n--- Live Test 1: Polysemous Vocab (眼鏡をかける) ---');
  const t0 = Date.now();
  const polyQuestions = buildVocabExplanationQuestions(polyMeaningCard);
  const state1 = {
    japanese_sentence: polyMeaningCard.sentenceJP,
    target_vocabulary: polyMeaningCard.vocab,
    target_meanings: polyMeaningCard.meanings,
    reference_translation: polyMeaningCard.sentenceEN,
    words: ['眼鏡を', 'かけた']
  };

  const res1 = await callJev(state1, polyQuestions);
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
  const konoQuestions = buildVocabExplanationQuestions(konoCard);
  const state2 = {
    japanese_sentence: konoCard.sentenceJP,
    target_vocabulary: konoCard.vocab,
    target_meanings: konoCard.meanings,
    reference_translation: konoCard.sentenceEN,
    words: ['私は', 'この', '言葉の', '意味を', '知りません']
  };

  const res2 = await callJev(state2, konoQuestions);
  if (res2 && res2.answers) {
    console.log(`  Role: ${res2.answers.grammatical_role?.choice} (conf: ${res2.answers.grammatical_role?.confidence})`);
    console.log(`  Applied meaning asked? ${'applied_meaning' in konoQuestions}`);
    const gen2 = generateVocabExplanation(res2.answers, konoCard, 'この');
    console.log(`  Explanation snippet:\n    ${gen2.markdown.split('\n').filter(l => l.trim()).join('\n    ')}`);
  }

  console.log('\n======================================================================');
  console.log('✅ ALL TEST RUN CHECKS COMPLETE');
  console.log('======================================================================');
}

testLiveJev().catch(console.error);
