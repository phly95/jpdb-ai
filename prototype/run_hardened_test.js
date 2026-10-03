// Hardened test suite for the Jev System One fast paths in jpdb-ai.user.js  (v1.0.92)
//
// Loads the REAL shipped userscript in a VM sandbox and calls its real functions (no re-implementations).
//   node run_hardened_test.js                 # offline: numeral engine, scoring/routing, vocab verification
//   node run_hardened_test.js --live          # additionally runs live Jev calls (needs ./jev_client.js exporting callJev)
//   node run_hardened_test.js path/to/jpdb-ai.user.js
//
// Notes vs. the previous harness:
//  * buildVocabExplanationQuestions(info, cleanTarget, words) is now called with its REAL signature. The old harness
//    called it with only `info`, so every "live" vocab question asked about the role of the literal string "undefined".
//  * Fixtures use the schema-accurate option names from callJevEvaluation (e.g. correct_benefactive_or_not_applicable).
//  * Exit code is non-zero if any offline assertion fails.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const argPath = process.argv.slice(2).find((a) => a.endsWith('.js'));
const candidates = [argPath, process.env.USERSCRIPT_PATH, path.join(__dirname, 'jpdb-ai.user.js'), path.join(__dirname, '..', 'jpdb-ai.user.js')].filter(Boolean);
const scriptPath = candidates.find((p) => fs.existsSync(p));
if (!scriptPath) { console.error('Cannot find jpdb-ai.user.js. Pass its path as an argument.'); process.exit(2); }

function loadShipped(file) {
  const src = fs.readFileSync(file, 'utf8');
  const names = ['parseCompoundKanjiNum', 'extractJapaneseNumbers', 'extractEnglishNumbers', 'extractEnglishNumberInfo', 'assessNumeralStatus', 'isGroundedTypo', 'levenshtein', 'parseJevScores', 'buildVocabExplanationQuestions', 'generateVocabExplanation', 'verifyVocabRole', 'verifyConnectedWord', 'isTipRelevant', 'callJevEvaluation'];
  const code = src.replace(/\}\)\(\);\s*$/, `
  globalThis.__X__={${names.map((n) => `${n}: typeof ${n}!=='undefined'?${n}:undefined`).join(',')}};
})();`);
  const sb = {
    location: { pathname: '/review' },
    document: { readyState: 'loading', addEventListener() {} },
    GM_getValue: (k) => {
      if (k === 'jpdb_ai_jev_endpoint') return 'https://openrouter.ai/api/alpha/decisions';
      if (k === 'jpdb_ai_jev_model') return 'typesafe/jev-1.13';
      return '';
    },
    GM_setValue() {},
    GM_registerMenuCommand() {},
    GM_xmlhttpRequest: (opts) => {
      try { sb.__lastCapturedRequest = JSON.parse(opts.data); } catch (e) {}
      opts.onload && opts.onload({ status: 200, responseText: JSON.stringify({ answers: {} }) });
    },
    console, Intl, __X__: null
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb);
  sb.__X__.__sb = sb;
  return sb.__X__;
}
const X = loadShipped(scriptPath);
console.log('Testing:', scriptPath, '\n');
const results = [];

results.push((function () {
console.log('==================== Numeral engine ====================');
let pass=0,fail=0;
const T=(jp,st,ref,exp,label)=>{const r=X.assessNumeralStatus(jp,st,ref);const ok=r.status===exp;ok?pass++:fail++;console.log(`[${ok?'PASS':'FAIL'}] ${(label||jp).padEnd(44)} got ${r.status.padEnd(10)} want ${exp}`)};
// --- Gemini's 10
T('これは私にはちょっと高い','This one is a bit expensive','This is a bit expensive.','clean','にはちょっと + "this one"');
T('三千円',"It's 3,000 yen",'3000 yen','clean','三千 vs 3,000');
T('二千円','two thousand yen','2000 yen','clean','二千 vs two thousand');
T('一万二千円','12,000 yen','12000 yen','clean','一万二千 vs 12,000');
T('二人で…','The two of us used this one','The two of us...','clean','二人 vs two + "this one"');
T('田中さんが来た','Three people including Tanaka came','Tanaka came','mismatch','さん != 3, hallucinated Three');
T('ありがとうございます','five times over','Thank you very much','mismatch','ございます != 5');
T('三月五日','March 7th','March 5th','mismatch','ordinal digits contradiction');
T('りんごを三つ買った。','I bought a few apples.','I bought three apples.','unverified','三つ vs "a few"');
T('30分待った。','I waited half an hour.','I waited for 30 minutes.','clean','30分 vs half an hour');
// --- new false-mismatch repros from v1.0.91
T('ちょっと待って','Wait a second','Wait a moment','clean','"a second" is not an ordinal');
T('最初は驚いた','At first I was surprised','I was surprised at the beginning','clean','"at first"');
T('百二十円','It costs one hundred and twenty yen','It costs 120 yen','clean','hundred AND twenty');
T('自分のベストを尽くす',"Do one's best",'Do your best','clean','"one\'s"');
T('三万円です','It is 30,000 yen','It is 30,000 yen','clean','三万');
T('3万5000円です','It is 35,000 yen','It is 35,000 yen','clean','3万5000 composite');
T('3万5000円です','It is 36,000 yen','It is 35,000 yen','mismatch','3万5000 vs 36,000 (real error)');
T('二〇二四年だ','It is 2024','It is 2024','clean','positional kanji year');
T('三時半に会う','Meet at 3:30','Meet at 3:30','clean','三時半');
T('午後三時に会う','Meet at 15:00','Meet at 3 PM','clean','午後三時 vs 15:00');
T('1.5時間かかる','It takes 1.5 hours','It takes 1.5 hours','clean','decimal');
T('思ったとおりだ','It is as I thought','It is just as I thought','clean','とおり not ten');
T('十分待った','I waited long enough','I waited long enough','clean','十分 = enough');
T('千葉に住んでいる','I live in Chiba','I live in Chiba','clean','千葉');
T('半分食べた','I ate half','I ate half of it','clean','半分 not 30');
// --- must still catch real errors
T('三時に会う',"Meet at 5 o'clock",'Meet at 3 o\'clock','mismatch','real: 5 vs 3');
T('りんごが三つある','There are five apples','There are three apples','mismatch','real: five vs three');
T('二千円','It costs 200 yen','It costs 2000 yen','mismatch','real: 200 vs 2000');
T('りんごが三つある','There are apples','There are three apples','unverified','quantity dropped');
T('猫がいる','There is a cat','There is a cat','clean','no numerals anywhere');
T('猫が二匹いる','There are 2 cats','There are two cats','clean','二匹 vs 2');

return { name: 'Numeral engine', pass, fail };
})());

results.push((function () {
console.log('==================== Scoring & fast-path routing ====================');
let pass=0,fail=0;
const ok=(c,l,extra='')=>{c?pass++:fail++;console.log(`[${c?'PASS':'FAIL'}] ${l}${extra?'  -> '+extra:''}`)};

const WORDS=['猫が','好きだ'];
// Schema-accurate "everything is fine" answer set (option names copied from callJevEvaluation)
const clean=(over={})=>({
  grade_bracket:{choice:'10_flawless',confidence:0.92},
  is_flawless:{noul:0.95,confidence:0.92},
  severity:{score:3.8,confidence:0.95},
  sentence_critique_summary:{choice:'no_flaws_accurate',confidence:0.9},
  english_typo_check:{choice:'no_typos_clean_english',confidence:0.95},
  suspected_typo_word:{choice:'none',confidence:0.95},
  predicate_mood_and_voice:{choice:'correct_or_not_applicable',confidence:0.98},
  benefactive_direction:{choice:'correct_benefactive_or_not_applicable',confidence:0.99},
  predicate_complex_conjugation:{choice:'accurate_or_not_stacked',confidence:0.99},
  interrogative_check:{choice:'correct_or_no_interrogative',confidence:0.99},
  question_type_and_scope:{choice:'not_applicable',confidence:0.99},
  polarity_check:{choice:'polarity_preserved',confidence:0.98},
  target_vocab_handling:{choice:'natural_accurate_sense',confidence:0.95},
  word_0_omitted:{noul:0.02},word_0_sense:{choice:'natural_correct_sense',confidence:0.99},word_0_grammar:{choice:'correct_grammar_or_not_applicable',confidence:0.99},
  word_1_omitted:{noul:0.02},word_1_sense:{choice:'natural_correct_sense',confidence:0.99},word_1_grammar:{choice:'correct_grammar_or_not_applicable',confidence:0.99},
  ...over});
const P=(a,o={})=>X.parseJevScores(a,o.words||WORDS,o.tv||'好き',o.draft||'I like cats',o.ref||'I like cats',o.jp||'猫が好きだ');

console.log('--- strict 10/10 is fail-closed ---');
let m=P(clean()); ok(m.overall===10&&m.isStrict10Consensus,'complete, realistic answers -> 10/10');
// Real-world human synonym calibration (67% flawless vs 32% nuance, bracketConf=0.58, summaryConf=0.45):
m=P(clean({
  grade_bracket:{choice:'10_flawless',confidence:0.58,probabilities:{'10_flawless':0.67,'8_minor_nuance':0.32,'5_moderate_error':0.01}},
  sentence_critique_summary:{choice:'no_flaws_accurate',confidence:0.45,probabilities:{'no_flaws_accurate':0.51,'minor_nuance_or_word_choice_difference':0.48}},
  is_flawless:{noul:0.90},
  severity:{score:3.56}
}));
ok(m.overall===10&&m.isStrict10Consensus,'natural synonym entropy split (0.58 conf, 99% top-tier) -> 10/10 fast path');
// Error leakage test (60% flawless vs 40% major error -> topTier < 0.90):
m=P(clean({
  grade_bracket:{choice:'10_flawless',confidence:0.55,probabilities:{'10_flawless':0.60,'3_major_error':0.40}},
  is_flawless:{noul:0.90},
  severity:{score:3.56}
}));
ok(!m.isStrict10Consensus,'error bracket leakage (40% major error) blocks 10/10');
for(const k of ['polarity_check','benefactive_direction','predicate_mood_and_voice','predicate_complex_conjugation','interrogative_check','question_type_and_scope','target_vocab_handling']){
  const a=clean(); delete a[k]; m=P(a); ok(!m.isStrict10Consensus&&m.overall!==10,`missing ${k} blocks 10/10`,`failed=${m.failedGuards}`);
}
m=P(clean({polarity_check:{choice:'polarity_preserved',confidence:0.5}})); ok(!m.isStrict10Consensus,'coin-flip polarity_preserved (0.50) blocks 10/10');
{const a=clean(); delete a.word_0_sense; delete a.word_1_grammar; m=P(a); ok(!m.isStrict10Consensus,'missing per-word answers (50% coverage) blocks 10/10');}

console.log('--- typo shortcut is grounded ---');
m=P(clean({grade_bracket:{choice:'1_fatal_error',confidence:0.9},english_typo_check:{choice:'likely_english_typo_with_sound_comprehension',confidence:0.82},suspected_typo_word:{choice:'none',confidence:0.9},polarity_check:{choice:'polarity_inverted',confidence:0.95},sentence_critique_summary:{choice:'wrong_verb_or_action',confidence:0.9}}),{draft:'I do not like cats'});
ok(!m.isTypo&&!m.typoFastPathOk&&m.overall<=3,'typo claim + fatal bracket + typo word "none" does NOT mask a fatal error',`overall=${m.overall} typo=${m.isTypo}`);
const typoA=(over={},o={})=>P(clean({grade_bracket:{choice:'8_minor_nuance',confidence:0.9},is_flawless:{noul:0.8,confidence:0.9},english_typo_check:{choice:'likely_english_typo_with_sound_comprehension',confidence:0.9},suspected_typo_word:{choice:'now',confidence:0.9},...over}),{draft:'It is okay to now know that',ref:'It is okay to not know that',...o});
m=typoA(); ok(m.isTypo&&m.typoFastPathOk&&m.overall===8,'genuine now/not slip -> typo fast path, 8/10');
m=typoA({suspected_typo_word:{choice:'okay',confidence:0.9}}); ok(!m.isTypo,'named word is in the reference (not a slip) -> not typo');
m=typoA({},{draft:'It is okay to banana know that'}); m=typoA({suspected_typo_word:{choice:'banana',confidence:0.9}},{draft:'It is okay to banana know that'}); ok(!m.isTypo,'named word is not a near-miss of any reference word -> not typo');
m=typoA({grade_bracket:{choice:'5_moderate_error',confidence:0.9}}); ok(!m.isTypo,'bracket says moderate error -> typo shortcut refused');
m=typoA({suspected_typo_word:{choice:'now',confidence:0.5}}); ok(!m.typoFastPathOk,'typo-word confidence 0.50 -> no typo fast path (min of both questions)');

console.log('--- critique text/confidence/severity coherence ---');
m=P(clean({grade_bracket:{choice:'8_minor_nuance',confidence:0.8},word_0_omitted:{noul:0.9}}),{words:['昨日','猫が'],tv:'猫',draft:'I like cats',ref:'I liked cats yesterday',jp:'昨日猫が好きだった'});
ok(m.critiqueSource==='omitted_word'&&!/degree/.test(m.dynamicCritique),'omission text is neutral (no hard-coded "degree nuance")',m.dynamicCritique);
const ex=(st,rf,rel,c=0.9)=>({flawed_student_excerpt:{choice:st,confidence:c},correct_reference_excerpt:{choice:rf,confidence:c},contrast_relation:{choice:rel,confidence:c}});
m=P(clean({grade_bracket:{choice:'1_fatal_error',confidence:0.9},...ex('I like cats','I like cats','word_choice_or_nuance_mismatch')}));
ok(m.excerptComparison===null&&!/rather than "I like cats"\./.test(m.dynamicCritique),'identical excerpts never produce "X rather than X"',m.dynamicCritique);
m=P(clean({grade_bracket:{choice:'1_fatal_error',confidence:0.9},...ex('I like','I really like','word_choice_or_nuance_mismatch')}));
ok(!m.critiqueFastPathOk&&m.fastPathBlockers.includes('critique_undersells_error'),'1/10 score + minor-nuance message is blocked',m.fastPathBlockers.join());
m=P(clean({grade_bracket:{choice:'10_flawless',confidence:0.9},sentence_critique_summary:{choice:'passive_voice_reversed',confidence:0.9}}));
ok(!m.critiqueFastPathOk&&m.fastPathBlockers.includes('error_critique_vs_lenient_bracket'),'"passive reversed" + flawless bracket conflict is blocked',m.fastPathBlockers.join());
m=P(clean({grade_bracket:{choice:'5_moderate_error',confidence:0.9},sentence_critique_summary:{choice:'passive_voice_reversed',confidence:0.45}}));
ok(m.triggeringConfidence===0.45&&!m.critiqueFastPathOk,'summary 0.45 vs "correct" voice 0.98 stays 0.45 and is blocked',`trig=${m.triggeringConfidence}`);
m=P(clean({grade_bracket:{choice:'3_major_error',confidence:0.9},sentence_critique_summary:{choice:'passive_voice_reversed',confidence:0.30},...ex('I told','was told','word_choice_or_nuance_mismatch',0.9)}));
ok(m.critiqueSource==='contrast_relation'&&m.triggeringConfidence<=0.30&&!m.critiqueFastPathOk,'contrast text chosen by a 0.30 summary cannot ride on 0.90 excerpt confidence',`trig=${m.triggeringConfidence}`);
m=P(clean({grade_bracket:{choice:'3_major_error',confidence:0.9},sentence_critique_summary:{choice:'passive_voice_reversed',confidence:0.9},predicate_mood_and_voice:{choice:'passive_vs_active_error',confidence:0.9},...ex('I told him','He was told','passive_vs_active_reversal',0.9)}));
ok(m.critiqueFastPathOk&&m.critiqueKind==='error'&&m.overall===3,'legit, corroborated passive reversal passes the gate',`${m.fastPathBlockers.join()||'no blockers'} | ${m.dynamicCritique.slice(0,70)}`);
m=P(clean({grade_bracket:{choice:'3_major_error',confidence:0.9},...ex('I told','was told','passive_vs_active_reversal',0.45)}));
ok(m.excerptComparison===null&&!m.critiqueFastPathOk,'weak excerpt relation (0.45): no contrast card, no fast path');
m=P(clean({grade_bracket:{choice:'3_major_error',confidence:0.9},sentence_critique_summary:{choice:'passive_voice_reversed',confidence:0.9}}),{draft:'There are five cats',ref:'There are three cats',jp:'猫が三匹いる'});
ok(m.hasNumeralMismatch&&!m.critiqueFastPathOk&&m.fastPathBlockers.includes('numeral_mismatch_unreported'),'numeral mismatch is never hidden behind another critique',m.fastPathBlockers.join());


return { name: 'Scoring & fast-path routing', pass, fail };
})());

results.push((function () {
console.log('==================== Vocab explainer verification ====================');
let pass=0,fail=0;const ok=(c,l,e='')=>{c?pass++:fail++;console.log(`[${c?'PASS':'FAIL'}] ${l}${e?'  -> '+e:''}`)};
const card=(vocab,jp,meanings=['to put on','to hang'])=>({vocab,meanings,sentenceJP:jp,sentenceEN:''});
const A=(role,rc,extra={})=>({grammatical_role:{choice:role,confidence:rc},inflection_form:{choice:'uninflected_noun_or_particle',confidence:0.9},pedagogical_tip_type:{choice:'standard_usage',confidence:0.9},...extra});
const G=(a,c,t)=>X.generateVocabExplanation(a,c,t);

console.log('--- question builder (called with the REAL signature) ---');
let q=X.buildVocabExplanationQuestions(card('かける','眼鏡をかけた。'),'かける',['眼鏡を','かけた']);
ok(/"かける"/.test(q.grammatical_role.instructions)&&!/undefined/.test(JSON.stringify(q)),'target word is injected into the question text, no "undefined"');
ok(!q.attachment_and_particles,'unused attachment_and_particles question no longer sent');
ok(q.applied_meaning&&q.applied_meaning.options.length===2,'polysemous word -> applied_meaning asked');
q=X.buildVocabExplanationQuestions(card('猫','猫がいる。',['cat']),'猫',['猫が','いる']);
ok(!q.applied_meaning,'single meaning -> no degenerate 1-option Choice');

console.log('--- claims must be grounded in the sentence ---');
let g=G(A('direct_object',0.9),card('猫','可愛い猫がいる。',['cat']),'猫');
ok(!g.role&&g.rejectedBy==='claimed_particle_not_present','role=direct_object but が follows 猫 -> rejected to LLM',g.rejectedBy);
g=G(A('grammatical_subject',0.9),card('猫','可愛い猫がいる。',['cat']),'猫');
ok(g.role==='grammatical_subject'&&/marked by the identifier particle \*\*が\*\*/.test(g.markdown),'role=subject and が follows -> accepted');
g=G(A('direct_object',0.9),card('猫','かわいいネコがいる。',['cat']),'猫');
ok(!g.role&&g.rejectedBy==='target_not_found_in_sentence','particle role but target not literally in sentence -> rejected');
g=G(A('main_predicate_verb',0.9,{inflection_form:{choice:'te_form',confidence:0.9}}),card('かける','眼鏡をかけて行く。'),'かける');
ok(!g.role&&g.rejectedBy==='main_predicate_but_non_final_inflection','main_predicate + te_form contradiction -> rejected');
g=G(A('direct_object',0.9,{inflection_form:{choice:'past_ta_form',confidence:0.9}}),card('眼鏡','眼鏡をかけた。',['glasses']),'眼鏡');
ok(!g.role&&g.rejectedBy==='noun_role_but_verb_inflection','noun role + past-tense inflection contradiction -> rejected');
g=G(A('main_predicate_verb',0.9,{inflection_form:{choice:'past_ta_form',confidence:0.9}}),card('かける','眼鏡をかけた。'),'かける');
ok(g.role==='main_predicate_verb'&&/past tense/.test(g.markdown),'plain main verb in past tense -> accepted with inflection');

console.log('--- connected word must be positioned plausibly ---');
const kono=card('この','私はこの言葉の意味を知りません。',['this']);
g=G(A('demonstrative_determiner',0.9,{connected_target_word:{choice:'言葉',confidence:0.9}}),kono,'この');
ok(/modifying the noun \*\*言葉\*\*/.test(g.markdown),'determiner + adjacent noun -> noun named');
g=G(A('demonstrative_determiner',0.9,{connected_target_word:{choice:'意味',confidence:0.9}}),kono,'この');
ok(g.role&&!/意味/.test(g.markdown),'determiner + NON-adjacent noun -> dropped, generic wording');

console.log('--- tips must be relevant ---');
g=G(A('main_predicate_verb',0.9,{pedagogical_tip_type:{choice:'ko_so_a_do_proximity',confidence:0.95},inflection_form:{choice:'past_ta_form',confidence:0.9}}),card('かける','眼鏡をかけた。'),'かける');
ok(!/ko-so-a-do/.test(g.markdown),'ko-so-a-do tip on 眼鏡をかける -> replaced by generic');
g=G(A('demonstrative_determiner',0.9,{pedagogical_tip_type:{choice:'ko_so_a_do_proximity',confidence:0.95}}),kono,'この');
ok(/ko-so-a-do/.test(g.markdown),'ko-so-a-do tip on この -> kept');
g=G(A('main_predicate_verb',0.9,{pedagogical_tip_type:{choice:'give_receive_direction',confidence:0.95},inflection_form:{choice:'past_ta_form',confidence:0.9}}),card('買う','本を買った。'),'買う');
ok(!/favor direction/.test(g.markdown),'give/receive tip with no giving verb in sentence -> replaced');
g=G(A('main_predicate_verb',0.9,{pedagogical_tip_type:{choice:'idiomatic_set_phrase',confidence:0.75},inflection_form:{choice:'past_ta_form',confidence:0.9}}),card('買う','本を買った。'),'買う');
ok(!/idiomatic set phrase/.test(g.markdown),'unverifiable tip needs >=0.85 (0.75 rejected)');

console.log('--- unchanged guarantees ---');
g=G({grammatical_role:{choice:'direct_object',confidence:0.81}},card('猫','猫を見た。',['cat']),'猫'); ok(/functioning as/.test(g.markdown)&&!/likely/.test(g.markdown),'0.81 -> confident prose');
g=G({grammatical_role:{choice:'direct_object',confidence:0.72}},card('猫','猫を見た。',['cat']),'猫'); ok(/likely functioning as/.test(g.markdown),'0.72 -> hedged prose');
g=G({grammatical_role:{choice:'direct_object',confidence:0.6}},card('猫','猫を見た。',['cat']),'猫'); ok(!g.role,'0.60 -> LLM');
g=G(A('direct_object',0.9),{vocab:'猫',meanings:[],sentenceJP:'猫を見た。'},'猫'); ok(!g.role&&g.markdown==='','no scraped meanings -> LLM');

return { name: 'Vocab explainer verification', pass, fail };
})());

async function runAsyncTests() {
  console.log('==================== Grading request state contract ====================');
  let pass = 0, fail = 0;
  const ok = (c, l, extra = '') => { c ? pass++ : fail++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${l}${extra ? '  -> ' + extra : ''}`); };

  const testCases = [
    {
      info: { sentenceJP: '猫が好きです。', vocab: '猫', meanings: ['cat'], sentenceEN: 'I like cats.' },
      draft: 'I like cats.'
    },
    {
      info: { sentenceJP: '昨日、図書館で本を三冊借りた。', vocab: '借りる', meanings: ['to borrow'], sentenceEN: 'Yesterday I borrowed three books at the library.' },
      draft: 'Yesterday I borrowed three books from the library.'
    },
    {
      info: { sentenceJP: 'もう知らない！', vocab: 'もう', meanings: ['already', 'anymore'], sentenceEN: "I don't care anymore!" },
      draft: "I'm done with you!"
    }
  ];

  for (const tc of testCases) {
    await X.callJevEvaluation(tc.info, tc.draft);
    const captured = X.__sb.__lastCapturedRequest;
    if (!captured || !captured.questions || !captured.state) {
      ok(false, `Request captured for ${tc.info.vocab}`, 'No request captured');
      continue;
    }
    const missingKeys = [];
    for (const [qKey, qVal] of Object.entries(captured.questions)) {
      const text = typeof qVal.instructions === 'string' ? qVal.instructions : JSON.stringify(qVal.instructions);
      const matches = text.match(/`([a-zA-Z0-9_]+)`/g) || [];
      for (const m of matches) {
        const key = m.replace(/`/g, '');
        if (!(key in captured.state)) {
          missingKeys.push({ question: qKey, backtickedKey: key });
        }
      }
    }
    ok(missingKeys.length === 0, `All backticked question keys exist in state for "${tc.info.vocab}"`, missingKeys.length ? JSON.stringify(missingKeys) : 'all keys match state');
  }

  results.push({ name: 'Grading request state contract', pass, fail });
}

async function live() {
  let callJev;
  try { ({ callJev } = require('./jev_client')); } catch { console.log('\n(--live requested but ./jev_client.js not found; skipping)'); return; }
  console.log('\n==================== LIVE JEV (informational, not asserted) ====================');
  const cases = [
    { vocab: 'かける', meanings: ['to put on', 'to hang', 'to spend'], jp: '眼鏡をかけた。', en: 'I put on glasses.', words: ['眼鏡を', 'かけた'], clean: 'かける' },
    { vocab: 'この', meanings: ['this (close to speaker)'], jp: '私はこの言葉の意味を知りません。', en: "I don't know the meaning of this word.", words: ['私は', 'この', '言葉の', '意味を', '知りません'], clean: 'この' }
  ];
  for (const c of cases) {
    const card = { vocab: c.vocab, meanings: c.meanings, sentenceJP: c.jp, sentenceEN: c.en };
    const q = X.buildVocabExplanationQuestions(card, c.clean, c.words);           // <- real signature
    const state = { japanese_sentence: c.jp, target_vocabulary: c.vocab, target_meanings: c.meanings, reference_translation: c.en, words: c.words };
    const res = await callJev(state, q);
    const a = res && res.answers;
    if (!a) { console.log(c.vocab, '-> no answers'); continue; }
    const gen = X.generateVocabExplanation(a, card, c.clean);
    console.log(`${c.vocab}: role=${a.grammatical_role?.choice} (${a.grammatical_role?.confidence}) -> ${gen.role ? 'FAST PATH' : 'LLM'}${gen.rejectedBy ? ' [rejected: ' + gen.rejectedBy + ']' : ''}`);
  }
}

(async () => {
  await runAsyncTests();
  console.log('\n==================== SUMMARY ====================');
  let totalFail = 0;
  for (const r of results) { console.log(`${r.fail ? 'FAIL' : 'ok  '} ${r.name}: ${r.pass} passed, ${r.fail} failed`); totalFail += r.fail; }
  if (process.argv.includes('--live')) await live();
  process.exit(totalFail ? 1 : 0);
})();
