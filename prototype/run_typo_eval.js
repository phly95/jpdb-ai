const { callJev } = require('./jev_client');
const { buildQuestionsWithTypo, evaluateFastPathEligibility } = require('./test_typo_suite');

const testCases = [
  {
    name: "Typo: 'now' for 'not' (知らなくていいです)",
    card: {
      vocab: "いい",
      sentenceJP: "それは知らなくていいです。",
      sentenceEN: "You don't need to know that."
    },
    userDraft: "it's okay to now know that",
    expectedTypo: true,
    expectedTypoWord: "now"
  },
  {
    name: "Typo: 'here' for 'hear' (聞こえる)",
    card: {
      vocab: "聞こえる",
      sentenceJP: "鳥の声が聞こえる。",
      sentenceEN: "I can hear the sound of birds."
    },
    userDraft: "I can here the sound of birds.",
    expectedTypo: true,
    expectedTypoWord: "here"
  },
  {
    name: "Clean translation (no typo): Flawless",
    card: {
      vocab: "見つけた",
      sentenceJP: "公園で可愛い猫を見つけた。",
      sentenceEN: "I discovered a cute cat in the park."
    },
    userDraft: "I found a cute cat at the park.",
    expectedTypo: false
  },
  {
    name: "Genuine grammatical error: Causative-passive inversion",
    card: {
      vocab: "待たされた",
      sentenceJP: "病院で２時間も待たされた。",
      sentenceEN: "I was kept waiting for two whole hours at the hospital."
    },
    userDraft: "I made them wait for two hours at the hospital.",
    expectedTypo: false,
    expectedError: "causative_passive_inverted"
  },
  {
    name: "Genuine grammatical error: Benefactive reversal",
    card: {
      vocab: "やってくれた",
      sentenceJP: "友達が私の宿題をやってくれた。",
      sentenceEN: "My friend did my homework for me."
    },
    userDraft: "I did homework for my friend.",
    expectedTypo: false,
    expectedError: "recipient_reversed_self_vs_other"
  }
];

async function run() {
  console.log("=== RUNNING JEV TYPO & SAFE FAST-PATH SUITE ===\n");
  let passed = 0;

  for (const tc of testCases) {
    const t0 = Date.now();
    const state = {
      japanese_sentence: tc.card.sentenceJP,
      user_translation: tc.userDraft,
      reference_translation: tc.card.sentenceEN,
      target_vocabulary: tc.card.vocab
    };

    const questions = buildQuestionsWithTypo(tc.card, tc.userDraft, []);
    const res = await callJev(state, questions);
    const elapsed = Date.now() - t0;
    const ans = res.answers || {};

    const typoChoice = ans.english_typo_check?.choice;
    const typoConf = ans.english_typo_check?.confidence ?? 0;
    const typoWord = ans.suspected_typo_word?.choice;
    const bracket = ans.grade_bracket?.choice;
    const bracketConf = ans.grade_bracket?.confidence ?? 0;

    let dynamicCritique = '';
    if (typoChoice === 'likely_english_typo_with_sound_comprehension') {
      dynamicCritique = typoWord && typoWord !== 'none'
        ? `Your Japanese comprehension is sound, but "**${typoWord}**" appears to be an English typo.`
        : `Your Japanese comprehension is sound, but the draft contains an English keyboard typo.`;
    } else {
      dynamicCritique = 'Identified grammatical discrepancy.';
    }

    const overall = (bracket === '10_flawless') ? 10 : (bracket === '8_minor_nuance' ? 8 : (bracket === '5_moderate_error' ? 5 : 3));
    const fastPath = evaluateFastPathEligibility(ans, overall, dynamicCritique);

    console.log(`Test: ${tc.name}`);
    console.log(`  Draft: "${tc.userDraft}"`);
    console.log(`  Typo Check: ${typoChoice} (conf: ${typoConf})`);
    console.log(`  Suspected Typo Word: ${typoWord}`);
    console.log(`  Bracket: ${bracket} (conf: ${bracketConf}) -> Overall: ${overall}/10`);
    console.log(`  Fast-Path Eligible: ${fastPath.eligible} (${fastPath.reason})`);
    console.log(`  Elapsed: ${elapsed}ms\n`);

    if (tc.expectedTypo && typoChoice === 'likely_english_typo_with_sound_comprehension' && (!tc.expectedTypoWord || typoWord === tc.expectedTypoWord)) {
      passed++;
    } else if (!tc.expectedTypo && typoChoice !== 'likely_english_typo_with_sound_comprehension') {
      passed++;
    }
  }

  console.log(`=== RESULTS: ${passed}/${testCases.length} tests passed ===`);
}

run().catch(console.error);
