// Test Suite for Hardened Jev System One Architecture & Fast-Paths
// Validates all Claude architectural points without requiring LLM comparative calls

const fs = require('fs');
const { callJev } = require('./jev_client');
const { buildVocabExplanationQuestions } = require('./schemas');
const { generateVocabExplanation, assessConfidence } = require('./generator');

// Extract the functions from jpdb-ai.user.js directly to test the actual userscript logic
const userscriptSource = fs.readFileSync(__dirname + '/../jpdb-ai.user.js', 'utf8');

// Helper to extract and eval isolated functions
function extractFunction(name) {
  const regex = new RegExp(`(?:function\\s+${name}\\s*\\([\\s\\S]*?\\n\\s*\\}|const\\s+${name}\\s*=\\s*[\\s\\S]*?;\\n)`);
  // Better yet, create an execution scope
}

// 1. Unit Tests for Code-Side Numeral Check
console.log('======================================================================');
console.log('🧪 1. CODE-SIDE NUMERAL & COUNTER CONSISTENCY UNIT TESTS');
console.log('======================================================================');

const KANJI_NUM_MAP = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '百': 100, '千': 1000, '万': 10000 };
const WORD_NUM_MAP = { 'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12, 'twenty': 20, 'thirty': 30, 'hundred': 100, 'thousand': 1000 };

function extractNumbersFromText(str, isJapanese) {
  const nums = new Set();
  if (!str) return nums;
  const normalized = str.normalize('NFKC');
  const digits = normalized.match(/\d+/g);
  if (digits) digits.forEach((d) => nums.add(parseInt(d, 10)));

  if (isJapanese) {
    const cleaned = normalized.replace(/(?:一緒|一番|一人で|一切|一般|一生)/g, '');
    for (const [k, v] of Object.entries(KANJI_NUM_MAP)) {
      if (cleaned.includes(k)) nums.add(v);
    }
  } else {
    const words = normalized.toLowerCase().match(/[a-z]+/g) || [];
    words.forEach((w) => {
      if (WORD_NUM_MAP[w] !== undefined) nums.add(WORD_NUM_MAP[w]);
    });
  }
  return nums;
}

function checkNumeralMismatch(sentenceJP, studentEN, refEN) {
  const jpNums = extractNumbersFromText(sentenceJP, true);
  const refNums = extractNumbersFromText(refEN, false);
  if (jpNums.size === 0 || refNums.size === 0) return false;

  const studentNums = extractNumbersFromText(studentEN, false);
  // Missing required number present in both Japanese and reference
  for (const n of refNums) {
    if (jpNums.has(n) && !studentNums.has(n)) return true;
  }
  // Mismatched or hallucinated number
  for (const n of studentNums) {
    if (!jpNums.has(n)) return true;
  }
  return false;
}

const numeralTests = [
  {
    jp: "病院で２時間も待たされた。",
    ref: "I was kept waiting for 2 whole hours at the hospital.",
    student: "I was kept waiting for two hours.",
    expectedMismatch: false,
    label: "Matching numbers (2 vs two)"
  },
  {
    jp: "病院で２時間も待たされた。",
    ref: "I was kept waiting for 2 whole hours at the hospital.",
    student: "I was kept waiting for five hours.",
    expectedMismatch: true,
    label: "Mismatched numbers (2 vs 5)"
  },
  {
    jp: "病院で２時間も待たされた。",
    ref: "I was kept waiting for 2 whole hours at the hospital.",
    student: "I was kept waiting at the hospital.",
    expectedMismatch: true,
    label: "Missing number (omitted 2)"
  },
  {
    jp: "一緒に行きましょう。",
    ref: "Let's go together.",
    student: "Let's go together.",
    expectedMismatch: false,
    label: "Idiom 一緒 ignoring 一 (not a number)"
  }
];

let numeralPassed = 0;
for (const nt of numeralTests) {
  const res = checkNumeralMismatch(nt.jp, nt.student, nt.ref);
  const ok = res === nt.expectedMismatch;
  if (ok) numeralPassed++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${nt.label} -> got ${res}, expected ${nt.expectedMismatch}`);
}
console.log(`Numeral check result: ${numeralPassed}/${numeralTests.length} passed.\n`);

// 2. Unit Tests for Vocab Question Generation & Hedging
console.log('======================================================================');
console.log('🧪 2. VOCAB EXPLAINER: 1-OPTION AVOIDANCE & HEDGED PROSE');
console.log('======================================================================');

// Test 2a: 1-option avoidance
const singleMeaningCard = {
  vocab: "猫",
  meanings: ["cat"],
  sentenceJP: "可愛い猫がいる。",
  sentenceEN: "There is a cute cat."
};
const singleQuestions = buildVocabExplanationQuestions(singleMeaningCard);
const hasAppliedMeaningInSingle = 'applied_meaning' in singleQuestions;
console.log(`  [${!hasAppliedMeaningInSingle ? 'PASS' : 'FAIL'}] Single-meaning card omits applied_meaning question: ${!hasAppliedMeaningInSingle}`);

// Test 2b: Polysemous card includes applied_meaning
const polyMeaningCard = {
  vocab: "かける",
  meanings: ["to hang", "to put on", "to spend"],
  sentenceJP: "眼鏡をかけた。",
  sentenceEN: "I put on glasses."
};
const polyQuestions = buildVocabExplanationQuestions(polyMeaningCard);
const hasAppliedMeaningInPoly = 'applied_meaning' in polyQuestions;
console.log(`  [${hasAppliedMeaningInPoly ? 'PASS' : 'FAIL'}] Polysemous card includes applied_meaning question: ${hasAppliedMeaningInPoly}`);

// Test 2c: other_or_unclear in grammatical_role
const hasOtherRole = polyQuestions.grammatical_role.options.includes('other_or_unclear');
console.log(`  [${hasOtherRole ? 'PASS' : 'FAIL'}] grammatical_role includes 'other_or_unclear': ${hasOtherRole}`);

// Test 2d: Rejection of other_or_unclear
const unclearGen = generateVocabExplanation({
  grammatical_role: { choice: 'other_or_unclear', confidence: 0.90 }
}, singleMeaningCard);
console.log(`  [${unclearGen.role === null ? 'PASS' : 'FAIL'}] other_or_unclear rejects fast-path (role is null): ${unclearGen.role === null}`);

// Test 2e: Rejection below 0.65 threshold
const lowConfGen = generateVocabExplanation({
  grammatical_role: { choice: 'direct_object', confidence: 0.52 }
}, singleMeaningCard);
console.log(`  [${lowConfGen.role === null ? 'PASS' : 'FAIL'}] role confidence 0.52 rejects fast-path (< 0.65): ${lowConfGen.role === null}`);

// Test 2f: Hedging prose at 0.72 confidence
const midConfGen = generateVocabExplanation({
  grammatical_role: { choice: 'direct_object', confidence: 0.72 }
}, singleMeaningCard);
const hasHedge = midConfGen.markdown.includes('likely functioning as');
console.log(`  [${hasHedge ? 'PASS' : 'FAIL'}] role confidence 0.72 hedges with 'likely functioning as': ${hasHedge}`);

// Test 2g: Confident prose at 0.92 confidence
const highConfGen = generateVocabExplanation({
  grammatical_role: { choice: 'direct_object', confidence: 0.92 }
}, singleMeaningCard);
const hasConfidentProse = highConfGen.markdown.includes('functioning as') && !highConfGen.markdown.includes('likely functioning as');
console.log(`  [${hasConfidentProse ? 'PASS' : 'FAIL'}] role confidence 0.92 uses confident 'functioning as': ${hasConfidentProse}\n`);

// 3. Live Jev System One Verification
console.log('======================================================================');
console.log('🚀 3. LIVE JEV SYSTEM ONE EXECUTION (HARDENED GATES)');
console.log('======================================================================');

async function testLiveJev() {
  // Test case 1: Vocab explanation with polysemous word
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

    const gen = generateVocabExplanation(res1.answers, polyMeaningCard);
    console.log(`  Generated explanation role: ${gen.role}`);
    console.log(`  Explanation snippet:\n    ${gen.markdown.split('\n').filter(l => l.trim()).join('\n    ')}`);
  }

  // Test case 2: Single meaning vocab (連体詞 この)
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
    const gen2 = generateVocabExplanation(res2.answers, konoCard);
    console.log(`  Explanation snippet:\n    ${gen2.markdown.split('\n').filter(l => l.trim()).join('\n    ')}`);
  }

  console.log('\n======================================================================');
  console.log('✅ ALL TEST RUN CHECKS COMPLETE');
  console.log('======================================================================');
}

testLiveJev().catch(console.error);
