// Comprehensive catalog of Japanese review examples for testing Jev System One vs LLM
module.exports = [
  {
    id: "ex_01_flawless_synonym",
    title: "Flawless Synonym (Direct Translation)",
    mode: "translation_critique",
    category: "Natural Equivalence",
    card: {
      vocab: "見つけた",
      reading: "みつけた",
      meanings: ["found", "discovered"],
      pos: "verb, ichidan",
      sentenceJP: "公園で可愛い猫を見つけた。",
      sentenceEN: "I discovered a cute cat in the park."
    },
    userDraft: "I found a cute cat at the park.",
    notes: "Should be 10/10. 'found' for 'discovered' and 'at' for 'in' are natural synonyms. Demonstrates Jev avoiding LLM pedantic deductions."
  },
  {
    id: "ex_02_flawless_softener",
    title: "Flawless Conversational Softener (〜んだけど)",
    mode: "translation_critique",
    category: "Conversational Nuance",
    card: {
      vocab: "行きたい",
      reading: "いきたい",
      meanings: ["want to go", "wish to go"],
      pos: "adjective, i-adj",
      sentenceJP: "一緒に映画に行きたいんだけど。",
      sentenceEN: "I'd like to go to the movies together, but..."
    },
    userDraft: "I'd love to go see a movie together.",
    notes: "Should be 10/10. 〜んだけど softens the invitation; translating without literal 'but' is native English."
  },
  {
    id: "ex_03_flawless_idiom",
    title: "Flawless Idiomatic Set Phrase (もう知らない)",
    mode: "translation_critique",
    category: "Idiomatic Expression",
    card: {
      vocab: "知らない",
      reading: "しらない",
      meanings: ["don't know", "unaware"],
      pos: "verb",
      sentenceJP: "もう知らない！勝手にして。",
      sentenceEN: "I don't care anymore! Do whatever you want."
    },
    userDraft: "I'm done with you! Do as you please.",
    notes: "Should be 10/10. 'I'm done with you' captures the pragmatic sense of もう知らない far better than literal 'I don't know'."
  },
  {
    id: "ex_04_passive_direct_reversal",
    title: "Direct Passive Reversal (言われた)",
    mode: "translation_critique",
    category: "Passive Voice",
    card: {
      vocab: "言われた",
      reading: "いわれた",
      meanings: ["was told", "to be said"],
      pos: "verb, passive",
      sentenceJP: "先生に宿題をやりなさいと言われた。",
      sentenceEN: "I was told by my teacher to do my homework."
    },
    userDraft: "I told the teacher to do homework.",
    notes: "Fatal agent reversal. The student inverted subject and agent."
  },
  {
    id: "ex_05_passive_adversative",
    title: "Adversative Suffering Passive (雨に降られた)",
    mode: "translation_critique",
    category: "Passive Voice",
    card: {
      vocab: "降られた",
      reading: "ふられた",
      meanings: ["to be rained on", "got caught in rain"],
      pos: "verb, passive",
      sentenceJP: "帰り道に雨に降られた。",
      sentenceEN: "I got caught in the rain on my way home."
    },
    userDraft: "Rain fell on my way home.",
    notes: "Missed suffering nuance (Level 8/10). Translates action but misses adversative impact on speaker."
  },
  {
    id: "ex_06_benefactive_inward",
    title: "Benefactive Inversion (~てくれた)",
    mode: "translation_critique",
    category: "Benefactives",
    card: {
      vocab: "やってくれた",
      reading: "やってくれた",
      meanings: ["did (for me)", "did a favor"],
      pos: "verb, benefactive",
      sentenceJP: "友達が私の宿題をやってくれた。",
      sentenceEN: "My friend did my homework for me."
    },
    userDraft: "I did homework for my friend.",
    notes: "Major reversal (3/10). Inverted who received the favor."
  },
  {
    id: "ex_07_benefactive_outward",
    title: "Benefactive Direction (~てやる)",
    mode: "translation_critique",
    category: "Benefactives",
    card: {
      vocab: "散歩させてやる",
      reading: "さんぽさせてやる",
      meanings: ["walk (the dog)", "do favor of walking"],
      pos: "verb, causative-benefactive",
      sentenceJP: "犬を散歩させてやる。",
      sentenceEN: "I'll take the dog for a walk."
    },
    userDraft: "The dog walked me.",
    notes: "Major reversal (3/10). Confused downward benefactive direction."
  },
  {
    id: "ex_08_modality_potential",
    title: "Potential vs Intent (行ける vs 行く)",
    mode: "translation_critique",
    category: "Modality",
    card: {
      vocab: "行ける",
      reading: "いける",
      meanings: ["can go", "to be able to go"],
      pos: "verb, potential",
      sentenceJP: "明日のパーティーに行けるよ。",
      sentenceEN: "I can go to tomorrow's party."
    },
    userDraft: "I will go to tomorrow's party.",
    notes: "Moderate error (5/10). Ability/potential translated as simple future intent."
  },
  {
    id: "ex_09_modality_conditional_wish",
    title: "Conditional Wish (〜ばいいのに)",
    mode: "translation_critique",
    category: "Modality",
    card: {
      vocab: "いいのに",
      reading: "いいのに",
      meanings: ["I wish", "it would be nice if"],
      pos: "expression",
      sentenceJP: "もっと時間があればいいのに。",
      sentenceEN: "I wish I had more time."
    },
    userDraft: "If I have more time, it is good.",
    notes: "Moderate/Minor error (6/10). Literal conditional missed counterfactual wish nuance."
  },
  {
    id: "ex_10_modality_obligation",
    title: "Obligation Inversion (〜なければならない)",
    mode: "translation_critique",
    category: "Modality",
    card: {
      vocab: "行かなければならない",
      reading: "いかなければならない",
      meanings: ["must go", "have to go"],
      pos: "expression, obligation",
      sentenceJP: "明日早く行かなければならない。",
      sentenceEN: "I have to go early tomorrow."
    },
    userDraft: "I don't have to go early tomorrow.",
    notes: "Fatal error (1/10). Double negative mistaken for negative."
  },
  {
    id: "ex_11_polarity_inverted",
    title: "Polarity Reversal (Negative -> Affirmative)",
    mode: "translation_critique",
    category: "Polarity",
    card: {
      vocab: "食べなかった",
      reading: "たべなかった",
      meanings: ["did not eat"],
      pos: "verb, negative past",
      sentenceJP: "朝ご飯を全然食べなかった。",
      sentenceEN: "I didn't eat any breakfast."
    },
    userDraft: "I ate breakfast completely.",
    notes: "Fatal error (1/10). 全然 + negative missed, polarity inverted."
  },
  {
    id: "ex_12_indefinite_vs_wh",
    title: "Indefinite Pronoun vs Open Question (何か vs 何)",
    mode: "translation_critique",
    category: "Interrogative Scope",
    card: {
      vocab: "何か",
      reading: "なにか",
      meanings: ["something", "anything"],
      pos: "pronoun",
      sentenceJP: "何か冷たいものを飲みたい。",
      sentenceEN: "I want to drink something cold."
    },
    userDraft: "What cold thing do you want to drink?",
    notes: "Major error (3/10). Statement with indefinite pronoun 何か turned into open WH question."
  },
  {
    id: "ex_13_causative_reversal",
    title: "Causative Reversal (食べさせた)",
    mode: "translation_critique",
    category: "Causative Voice",
    card: {
      vocab: "食べさせた",
      reading: "たべさせた",
      meanings: ["made eat", "fed"],
      pos: "verb, causative",
      sentenceJP: "お母さんが子供に野菜を食べさせた。",
      sentenceEN: "The mother made the child eat vegetables."
    },
    userDraft: "The child made the mother eat vegetables.",
    notes: "Major reversal (3/10). Causative agent and patient inverted."
  },
  {
    id: "ex_14_causative_passive",
    title: "Causative-Passive (待たされた)",
    mode: "translation_critique",
    category: "Causative-Passive",
    card: {
      vocab: "待たされた",
      reading: "またされた",
      meanings: ["was kept waiting", "was made to wait"],
      pos: "verb, causative-passive",
      sentenceJP: "病院で二時間も待たされた。",
      sentenceEN: "I was kept waiting for two whole hours at the hospital."
    },
    userDraft: "I made the hospital wait for two hours.",
    notes: "Major reversal (3/10). Inverted causative-passive role."
  },
  {
    id: "ex_15_nuance_kondo",
    title: "Nuance Misfit (今度 - Next Time vs This Time)",
    mode: "translation_critique",
    category: "Lexical Nuance",
    card: {
      vocab: "今度",
      reading: "こんど",
      meanings: ["next time", "another time", "this time"],
      pos: "noun, adverb",
      sentenceJP: "今度、ご飯でも行きましょう。",
      sentenceEN: "Let's go grab a bite sometime soon."
    },
    userDraft: "Let's go eat this time.",
    notes: "Minor nuance (8/10). 'this time' clashes with future invitation sense."
  },
  {
    id: "ex_16_vocab_polysemy_kakeru",
    title: "Polysemy Disambiguation: かける (Put on Glasses)",
    mode: "vocab_explanation",
    category: "Sense Disambiguation",
    card: {
      vocab: "かける",
      reading: "かける",
      meanings: [
        "to hang (e.g. coat)",
        "to spend (time/money)",
        "to put on (glasses)",
        "to make a call (phone)"
      ],
      pos: "verb, ichidan",
      sentenceJP: "急いで眼鏡をかけた。",
      sentenceEN: "I quickly put on my glasses."
    },
    notes: "Should pick Sense 2 (glasses) and main predicate verb."
  },
  {
    id: "ex_17_vocab_polysemy_toru",
    title: "Polysemy Disambiguation: 取る (Take a Photo)",
    mode: "vocab_explanation",
    category: "Sense Disambiguation",
    card: {
      vocab: "取った",
      reading: "とった",
      meanings: [
        "to take (in hand)",
        "to take (a photo)",
        "to remove / take off",
        "to obtain / earn"
      ],
      pos: "verb, godan",
      sentenceJP: "みんなで記念写真を撮った。",
      sentenceEN: "We took a commemorative photo together."
    },
    notes: "Should pick Sense 1 (photo) and direct object attachment."
  },
  {
    id: "ex_18_vocab_polysemy_deru",
    title: "Polysemy Disambiguation: 出る (Answer Phone)",
    mode: "vocab_explanation",
    category: "Sense Disambiguation",
    card: {
      vocab: "出た",
      reading: "でた",
      meanings: [
        "to exit / leave",
        "to appear (on TV)",
        "to answer (the phone)",
        "to attend (meeting)"
      ],
      pos: "verb, ichidan",
      sentenceJP: "電話が鳴ったが、誰も出なかった。",
      sentenceEN: "The phone rang, but nobody answered."
    },
    notes: "Should pick Sense 2 (answer phone) in negative past form."
  },
  {
    id: "ex_19_vocab_adversative_passive",
    title: "Adversative Passive Explanation (降られた)",
    mode: "vocab_explanation",
    category: "Syntactic Function",
    card: {
      vocab: "降られた",
      reading: "ふられた",
      meanings: ["to be rained on", "to be dumped", "to have rain fall"],
      pos: "verb, passive",
      sentenceJP: "帰り道に雨に降られた。",
      sentenceEN: "I got caught in the rain on my way home."
    },
    notes: "Should identify passive form and pedagogical tip for suffering passive."
  },
  {
    id: "ex_20_vocab_particle_to_quote",
    title: "Quotative Attachment (〜と言う)",
    mode: "vocab_explanation",
    category: "Particle Attachment",
    card: {
      vocab: "言った",
      reading: "いった",
      meanings: ["said", "stated", "told"],
      pos: "verb, godan",
      sentenceJP: "彼が「もう帰る」と言った。",
      sentenceEN: "He said, 'I'm heading home now.'"
    },
    notes: "Should identify quotative particle と attachment and main predicate role."
  },
  {
    id: "ex_21_complex_causative_passive_neg",
    title: "Stacked: Causative-Passive-Negative-Past (食べさせられなかった)",
    mode: "translation_critique",
    category: "Complex Stacked Conjugation",
    card: {
      vocab: "食べさせられなかった",
      reading: "たべさせられなかった",
      meanings: ["was not made to eat", "was not allowed to eat"],
      pos: "verb, causative-passive-negative",
      sentenceJP: "嫌いなピーマンを食べさせられなかった。",
      sentenceEN: "I wasn't forced to eat the bell peppers I hate."
    },
    userDraft: "I didn't make him eat the bell peppers.",
    notes: "Complex stacked conjugation: Inverted causative-passive voice (active 'I didn't make him' vs passive 'I wasn't forced')."
  },
  {
    id: "ex_22_complex_potential_regret",
    title: "Stacked: Potential + Regret Contraction (行けなくなっちゃった)",
    mode: "translation_critique",
    category: "Complex Stacked Conjugation",
    card: {
      vocab: "行けなくなっちゃった",
      reading: "いけなくなっちゃった",
      meanings: ["ended up unable to go", "became unable to go"],
      pos: "verb, potential-regret",
      sentenceJP: "急用が入って、行けなくなっちゃった。",
      sentenceEN: "Something urgent came up, and I ended up not being able to go."
    },
    userDraft: "Something urgent came up, so I didn't go.",
    notes: "Complex stacked conjugation: Missed potential ability and regret change-of-state nuance (ended up becoming unable to)."
  },
  {
    id: "ex_23_complex_conditional_regret",
    title: "Stacked: Conditional Regret (言わなければよかった)",
    mode: "translation_critique",
    category: "Complex Stacked Conjugation",
    card: {
      vocab: "言わなければよかった",
      reading: "いわなければよかった",
      meanings: ["should not have said", "wish I hadn't said"],
      pos: "expression, conditional-regret",
      sentenceJP: "あんなこと、言わなければよかった。",
      sentenceEN: "I wish I hadn't said such a thing."
    },
    userDraft: "If I don't say such things, it's good.",
    notes: "Complex stacked conjugation: Counterfactual regret translated as literal active condition."
  },
  {
    id: "ex_24_complex_double_neg_obligation",
    title: "Stacked: Double Negative Obligation (行かないわけにはいかない)",
    mode: "translation_critique",
    category: "Complex Stacked Conjugation",
    card: {
      vocab: "行かないわけにはいかない",
      reading: "いかないわけにはいかない",
      meanings: ["have to go", "cannot help but go"],
      pos: "expression, obligation",
      sentenceJP: "社長の頼みだから、行かないわけにはいかない。",
      sentenceEN: "It's the president's request, so I have no choice but to go."
    },
    userDraft: "It's the president's request, so there's no reason to go.",
    notes: "Complex stacked conjugation: Double negative obligation translated as absence of reason."
  }
];
