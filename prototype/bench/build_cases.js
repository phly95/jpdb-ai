// Builder for benchmark dataset (prototype/bench/cases.json)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Sentences that appeared in jpdb-ai.user.js instructions, comments, or earlier test suites
// MUST go in DEV ONLY.
// Fresh sentences not in earlier patches or prompts go in TEST.

const cases = [
  // =========================================================================
  // DEV SPLIT (Known / Patched / Instruction / Existing Suite Sentences)
  // =========================================================================

  // --- Dev: Flawless & Paraphrases & Typos (21 cases) ---
  {
    id: "dev_flawless_01",
    split: "dev",
    japanese: "私にはこの言葉の意味が分かりません。",
    target: "言葉",
    meanings: ["word", "language", "phrase"],
    reference: "I don't understand the meaning of this word.",
    draft: "I don't understand the meaning of this word.",
    label: "flawless",
    label_status: "agent_draft",
    notes: "Identical to reference sentence from run_live_rating_eval."
  },
  {
    id: "dev_flawless_02",
    split: "dev",
    japanese: "公園で可愛い猫を見つけた。",
    target: "見つけた",
    meanings: ["found", "discovered"],
    reference: "I discovered a cute cat in the park.",
    draft: "I found a cute cat at the park.",
    label: "flawless",
    label_status: "agent_draft",
    notes: "Natural synonym found/discovered and at/in the park."
  },
  {
    id: "dev_flawless_03",
    split: "dev",
    japanese: "私はこの言葉が何を意味するのか知りません。",
    target: "意味する",
    meanings: ["to mean", "to signify"],
    reference: "I don't know what this word means.",
    draft: "I don't know the meaning of this word.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Natural clause nominalization (explicitly permitted in instructions)."
  },
  {
    id: "dev_flawless_04",
    split: "dev",
    japanese: "一緒に映画に行きたいんだけど。",
    target: "行きたい",
    meanings: ["want to go"],
    reference: "I'd like to go to the movies together, but...",
    draft: "I'd love to go see a movie together.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Conversational softener handled naturally without clunky 'but'."
  },
  {
    id: "dev_flawless_05",
    split: "dev",
    japanese: "もう知らない！勝手にして。",
    target: "知らない",
    meanings: ["don't know", "unaware"],
    reference: "I don't care anymore! Do whatever you want.",
    draft: "I'm done with you! Do as you please.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Idiomatic set phrase もう知らない rendered as I'm done with you."
  },
  {
    id: "dev_flawless_06",
    split: "dev",
    japanese: "田中さんが来ました。",
    target: "来ました",
    meanings: ["came", "arrived"],
    reference: "Mr. Tanaka came.",
    draft: "Mr. Tanaka has arrived.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Aspect equivalence: present perfect has arrived for completed 来ました."
  },
  {
    id: "dev_flawless_07",
    split: "dev",
    japanese: "昨日図書館で面白い本を借りた。",
    target: "借りた",
    meanings: ["borrowed"],
    reference: "Yesterday I borrowed an interesting book from the library.",
    draft: "yesterday i borrowed an interesting book from the library",
    label: "flawless",
    label_status: "agent_draft",
    notes: "Casing and punctuation variations ignored."
  },
  {
    id: "dev_flawless_08",
    split: "dev",
    japanese: "祖母に感謝の手紙を書きました。",
    target: "手紙",
    meanings: ["letter", "message"],
    reference: "I wrote a letter of gratitude to my grandmother.",
    draft: "I wrote a thank-you letter to my grandmother.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Natural compound thank-you letter for 感謝の手紙."
  },
  {
    id: "dev_flawless_09",
    split: "dev",
    japanese: "それを知らなくても大丈夫です。",
    target: "知る",
    meanings: ["to know", "to understand"],
    reference: "It's okay not to know that.",
    draft: "It's fine if you don't know that.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Natural conditional phrasing fine if you don't know."
  },
  {
    id: "dev_flawless_10",
    split: "dev",
    japanese: "彼は思っていたより優しかった。",
    target: "思っていた",
    meanings: ["was thinking", "thought"],
    reference: "He was kinder than I had thought.",
    draft: "He was nicer than what I thought.",
    label: "flawless",
    label_status: "agent_draft",
    notes: "Synonym nicer/kinder, direct translation of 思っていた."
  },
  {
    id: "dev_flawless_11",
    split: "dev",
    japanese: "昨日先生と話した。",
    target: "話した",
    meanings: ["talked", "spoke"],
    reference: "I spoke with the teacher yesterday.",
    draft: "I talked to the teacher yesterday.",
    label: "flawless",
    label_status: "agent_draft",
    notes: "Spoke with vs talked to equivalence."
  },
  {
    id: "dev_flawless_12",
    split: "dev",
    japanese: "三千円かかりました。",
    target: "三千円",
    meanings: ["3000 yen"],
    reference: "It cost 3,000 yen.",
    draft: "It cost three thousand yen.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Numeral formatting: three thousand vs 3,000."
  },
  {
    id: "dev_flawless_13",
    split: "dev",
    japanese: "二人で行きましょう。",
    target: "二人",
    meanings: ["two people", "the two of us"],
    reference: "Let's go, the two of us.",
    draft: "Let's the 2 of us go.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Numeral digit 2 vs two of us."
  },
  {
    id: "dev_flawless_14",
    split: "dev",
    japanese: "30分待ってください。",
    target: "30分",
    meanings: ["30 minutes", "half an hour"],
    reference: "Please wait 30 minutes.",
    draft: "Please wait half an hour.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "30 minutes vs half an hour equivalence."
  },
  {
    id: "dev_flawless_15",
    split: "dev",
    japanese: "午後三時に会いましょう。",
    target: "午後三時",
    meanings: ["3 PM", "15:00"],
    reference: "Let's meet at 3 in the afternoon.",
    draft: "Let's meet at 3:00 PM.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "3:00 PM vs 3 in the afternoon."
  },
  {
    id: "dev_flawless_16",
    split: "dev",
    japanese: "スミスさんに会いました。",
    target: "スミス",
    meanings: ["Smith"],
    reference: "I met Mr. Smith.",
    draft: "I met mr smith.",
    label: "flawless",
    label_status: "agent_draft",
    notes: "mr smith lowercase casing variation."
  },
  {
    id: "dev_flawless_17",
    split: "dev",
    japanese: "急いで眼鏡をかけた。",
    target: "かける",
    meanings: ["to put on (glasses)"],
    reference: "I quickly put on my glasses.",
    draft: "I put on my glasses in a hurry.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Quickly vs in a hurry paraphrase."
  },
  {
    id: "dev_flawless_18",
    split: "dev",
    japanese: "ちょっと待ってください。",
    target: "ちょっと",
    meanings: ["a little", "a moment"],
    reference: "Please wait a moment.",
    draft: "Hold on a second please.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Colloquial natural equivalent hold on a second."
  },
  {
    id: "dev_flawless_19",
    split: "dev",
    japanese: "それを知らなくても大丈夫です。",
    target: "知る",
    meanings: ["to know", "to understand"],
    reference: "It's okay not to know that.",
    draft: "It's okay to now know that.",
    label: "typo_only",
    label_status: "agent_draft",
    notes: "Grounded English typo: now for not with sound comprehension."
  },
  {
    id: "dev_flawless_20",
    split: "dev",
    japanese: "彼らはそこにいます。",
    target: "彼ら",
    meanings: ["they"],
    reference: "They are over there.",
    draft: "Their over there.",
    label: "typo_only",
    label_status: "agent_draft",
    notes: "Homophone typo: their for they're."
  },
  {
    id: "dev_flawless_21",
    split: "dev",
    japanese: "熱が高すぎる。",
    target: "高すぎる",
    meanings: ["too high"],
    reference: "The fever is too high.",
    draft: "The fever is to high.",
    label: "typo_only",
    label_status: "agent_draft",
    notes: "Keyboard typo: to for too."
  },

  // --- Dev: Critical Errors (18 cases, 3 per critical type) ---
  // 1. Passive Reversal
  {
    id: "dev_crit_passive_01",
    split: "dev",
    japanese: "先生に宿題をやりなさいと言われた。",
    target: "言われた",
    meanings: ["to be told"],
    reference: "I was told by my teacher to do my homework.",
    draft: "I told the teacher to do homework.",
    label: "critical_error:passive_reversal",
    label_status: "agent_draft",
    notes: "Passive voice reversed to active."
  },
  {
    id: "dev_crit_passive_02",
    split: "dev",
    japanese: "泥棒に財布を盗まれた。",
    target: "盗まれた",
    meanings: ["was stolen", "had stolen"],
    reference: "My wallet was stolen by a thief.",
    draft: "I stole the thief's wallet.",
    label: "critical_error:passive_reversal",
    label_status: "agent_draft",
    notes: "Suffering passive reversed to active theft."
  },
  {
    id: "dev_crit_passive_03",
    split: "dev",
    japanese: "道で警察官に呼び止められた。",
    target: "呼び止められた",
    meanings: ["was stopped", "was flagged down"],
    reference: "I was stopped by a police officer on the street.",
    draft: "I stopped a police officer on the street.",
    label: "critical_error:passive_reversal",
    label_status: "agent_draft",
    notes: "Passive reversed to active."
  },

  // 2. Polarity Inversion
  {
    id: "dev_crit_polarity_01",
    split: "dev",
    japanese: "何も聞こえなかった。",
    target: "聞こえなかった",
    meanings: ["could not hear"],
    reference: "I couldn't hear anything.",
    draft: "I heard everything.",
    label: "critical_error:polarity_inversion",
    label_status: "agent_draft",
    notes: "Negative polarity inverted to affirmative."
  },
  {
    id: "dev_crit_polarity_02",
    split: "dev",
    japanese: "誰も来なかった。",
    target: "来なかった",
    meanings: ["did not come"],
    reference: "Nobody came.",
    draft: "Everybody came.",
    label: "critical_error:polarity_inversion",
    label_status: "agent_draft",
    notes: "Negative polarity inverted."
  },
  {
    id: "dev_crit_polarity_03",
    split: "dev",
    japanese: "その事故について何も知らない。",
    target: "知らない",
    meanings: ["don't know"],
    reference: "I know nothing about that accident.",
    draft: "I know all about that accident.",
    label: "critical_error:polarity_inversion",
    label_status: "agent_draft",
    notes: "Negative polarity inverted to affirmative."
  },

  // 3. Benefactive Reversal
  {
    id: "dev_crit_benefactive_01",
    split: "dev",
    japanese: "友達が私の宿題をやってくれた。",
    target: "やってくれた",
    meanings: ["did for me"],
    reference: "My friend did my homework for me.",
    draft: "I did my friend's homework for them.",
    label: "critical_error:benefactive_reversal",
    label_status: "agent_draft",
    notes: "Favor received (てくれた) reversed to favor given."
  },
  {
    id: "dev_crit_benefactive_02",
    split: "dev",
    japanese: "犬に餌をやってくれ。",
    target: "やってくれ",
    meanings: ["feed (for the dog)"],
    reference: "Feed the dog.",
    draft: "Give me some dog food.",
    label: "critical_error:benefactive_reversal",
    label_status: "agent_draft",
    notes: "Action for pet (〜てやる) translated as action for me."
  },
  {
    id: "dev_crit_benefactive_03",
    split: "dev",
    japanese: "母にセーターを編んでもらった。",
    target: "編んでもらった",
    meanings: ["had knitted for me"],
    reference: "I had my mother knit a sweater for me.",
    draft: "I knitted a sweater for my mother.",
    label: "critical_error:benefactive_reversal",
    label_status: "agent_draft",
    notes: "Benefactive てもらう reversed."
  },

  // 4. Indefinite vs Wh-question
  {
    id: "dev_crit_indef_01",
    split: "dev",
    japanese: "何か冷たいものを飲みたい。",
    target: "何か",
    meanings: ["something", "anything"],
    reference: "I want to drink something cold.",
    draft: "What cold thing do you want to drink?",
    label: "critical_error:indefinite_vs_wh",
    label_status: "agent_draft",
    notes: "Confused indefinite 何か with open wh-question 何."
  },
  {
    id: "dev_crit_indef_02",
    split: "dev",
    japanese: "誰か部屋にいますか。",
    target: "誰か",
    meanings: ["someone", "anyone"],
    reference: "Is someone in the room?",
    draft: "Who is in the room?",
    label: "critical_error:indefinite_vs_wh",
    label_status: "agent_draft",
    notes: "Confused indefinite 誰か with wh-word 誰 (yes/no question turned into open question)."
  },
  {
    id: "dev_crit_indef_03",
    split: "dev",
    japanese: "どこかへ行きましたか。",
    target: "どこか",
    meanings: ["somewhere", "anywhere"],
    reference: "Did you go somewhere?",
    draft: "Where did you go?",
    label: "critical_error:indefinite_vs_wh",
    label_status: "agent_draft",
    notes: "Confused どこか (somewhere) with どこ (where)."
  },

  // 5. Causative-Passive Inversion
  {
    id: "dev_crit_causpass_01",
    split: "dev",
    japanese: "病院で二時間も待たされた。",
    target: "待たされた",
    meanings: ["was made to wait", "was kept waiting"],
    reference: "I was kept waiting for two hours at the hospital.",
    draft: "I made them wait for two hours at the hospital.",
    label: "critical_error:causative_passive_inversion",
    label_status: "agent_draft",
    notes: "Causative-passive translated as active causer."
  },
  {
    id: "dev_crit_causpass_02",
    split: "dev",
    japanese: "無理やりピーマンを食べさせられた。",
    target: "食べさせられた",
    meanings: ["was forced to eat"],
    reference: "I was forced to eat bell peppers.",
    draft: "I forced them to eat bell peppers.",
    label: "critical_error:causative_passive_inversion",
    label_status: "agent_draft",
    notes: "Causative-passive inverted to causer."
  },
  {
    id: "dev_crit_causpass_03",
    split: "dev",
    japanese: "先輩にお酒を飲まされた。",
    target: "飲まされた",
    meanings: ["was made to drink"],
    reference: "I was made to drink alcohol by my senior.",
    draft: "I made my senior drink alcohol.",
    label: "critical_error:causative_passive_inversion",
    label_status: "agent_draft",
    notes: "Causative-passive inverted to active causative."
  },

  // 6. Numeral Mismatch
  {
    id: "dev_crit_numeral_01",
    split: "dev",
    japanese: "病院で二時間も待たされた。",
    target: "二時間",
    meanings: ["two hours"],
    reference: "I was kept waiting for two whole hours at the hospital.",
    draft: "I was kept waiting for five hours at the hospital.",
    label: "critical_error:numeral_mismatch",
    label_status: "agent_draft",
    notes: "二時間 (2 hours) translated as five hours."
  },
  {
    id: "dev_crit_numeral_02",
    split: "dev",
    japanese: "三千円かかりました。",
    target: "三千円",
    meanings: ["3000 yen"],
    reference: "It cost 3,000 yen.",
    draft: "It cost 5,000 yen.",
    label: "critical_error:numeral_mismatch",
    label_status: "agent_draft",
    notes: "3,000 yen translated as 5,000 yen."
  },
  {
    id: "dev_crit_numeral_03",
    split: "dev",
    japanese: "田中さんが来た。",
    target: "田中",
    meanings: ["Tanaka"],
    reference: "Tanaka came.",
    draft: "Three people including Tanaka came.",
    label: "critical_error:numeral_mismatch",
    label_status: "agent_draft",
    notes: "Hallucinated Three people from さん."
  },

  // --- Dev: Moderate Errors (14 cases) ---
  {
    id: "dev_mod_01",
    split: "dev",
    japanese: "明日のパーティーに行けるよ。",
    target: "行ける",
    meanings: ["can go", "to be able to go"],
    reference: "I can go to tomorrow's party.",
    draft: "I will go to tomorrow's party.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Potential form 行ける translated as simple intent will go."
  },
  {
    id: "dev_mod_02",
    split: "dev",
    japanese: "今度こそ勝ちたい。",
    target: "今度",
    meanings: ["next time", "this time"],
    reference: "This time for sure I want to win.",
    draft: "Next time for sure I wanted to win.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Tense error: wanted to win instead of want to win."
  },
  {
    id: "dev_mod_03",
    split: "dev",
    japanese: "宿題をやりなさい。",
    target: "やりなさい",
    meanings: ["do (imperative)"],
    reference: "Do your homework.",
    draft: "You did your homework.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Imperative command mistranslated as past factual."
  },
  {
    id: "dev_mod_04",
    split: "dev",
    japanese: "早く行かなければよかった。",
    target: "なければよかった",
    meanings: ["should not have"],
    reference: "I shouldn't have gone so early.",
    draft: "If I didn't go early it would be good.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Conditional regret missed, translated as literal conditional."
  },
  {
    id: "dev_mod_05",
    split: "dev",
    japanese: "行かないわけにはいかない。",
    target: "ないわけにはいかない",
    meanings: ["must go", "have no choice but to go"],
    reference: "I have no choice but to go.",
    draft: "I cannot go.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Double negative obligation translated as inability."
  },
  {
    id: "dev_mod_06",
    split: "dev",
    japanese: "声が出なくなっちゃった。",
    target: "なくなっちゃった",
    meanings: ["ended up unable to", "lost voice"],
    reference: "I ended up unable to speak.",
    draft: "I didn't speak.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Potential change of state + regret translated as simple past negative."
  },
  {
    id: "dev_mod_07",
    split: "dev",
    japanese: "この部屋は暑すぎる。",
    target: "暑すぎる",
    meanings: ["too hot"],
    reference: "This room is too hot.",
    draft: "This room is very cold.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Antonym mistranslation: hot translated as cold."
  },
  {
    id: "dev_mod_08",
    split: "dev",
    japanese: "今度の日曜日に会いましょう。",
    target: "今度",
    meanings: ["this upcoming", "next"],
    reference: "Let's meet this coming Sunday.",
    draft: "Let's meet last Sunday.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Temporal error: this coming Sunday translated as last Sunday."
  },
  {
    id: "dev_mod_09",
    split: "dev",
    japanese: "雨が降るかもしれない。",
    target: "かもしれない",
    meanings: ["might", "may"],
    reference: "It might rain.",
    draft: "It will definitely rain.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Uncertainty/possibility translated as absolute certainty."
  },
  {
    id: "dev_mod_10",
    split: "dev",
    japanese: "日本料理を食べたことがある。",
    target: "ことがある",
    meanings: ["have experience of"],
    reference: "I have eaten Japanese food before.",
    draft: "I am eating Japanese food right now.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Past experience aspect translated as present progressive."
  },
  {
    id: "dev_mod_11",
    split: "dev",
    japanese: "会議は何時に始まりますか。",
    target: "何時",
    meanings: ["what time"],
    reference: "What time does the meeting start?",
    draft: "Where does the meeting start?",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Interrogative word error: what time translated as where."
  },
  {
    id: "dev_mod_12",
    split: "dev",
    japanese: "彼は毎日日本語を勉強している。",
    target: "毎日",
    meanings: ["every day"],
    reference: "He studies Japanese every day.",
    draft: "He studied Japanese yesterday.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Habitual aspect and frequency modifier altered."
  },
  {
    id: "dev_mod_13",
    split: "dev",
    japanese: "もっとゆっくり話してください。",
    target: "ゆっくり",
    meanings: ["slowly"],
    reference: "Please speak more slowly.",
    draft: "Please speak louder.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Lexical confusion: slowly translated as louder."
  },
  {
    id: "dev_mod_14",
    split: "dev",
    japanese: "駅まで歩いて十分かかります。",
    target: "十分",
    meanings: ["10 minutes"],
    reference: "It takes ten minutes on foot to the station.",
    draft: "It takes enough time to walk to the station.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Kanji polysemy: 十分 (10 minutes) translated as 十分 (enough)."
  },

  // =========================================================================
  // TEST SPLIT (Fresh Sentences - Never in instructions, patches, or suites)
  // =========================================================================

  // --- Test: Flawless & Paraphrases & Typos (21 cases) ---
  {
    id: "test_flawless_01",
    split: "test",
    japanese: "彼女の新しい小説を読み終えました。",
    target: "読み終えた",
    meanings: ["finished reading"],
    reference: "I finished reading her new novel.",
    draft: "I have finished reading her new novel.",
    label: "flawless",
    label_status: "agent_draft",
    notes: "Present perfect aspect variant for completed action."
  },
  {
    id: "test_flawless_02",
    split: "test",
    japanese: "このスープは少し塩辛いですね。",
    target: "塩辛い",
    meanings: ["salty"],
    reference: "This soup is a little salty, isn't it?",
    draft: "This soup is a bit too salty.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Natural conversational tone paraphrase bit too salty."
  },
  {
    id: "test_flawless_03",
    split: "test",
    japanese: "鍵をどこに置いたのか思い出せません。",
    target: "思い出す",
    meanings: ["to recall", "to remember"],
    reference: "I cannot remember where I put the keys.",
    draft: "I can't recall the location of my keys.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Clause nominalization and recall/remember equivalence."
  },
  {
    id: "test_flawless_04",
    split: "test",
    japanese: "明日の朝、空港まで迎えに行きます。",
    target: "迎えに行く",
    meanings: ["to go pick up"],
    reference: "I will go pick you up at the airport tomorrow morning.",
    draft: "I'll pick you up at the airport tomorrow morning.",
    label: "flawless",
    label_status: "agent_draft",
    notes: "Natural contraction I'll pick you up."
  },
  {
    id: "test_flawless_05",
    split: "test",
    japanese: "窓を開けても構いませんか。",
    target: "構いません",
    meanings: ["do not mind", "is fine"],
    reference: "Do you mind if I open the window?",
    draft: "Would it be alright if I opened the window?",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Polite English modal equivalent."
  },
  {
    id: "test_flawless_06",
    split: "test",
    japanese: "弟は大学で建築を学んでいます。",
    target: "建築",
    meanings: ["architecture"],
    reference: "My younger brother is studying architecture at university.",
    draft: "My little brother studies architecture in college.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Valid natural synonyms little brother / college."
  },
  {
    id: "test_flawless_07",
    split: "test",
    japanese: "昨夜はぐっすり眠ることができました。",
    target: "ぐっすり",
    meanings: ["soundly", "deeply"],
    reference: "I was able to sleep soundly last night.",
    draft: "I had a great night's sleep yesterday.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Idiomatic translation of ぐっすり眠る."
  },
  {
    id: "test_flawless_08",
    split: "test",
    japanese: "雨が止むまでここで雨宿りしましょう。",
    target: "雨宿り",
    meanings: ["taking shelter from the rain"],
    reference: "Let's take shelter from the rain here until it stops.",
    draft: "Let's wait out the rain here until it clears up.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Natural idiomatic equivalent wait out the rain."
  },
  {
    id: "test_flawless_09",
    split: "test",
    japanese: "この計画にはまだ改善の余地がある。",
    target: "余地",
    meanings: ["room", "scope", "margin"],
    reference: "There is still room for improvement in this plan.",
    draft: "This plan could still be improved.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Verbal paraphrase could still be improved."
  },
  {
    id: "test_flawless_10",
    split: "test",
    japanese: "彼女は突然大声で笑い出した。",
    target: "笑い出した",
    meanings: ["burst out laughing", "started laughing"],
    reference: "She suddenly burst out laughing.",
    draft: "all of a sudden she started laughing loudly",
    label: "flawless",
    label_status: "agent_draft",
    notes: "Punctuation/casing omission with accurate sense."
  },
  {
    id: "test_flawless_11",
    split: "test",
    japanese: "四本のペンを買いました。",
    target: "四本",
    meanings: ["four (long objects / pens)"],
    reference: "I bought four pens.",
    draft: "I bought 4 pens.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Numeral digit 4 vs word four."
  },
  {
    id: "test_flawless_12",
    split: "test",
    japanese: "会議は二階の大会議室で行われます。",
    target: "二階",
    meanings: ["second floor"],
    reference: "The meeting will be held in the main conference room on the second floor.",
    draft: "The meeting will take place in the large conference room on the 2nd floor.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Ordinal abbreviation 2nd vs second."
  },
  {
    id: "test_flawless_13",
    split: "test",
    japanese: "その提案には賛成できませんね。",
    target: "賛成",
    meanings: ["agreement", "approval"],
    reference: "I cannot agree with that proposal, you know.",
    draft: "I'm afraid I can't support that proposal.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Pragmatic conversational softener I'm afraid."
  },
  {
    id: "test_flawless_14",
    split: "test",
    japanese: "山田先生はとても熱心に教えてくださる。",
    target: "熱心",
    meanings: ["enthusiastic", "eager", "dedicated"],
    reference: "Professor Yamada teaches us very passionately.",
    draft: "Prof. Yamada teaches with great enthusiasm.",
    label: "flawless",
    label_status: "agent_draft",
    notes: "Valid synonym enthusiasm/passion, abbreviation Prof."
  },
  {
    id: "test_flawless_15",
    split: "test",
    japanese: "約束の時間を忘れてしまって申し訳ありません。",
    target: "申し訳ありません",
    meanings: ["I am very sorry"],
    reference: "I am deeply sorry that I forgot the appointment time.",
    draft: "I'm so sorry for forgetting the time we agreed on.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Natural colloquial apology and paraphrase for 約束の時間."
  },
  {
    id: "test_flawless_16",
    split: "test",
    japanese: "彼は約束通り時間通りに現れた。",
    target: "現れた",
    meanings: ["appeared", "showed up"],
    reference: "He showed up on time as promised.",
    draft: "He arrived right on time just as promised.",
    label: "flawless",
    label_status: "agent_draft",
    notes: "Arrived vs showed up."
  },
  {
    id: "test_flawless_17",
    split: "test",
    japanese: "この靴は軽くて履き心地が良い。",
    target: "履き心地",
    meanings: ["comfortable to wear (shoes)"],
    reference: "These shoes are light and comfortable to wear.",
    draft: "These shoes are lightweight and feel good to wear.",
    label: "flawless",
    label_status: "agent_draft",
    notes: "Lightweight vs light."
  },
  {
    id: "test_flawless_18",
    split: "test",
    japanese: "週末は家でのんびり過ごしました。",
    target: "のんびり",
    meanings: ["leisurely", "relaxing"],
    reference: "I spent a relaxing weekend at home.",
    draft: "I chilled out at home over the weekend.",
    label: "valid_paraphrase",
    label_status: "agent_draft",
    notes: "Natural colloquial chilled out for のんびり過ごした."
  },
  {
    id: "test_flawless_19",
    split: "test",
    japanese: "私たちは海で泳ぐ予定でした。",
    target: "泳ぐ",
    meanings: ["to swim"],
    reference: "We were planning to swim in the ocean.",
    draft: "We were planning to seim in the ocean.",
    label: "typo_only",
    label_status: "agent_draft",
    notes: "Single letter keyboard slip: seim for swim."
  },
  {
    id: "test_flawless_20",
    split: "test",
    japanese: "ここでタバコを吸ってはいけません。",
    target: "吸う",
    meanings: ["to smoke"],
    reference: "You must not smoke here.",
    draft: "You must not smoke hear.",
    label: "typo_only",
    label_status: "agent_draft",
    notes: "Homophone typo: hear for here."
  },
  {
    id: "test_flawless_21",
    split: "test",
    japanese: "彼女はとても上手にピアノを弾きます。",
    target: "上手",
    meanings: ["skillful", "good at"],
    reference: "She plays the piano very well.",
    draft: "She plays the piano very we'll.",
    label: "typo_only",
    label_status: "agent_draft",
    notes: "Autocorrect slip: we'll for well."
  },

  // --- Test: Critical Errors (18 cases, 3 per critical type) ---
  // 1. Passive Reversal
  {
    id: "test_crit_passive_01",
    split: "test",
    japanese: "上司にその仕事を任された。",
    target: "任された",
    meanings: ["was entrusted with"],
    reference: "I was entrusted with that job by my boss.",
    draft: "I assigned that task to my boss.",
    label: "critical_error:passive_reversal",
    label_status: "agent_draft",
    notes: "Passive 任された reversed to active assignment to the boss."
  },
  {
    id: "test_crit_passive_02",
    split: "test",
    japanese: "大勢の人に見つめられて恥ずかしかった。",
    target: "見つめられて",
    meanings: ["being stared at"],
    reference: "I was embarrassed being stared at by so many people.",
    draft: "I stared at a lot of people and felt embarrassed.",
    label: "critical_error:passive_reversal",
    label_status: "agent_draft",
    notes: "Passive being stared at reversed to staring at others."
  },
  {
    id: "test_crit_passive_03",
    split: "test",
    japanese: "弟は母に叱られた。",
    target: "叱られた",
    meanings: ["was scolded"],
    reference: "My younger brother was scolded by our mother.",
    draft: "My younger brother scolded our mother.",
    label: "critical_error:passive_reversal",
    label_status: "agent_draft",
    notes: "Passive voice reversed, agent and recipient swapped."
  },

  // 2. Polarity Inversion
  {
    id: "test_crit_polarity_01",
    split: "test",
    japanese: "この川で泳いではいけません。",
    target: "泳いではいけない",
    meanings: ["must not swim"],
    reference: "You must not swim in this river.",
    draft: "You can swim in this river.",
    label: "critical_error:polarity_inversion",
    label_status: "agent_draft",
    notes: "Prohibition inverted to permission."
  },
  {
    id: "test_crit_polarity_02",
    split: "test",
    japanese: "その知らせを聞いて驚かなかった人はいなかった。",
    target: "いなかった",
    meanings: ["there was no one"],
    reference: "There was no one who was not surprised upon hearing that news.",
    draft: "Nobody was surprised when they heard the news.",
    label: "critical_error:polarity_inversion",
    label_status: "agent_draft",
    notes: "Double negative affirmative inverted to total negative."
  },
  {
    id: "test_crit_polarity_03",
    split: "test",
    japanese: "まだ誰にも秘密を話していない。",
    target: "話していない",
    meanings: ["have not told"],
    reference: "I haven't told the secret to anyone yet.",
    draft: "I already told everyone the secret.",
    label: "critical_error:polarity_inversion",
    label_status: "agent_draft",
    notes: "Negative polarity inverted to complete affirmative."
  },

  // 3. Benefactive Reversal
  {
    id: "test_crit_benefactive_01",
    split: "test",
    japanese: "先輩が空港まで車で送ってくれた。",
    target: "送ってくれた",
    meanings: ["gave a ride (favor for me)"],
    reference: "My senior kindly drove me to the airport.",
    draft: "I gave my senior a ride to the airport.",
    label: "critical_error:benefactive_reversal",
    label_status: "agent_draft",
    notes: "てくれた reversed from receiving ride to giving ride."
  },
  {
    id: "test_crit_benefactive_02",
    split: "test",
    japanese: "妹に新しい自転車を買ってやった。",
    target: "買ってやった",
    meanings: ["bought for (younger sibling)"],
    reference: "I bought a new bicycle for my younger sister.",
    draft: "My little sister bought me a new bicycle.",
    label: "critical_error:benefactive_reversal",
    label_status: "agent_draft",
    notes: "〜てやる reversed from buying for sister to sister buying for me."
  },
  {
    id: "test_crit_benefactive_03",
    split: "test",
    japanese: "医者に詳しく診てもらった。",
    target: "診てもらった",
    meanings: ["had examined (by doctor)"],
    reference: "I had the doctor examine me in detail.",
    draft: "I examined the doctor thoroughly.",
    label: "critical_error:benefactive_reversal",
    label_status: "agent_draft",
    notes: "てもらう reversed from being examined to examining the doctor."
  },

  // 4. Indefinite vs Wh-question
  {
    id: "test_crit_indef_01",
    split: "test",
    japanese: "机の上に何か落ちていますよ。",
    target: "何か",
    meanings: ["something"],
    reference: "Something has fallen on the desk.",
    draft: "What fell on top of the desk?",
    label: "critical_error:indefinite_vs_wh",
    label_status: "agent_draft",
    notes: "Indefinite pronoun statement turned into open wh-question."
  },
  {
    id: "test_crit_indef_02",
    split: "test",
    japanese: "いつか日本へ旅行したいです。",
    target: "いつか",
    meanings: ["someday", "one day"],
    reference: "I want to travel to Japan someday.",
    draft: "When do you want to travel to Japan?",
    label: "critical_error:indefinite_vs_wh",
    label_status: "agent_draft",
    notes: "いつか (someday) mistranslated as wh-question いつ (when)."
  },
  {
    id: "test_crit_indef_03",
    split: "test",
    japanese: "誰かに相談しましたか。",
    target: "誰か",
    meanings: ["someone", "anyone"],
    reference: "Did you consult with someone?",
    draft: "Who did you consult with?",
    label: "critical_error:indefinite_vs_wh",
    label_status: "agent_draft",
    notes: "誰か (someone) confused with 誰 (who)."
  },

  // 5. Causative-Passive Inversion
  {
    id: "test_crit_causpass_01",
    split: "test",
    japanese: "コーチにグラウンドを十周走らされた。",
    target: "走らされた",
    meanings: ["was made to run"],
    reference: "I was made to run ten laps around the field by the coach.",
    draft: "I made the coach run ten laps around the field.",
    label: "critical_error:causative_passive_inversion",
    label_status: "agent_draft",
    notes: "Causative-passive inverted: subjected runner became the taskmaster."
  },
  {
    id: "test_crit_causpass_02",
    split: "test",
    japanese: "嫌な仕事を無理やり手伝わされた。",
    target: "手伝わされた",
    meanings: ["was forced to help with"],
    reference: "I was forced to help with an unpleasant task.",
    draft: "I forced someone to help me with an unpleasant job.",
    label: "critical_error:causative_passive_inversion",
    label_status: "agent_draft",
    notes: "Causative-passive forced to help inverted to forcing someone else."
  },
  {
    id: "test_crit_causpass_03",
    split: "test",
    japanese: "上司に休日に出勤させられた。",
    target: "出勤させられた",
    meanings: ["was made to come into work"],
    reference: "I was made to come to work on a day off by my boss.",
    draft: "I made my boss come into work on his day off.",
    label: "critical_error:causative_passive_inversion",
    label_status: "agent_draft",
    notes: "Causative-passive inverted."
  },

  // 6. Numeral Mismatch
  {
    id: "test_crit_numeral_01",
    split: "test",
    japanese: "このビルには八つの会社が入っています。",
    target: "八つ",
    meanings: ["eight"],
    reference: "There are eight companies in this building.",
    draft: "There are three companies in this building.",
    label: "critical_error:numeral_mismatch",
    label_status: "agent_draft",
    notes: "八つ (8) mistranslated as three."
  },
  {
    id: "test_crit_numeral_02",
    split: "test",
    japanese: "参加費は一人五百円です。",
    target: "五百円",
    meanings: ["500 yen"],
    reference: "The participation fee is 500 yen per person.",
    draft: "The fee is 5,000 yen per person.",
    label: "critical_error:numeral_mismatch",
    label_status: "agent_draft",
    notes: "500 yen mistranslated as 5,000 yen."
  },
  {
    id: "test_crit_numeral_03",
    split: "test",
    japanese: "試験は七月十二日に行われます。",
    target: "七月十二日",
    meanings: ["July 12th"],
    reference: "The exam will be held on July 12th.",
    draft: "The exam will take place on July 20th.",
    label: "critical_error:numeral_mismatch",
    label_status: "agent_draft",
    notes: "12th mistranslated as 20th."
  },

  // --- Test: Moderate Errors (14 cases) ---
  {
    id: "test_mod_01",
    split: "test",
    japanese: "明日までにこの書類を提出しなければならない。",
    target: "提出する",
    meanings: ["to submit"],
    reference: "I have to submit this document by tomorrow.",
    draft: "You don't need to submit this document tomorrow.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Obligation pattern (なければならない) translated as lack of necessity."
  },
  {
    id: "test_mod_02",
    split: "test",
    japanese: "彼は今頃空港に着いているはずだ。",
    target: "はずだ",
    meanings: ["should be", "expected to be"],
    reference: "He should have arrived at the airport by now.",
    draft: "He cannot possibly arrive at the airport now.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Expectation pattern (はずだ) translated as impossibility."
  },
  {
    id: "test_mod_03",
    split: "test",
    japanese: "子供たちを外で遊ばせてあげた。",
    target: "遊ばせてあげた",
    meanings: ["let them play"],
    reference: "I let the children play outside.",
    draft: "The children made me play outside.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Causative benefactive permission confused with being forced."
  },
  {
    id: "test_mod_04",
    split: "test",
    japanese: "もっと早く家を出ればよかった。",
    target: "出ればよかった",
    meanings: ["should have left"],
    reference: "I should have left the house earlier.",
    draft: "I will leave the house earlier if it is good.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Counterfactual regret missed, translated as future condition."
  },
  {
    id: "test_mod_05",
    split: "test",
    japanese: "電車が遅れたため、会議に遅刻してしまった。",
    target: "遅刻した",
    meanings: ["was late", "arrived late"],
    reference: "Because the train was delayed, I ended up being late for the meeting.",
    draft: "Because the train was late, I made it to the meeting on time.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Consequence inverted: being late translated as on time."
  },
  {
    id: "test_mod_06",
    split: "test",
    japanese: "このボタンを押すと切符が出ます。",
    target: "切符",
    meanings: ["ticket"],
    reference: "When you press this button, the ticket comes out.",
    draft: "When you pressed that button yesterday, a ticket came out.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "General conditional present tense translated as past historic."
  },
  {
    id: "test_mod_07",
    split: "test",
    japanese: "あのレストランは予約しないと入れない。",
    target: "入れない",
    meanings: ["cannot enter"],
    reference: "You cannot enter that restaurant without a reservation.",
    draft: "You can enter that restaurant without any reservation.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Condition requirement dropped and negative potential inverted."
  },
  {
    id: "test_mod_08",
    split: "test",
    japanese: "彼はピアノを上手に弾くことができる。",
    target: "弾くことができる",
    meanings: ["can play"],
    reference: "He is able to play the piano well.",
    draft: "He will definitely play the piano well.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Potential ability (ことができる) translated as future prediction."
  },
  {
    id: "test_mod_09",
    split: "test",
    japanese: "彼は財布を忘れたふりをした。",
    target: "ふりをした",
    meanings: ["pretended"],
    reference: "He pretended to have forgotten his wallet.",
    draft: "He actually forgot his wallet.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Pretended pattern (ふりをした) translated as factual."
  },
  {
    id: "test_mod_10",
    split: "test",
    japanese: "この道を通って駅へ行くことができます。",
    target: "通って",
    meanings: ["passing through", "going via"],
    reference: "You can go to the station via this street.",
    draft: "You can go to the station without using this street.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Via this street translated as without using this street."
  },
  {
    id: "test_mod_11",
    split: "test",
    japanese: "彼女は泣きそうな顔をしていた。",
    target: "泣きそう",
    meanings: ["looked like she was about to cry"],
    reference: "She had a look on her face like she was about to cry.",
    draft: "She had a big smile on her face.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Emotional facial expression mistranslated into opposite."
  },
  {
    id: "test_mod_12",
    split: "test",
    japanese: "父は毎朝六時にジョギングを始める。",
    target: "始める",
    meanings: ["begins", "starts"],
    reference: "My father starts jogging every morning at six.",
    draft: "My father finishes jogging at six every morning.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Action aspect: starts translated as finishes."
  },
  {
    id: "test_mod_13",
    split: "test",
    japanese: "荷物が重すぎて一人では運べない。",
    target: "運べない",
    meanings: ["cannot carry"],
    reference: "The luggage is too heavy to carry alone.",
    draft: "The luggage is light enough to carry alone.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Adjective heavy turned into light, potential negative dropped."
  },
  {
    id: "test_mod_14",
    split: "test",
    japanese: "日本へ行く前にビザを取らなければならない。",
    target: "前",
    meanings: ["before"],
    reference: "You must obtain a visa before going to Japan.",
    draft: "You must obtain a visa after arriving in Japan.",
    label: "moderate_error",
    label_status: "agent_draft",
    notes: "Temporal relation: before going translated as after arriving."
  }
];

// Validate dataset criteria
const devCases = cases.filter(c => c.split === 'dev');
const testCases = cases.filter(c => c.split === 'test');

console.log(`Total cases: ${cases.length}`);
console.log(`Dev cases:   ${devCases.length}`);
console.log(`Test cases:  ${testCases.length} (${(testCases.length / cases.length * 100).toFixed(1)}%)`);

// Counts by type
const errorLabels = cases.filter(c => c.label !== 'flawless' && c.label !== 'valid_paraphrase' && c.label !== 'typo_only');
const validLabels = cases.filter(c => c.label === 'flawless' || c.label === 'valid_paraphrase' || c.label === 'typo_only');
console.log(`Total error cases: ${errorLabels.length} (Dev: ${devCases.filter(c => c.label !== 'flawless' && c.label !== 'valid_paraphrase' && c.label !== 'typo_only').length}, Test: ${testCases.filter(c => c.label !== 'flawless' && c.label !== 'valid_paraphrase' && c.label !== 'typo_only').length})`);
console.log(`Total valid cases: ${validLabels.length} (Dev: ${devCases.filter(c => c.label === 'flawless' || c.label === 'valid_paraphrase' || c.label === 'typo_only').length}, Test: ${testCases.filter(c => c.label === 'flawless' || c.label === 'valid_paraphrase' || c.label === 'typo_only').length})`);

const criticalTypes = [
  'critical_error:passive_reversal',
  'critical_error:polarity_inversion',
  'critical_error:benefactive_reversal',
  'critical_error:indefinite_vs_wh',
  'critical_error:causative_passive_inversion',
  'critical_error:numeral_mismatch'
];

for (const ct of criticalTypes) {
  const count = cases.filter(c => c.label === ct).length;
  console.log(`  - ${ct}: ${count} (Dev: ${devCases.filter(c => c.label === ct).length}, Test: ${testCases.filter(c => c.label === ct).length})`);
  if (count < 5) throw new Error(`Critical type ${ct} has fewer than 5 cases: ${count}`);
}

if (testCases.length < cases.length * 0.40) {
  throw new Error(`Test split must be at least 40% of cases. Currently ${(testCases.length / cases.length * 100).toFixed(1)}%`);
}

// Write cases.json
const jsonPath = path.join(__dirname, 'cases.json');
fs.writeFileSync(jsonPath, JSON.stringify(cases, null, 2), 'utf8');
console.log(`Wrote ${cases.length} cases to ${jsonPath}`);

// Compute content hash of test split (deterministic JSON of test cases sorted by id)
const testOnly = testCases.slice().sort((a, b) => a.id.localeCompare(b.id));
const testSerialized = JSON.stringify(testOnly);
const testHash = crypto.createHash('sha256').update(testSerialized, 'utf8').digest('hex');

const hashPath = path.join(__dirname, 'test.sha256');
fs.writeFileSync(hashPath, testHash + '\n', 'utf8');
console.log(`Wrote test split SHA-256 hash to ${hashPath}: ${testHash}`);
