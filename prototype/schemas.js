// Schema builder using advanced TypeSafe JSON structures
// Implements best practices from https://docs.typesafe.ai/primitives/advanced.md

function buildTranslationRatingQuestions(info, userDraft, words) {
  const cleanTarget = (info.vocab || '').replace(/\([^)]*\)/g, '').trim();

  const questions = {
    is_flawless: {
      type: 'noul',
      instructions: {
        question: 'Is `user_translation` an accurate, faithful, natural, or idiomatic translation of `japanese_sentence` in context?',
        focus: 'Translations that convey the natural communicative meaning, pragmatic tone, or idiomatic sense count as flawless (1.0). Minor English typos, phonetic homophones (e.g. their/there, its/it\'s, hear/here), or autocorrect slips do not disqualify a translation if Japanese comprehension is accurate.',
        exceptions: 'Confusing an indefinite pronoun like 何か ("something/anything") with an open wh-question word like 何 ("what"), turning a yes/no question into an open-ended wh-question, is a clear semantic error and MUST return 0.0 (false).'
      }
    },
    grade_bracket: {
      type: 'choice',
      instructions: {
        question: 'Grade this translation on the 10/10 scale considering contextual accuracy and natural English phrasing compared to `reference_translation`.',
        guideline: 'Natural synonyms and direct translations, idiomatic expressions, conversational softeners, natural equivalents, and minor English typos/homophones capture the communicative intent perfectly and should receive 10_flawless.'
      },
      options: ['10_flawless', '8_minor_nuance', '5_moderate_error', '3_major_error', '1_fatal_error'],
      criteria: {
        '10_flawless': {
          what: 'Flawless, natural, and contextually idiomatic translation (including minor typos/homophones).',
          not_for: 'Any actual semantic error, inverted voice, or dropped essential clause.'
        },
        '8_minor_nuance': {
          what: 'Good translation that captures the overall meaning, but has a noticeable nuance gap, dropped modifier, or awkward phrasing.',
          not_for: 'Flawless synonyms or major grammatical errors.'
        },
        '5_moderate_error': {
          what: 'Noticeable grammatical or vocabulary error (e.g. potential vs intent, certainty vs possibility, wrong tense, or missed key grammar point).',
          not_for: 'Fatal comprehension failure or minor nuance.'
        },
        '3_major_error': {
          what: 'Major error: wrong core verb, reversed passive/active, inverted subject/object, or vital clause missing.',
          not_for: 'Minor phrasing slips.'
        },
        '1_fatal_error': {
          what: 'Fatal error: completely wrong meaning, inverted polarity, unrelated hallucination, or nonsense.',
          not_for: 'Translations where the core message is recognizable.'
        }
      }
    },
    sentence_critique_summary: {
      type: 'choice',
      instructions: {
        question: 'Identify the primary translation flaw or deduction reason in `user_translation` compared to `japanese_sentence` and `reference_translation`.',
        focus: 'Select no_flaws_accurate if the translation faithfully conveys the communicative intent.'
      },
      options: [
        'no_flaws_accurate',
        'wrong_benefactive_or_recipient',
        'passive_voice_reversed',
        'subject_object_inverted',
        'wrong_verb_or_action',
        'tense_or_aspect_error',
        'potential_or_modality_error',
        'interrogative_or_question_error',
        'minor_nuance_or_word_choice_difference'
      ],
      criteria: {
        no_flaws_accurate: {
          what: 'Accurate, faithful, and natural translation with no notable errors (including valid synonyms, idiomatic equivalents, and conversational softeners).',
          not_for: 'Any translation with actual semantic inversions or dropped clauses.'
        },
        wrong_benefactive_or_recipient: {
          what: 'Confused the recipient or beneficiary of the action (e.g. translated ~てやってくれ as doing a favor for "me" instead of a third party/pet, or confused give/receive direction).',
          examples: ['doing favor for self instead of other']
        },
        passive_voice_reversed: {
          what: 'Reversed passive voice into active (e.g. "was told" translated as "I told"), where subject was receiving the action.',
          examples: ['was told vs told', 'was eaten vs ate']
        },
        subject_object_inverted: {
          what: 'Inverted the grammatical subject and object/agent in an active sentence (who did what to whom).',
          examples: ['dog bit man vs man bit dog']
        },
        wrong_verb_or_action: {
          what: 'The core verb or action was mistranslated or misunderstood.',
          examples: ['eating vs sleeping']
        },
        tense_or_aspect_error: {
          what: 'Past vs present/future tense was confused.',
          examples: ['did vs will do']
        },
        potential_or_modality_error: {
          what: "Potential ('can') vs intent ('will'), or certainty vs possibility.",
          examples: ['can go vs will go']
        },
        interrogative_or_question_error: {
          what: 'Question word or structure was missed or changed (e.g. where vs when, or 何か vs 何).',
          examples: ['what are you waiting for vs are you waiting for something']
        },
        minor_nuance_or_word_choice_difference: {
          what: 'A genuine semantic nuance difference, dropped modifier, or awkward phrasing.',
          not_for: 'Valid natural synonyms like "thought" for 思っていた.'
        }
      }
    },
    benefactive_direction: {
      type: 'choice',
      instructions: 'Evaluate the benefactive direction (who does what for whose benefit, e.g. ~てやる, ~てくれる, ~てもらう) in `user_translation` compared to `japanese_sentence`.',
      options: ['correct_benefactive_or_not_applicable', 'recipient_reversed_self_vs_other', 'benefactive_omitted'],
      criteria: {
        correct_benefactive_or_not_applicable: 'Beneficiary and recipient are correctly understood, or sentence does not use benefactives.',
        recipient_reversed_self_vs_other: 'Translated an action for someone else / third party / pet (~てやる) as an action for oneself ("me"), or vice versa.',
        benefactive_omitted: 'The favor/benefactive nuance was completely dropped.'
      }
    },
    predicate_mood_and_voice: {
      type: 'choice',
      instructions: 'Evaluate the main verb/predicate of `japanese_sentence` in `user_translation` for tense, voice (passive/active), and mood (potential "can" vs intent "will").',
      options: ['correct_or_not_applicable', 'potential_vs_intent_error', 'passive_vs_active_error', 'tense_past_present_error', 'predicate_omitted_or_wrong'],
      criteria: {
        correct_or_not_applicable: 'Predicate tense, voice, and mood are accurately translated.',
        potential_vs_intent_error: 'Potential form ("can") was translated as simple intent ("will") or vice versa.',
        passive_vs_active_error: 'Passive voice ("was seen", "was told") was reversed to active ("I saw", "I told").',
        tense_past_present_error: 'Past tense translated as present/future, or vice versa.',
        predicate_omitted_or_wrong: 'The main action/verb was omitted or mistranslated.'
      }
    },
    polarity_check: {
      type: 'choice',
      instructions: 'Did `user_translation` preserve the affirmative vs negative polarity of `japanese_sentence`?',
      options: ['polarity_preserved', 'polarity_inverted'],
      criteria: {
        polarity_preserved: 'Affirmative remains affirmative; negative remains negative.',
        polarity_inverted: 'Affirmative statement translated as negative, or negative translated as affirmative.'
      }
    },
    predicate_complex_conjugation: {
      type: 'choice',
      instructions: {
        question: 'Analyze any compound, stacked, or heavily inflected predicate in `japanese_sentence` (e.g. causative-passive 〜させられる/〜される, causative-benefactive 〜させてくれる/〜させてやる, potential change-of-state 〜なくなっちゃった, conditional regret 〜なければよかった, double-negative obligation 〜ないわけにはいかない). Did `user_translation` accurately convey the full combination of forms?',
        focus: 'Identify if any layer of the stacked conjugation was inverted, misinterpreted, or dropped.'
      },
      options: [
        'accurate_or_not_stacked',
        'causative_passive_inverted',
        'causative_benefactive_inverted',
        'potential_change_of_state_missed',
        'conditional_regret_missed',
        'double_negative_obligation_inverted'
      ],
      criteria: {
        accurate_or_not_stacked: {
          what: 'The combined meanings of all stacked affixes (causative, passive, tense, benefactive) are accurately conveyed, or predicate is simple.'
        },
        causative_passive_inverted: {
          what: 'Causative-passive (〜させられる / 〜される, e.g. 待たされた, 食べさせられた) was translated as active causative or simple active, inverting who was subjected to the action (e.g. "I made them wait" instead of "I was kept waiting").'
        },
        causative_benefactive_inverted: {
          what: 'Causative-benefactive (〜させてくれる / 〜させてやる / 〜させてもらう, e.g. 行かせてくれた) was misunderstood regarding who granted permission or who performed the action.'
        },
        potential_change_of_state_missed: {
          what: 'Potential + change of state / regret (〜なくなっちゃった / 〜なくなってしまった) was translated as simple past negative rather than becoming unable to do.'
        },
        conditional_regret_missed: {
          what: 'Conditional regret (〜ばよかった / 〜なければよかった) was translated as an active factual condition ("if I do it is good") rather than regret ("I should have / I shouldn\'t have").'
        },
        double_negative_obligation_inverted: {
          what: 'Double negative or bound obligation pattern (〜ないわけにはいかない, 〜ざるを得ない) was translated as a negative/inability ("cannot go") rather than an obligation ("have no choice but to go / must go").'
        }
      }
    }
  };

  // Add granular token questions ONLY for content words/compounds (skip single-char kana particles and auxiliaries)
  const contentWords = (words || []).filter(w => w && w.length > 1 && !['から', 'まで', 'より', 'けど', 'ので', 'のに', 'んだ'].includes(w));
  for (let i = 0; i < contentWords.length; i++) {
    const w = contentWords[i];
    questions[`word_${i}_omitted`] = {
      type: 'noul',
      instructions: `Evaluate whether the core semantic concept or grammatical role of "${w}" in \`japanese_sentence\` is completely missing or unrepresented in \`user_translation\`.`
    };
    questions[`word_${i}_sense`] = {
      type: 'choice',
      instructions: `Evaluate the meaning, idiomatic equivalence, and nuance of "${w}" in \`user_translation\` compared to \`japanese_sentence\`.`,
      options: ['natural_correct_sense', 'awkward_or_literal_misfit', 'mistranslated_or_wrong_meaning', 'not_applicable_if_omitted'],
      criteria: {
        natural_correct_sense: 'The word is translated with natural nuance, idiomatic equivalence, or contextually correct meaning.',
        awkward_or_literal_misfit: 'The translation picked an awkward or overly literal definition that does not fit naturally.',
        mistranslated_or_wrong_meaning: 'The word was translated as an incorrect concept or completely wrong definition.',
        not_applicable_if_omitted: 'The word was omitted or not translated.'
      }
    };
  }

  // Dynamic Excerpt Extraction: Compare student phrasing with reference translation
  const studentChunks = extractPhraseChunks(userDraft);
  const refChunks = extractPhraseChunks(info.sentenceEN);

  if (studentChunks.length > 0 && refChunks.length > 0) {
    const toCriteria = (arr) => Object.fromEntries(arr.map(k => [k, null]));

    questions.flawed_student_excerpt = {
      type: 'choice',
      instructions: {
        question: `Which excerpt in \`student_chunks\` contains the mistranslation or conflicting meaning of "${cleanTarget}"?`,
        focus: 'Pick the specific phrase chunk where the student translation diverges from the Japanese sentence.'
      },
      options: studentChunks,
      criteria: toCriteria(studentChunks)
    };

    questions.correct_reference_excerpt = {
      type: 'choice',
      instructions: {
        question: `Which excerpt in \`reference_chunks\` correctly expresses "${cleanTarget}" in English?`,
        focus: 'Pick the corresponding proper English phrase for this Japanese vocabulary.'
      },
      options: refChunks,
      criteria: toCriteria(refChunks)
    };

    questions.contrast_relation = {
      type: 'choice',
      instructions: {
        question: `Contrast the student excerpt with the reference excerpt for "${cleanTarget}".`,
        focus: 'Characterize the exact difference between the student phrasing and the reference translation.'
      },
      options: [
        'passive_vs_active_reversal',
        'causative_reversal',
        'benefactive_direction_inverted',
        'potential_vs_intent',
        'obligation_vs_absence',
        'counterfactual_regret_vs_condition',
        'question_vs_statement',
        'word_choice_or_nuance_mismatch',
        'accurate_equivalent'
      ],
      criteria: {
        passive_vs_active_reversal: { what: 'Student translated as active subject, reference is passive recipient.' },
        causative_reversal: { what: 'Student translated as active causer, reference is subjected person.' },
        benefactive_direction_inverted: { what: 'Favor direction reversed (doing favor for someone vs receiving favor).' },
        potential_vs_intent: { what: 'Potential ability/can vs future certainty/will.' },
        obligation_vs_absence: { what: 'Obligation (must do) vs absence of obligation.' },
        counterfactual_regret_vs_condition: { what: 'Counterfactual wish/regret vs literal condition.' },
        question_vs_statement: { what: 'Open question vs indefinite pronoun statement.' },
        word_choice_or_nuance_mismatch: { what: 'Literal phrasing or nuance misfit.' },
        accurate_equivalent: { what: 'Student phrasing and reference phrasing are equivalent in meaning.' }
      }
    };
  }

  return { questions, studentChunks, refChunks };
}

function extractPhraseChunks(text) {
  if (!text) return [];
  const clean = text.trim();
  const chunks = new Set();
  const clauses = clean.split(/[,;\—\–]|\b(?:and|but|so|because|although|while|if|when)\b/i)
    .map(s => s.trim().replace(/^[\.,!?"'\s]+|[\.,!?"'\s]+$/g, ''))
    .filter(s => s.length > 0);

  for (const c of clauses) {
    chunks.add(c);
    const subParts = c.split(/\b(?:to|for|at|in|on|by|from|with)\b/i)
      .map(s => s.trim().replace(/^[\.,!?"'\s]+|[\.,!?"'\s]+$/g, ''))
      .filter(s => s.length > 3 && s.includes(' '));
    subParts.forEach(sp => chunks.add(sp));
  }

  if (chunks.size < 2) {
    const words = clean.split(/\s+/);
    if (words.length >= 4) {
      chunks.add(words.slice(0, Math.ceil(words.length / 2)).join(' '));
      chunks.add(words.slice(Math.floor(words.length / 2)).join(' '));
    }
  }
  return Array.from(chunks).slice(0, 5);
}

// Structured questions for Vocab Explanation (replacing buildExplainPrompt)
function buildVocabExplanationQuestions(info) {
  const cleanTarget = (info.vocab || '').replace(/\([^)]*\)/g, '').trim();
  const meanings = (info.meanings || []).slice(0, 8);
  
  // Format meanings as selectable criteria options
  const meaningOptions = [];
  const meaningCriteria = {};
  meanings.forEach((m, idx) => {
    const optKey = `sense_${idx}`;
    meaningOptions.push(optKey);
    meaningCriteria[optKey] = {
      what: m,
      index: idx
    };
  });
  if (meaningOptions.length === 0) {
    meaningOptions.push('sense_0');
    meaningCriteria['sense_0'] = { what: 'primary dictionary meaning', index: 0 };
  }

  const questions = {
    applied_meaning: {
      type: 'choice',
      instructions: {
        question: `Which of the dictionary meanings for "${cleanTarget}" is being used in \`japanese_sentence\`?`,
        field: 'dictionary_sense'
      },
      options: meaningOptions,
      criteria: meaningCriteria
    },
    grammatical_role: {
      type: 'choice',
      instructions: `What is the primary syntactic role of "${cleanTarget}" in \`japanese_sentence\`?`,
      options: [
        'main_predicate_verb',
        'subordinate_clause_verb',
        'direct_object',
        'topic_marker',
        'grammatical_subject',
        'adverbial_modifier',
        'indirect_object_or_target',
        'sentence_ending_particle_or_expression'
      ],
      criteria: {
        main_predicate_verb: 'The primary verb or adjective at the end of the sentence or main clause.',
        subordinate_clause_verb: 'Verb inside an embedded clause, conditional (〜たら, 〜ば), or relative clause.',
        direct_object: 'The noun directly receiving the action (usually marked by を).',
        topic_marker: 'The topic or conversational framing noun (marked by は).',
        grammatical_subject: 'The entity performing the action (marked by が).',
        adverbial_modifier: 'An adverb, time expression, or modifier altering the verb.',
        indirect_object_or_target: 'Target, destination, or indirect object (marked by に, へ, で).',
        sentence_ending_particle_or_expression: 'Colloquial particle, softener, or modal ending (e.g. ね, よ, けど).'
      }
    },
    attachment_and_particles: {
      type: 'choice',
      instructions: `How does "${cleanTarget}" attach to adjacent words in \`japanese_sentence\`?`,
      options: [
        'particle_wo_object',
        'particle_ga_subject',
        'particle_wa_topic',
        'particle_ni_target',
        'particle_to_quotation',
        'direct_noun_modification',
        'te_form_connection',
        'sentence_final'
      ],
      criteria: {
        particle_wo_object: 'Followed by object particle を.',
        particle_ga_subject: 'Followed by subject particle が.',
        particle_wa_topic: 'Followed by topic particle は.',
        particle_ni_target: 'Followed by particle に (target/location/beneficiary).',
        particle_to_quotation: 'Followed by quotative と (e.g. と言う, と思う).',
        direct_noun_modification: 'Directly modifies a noun (attributive / 連体修飾).',
        te_form_connection: 'Connects in te-form (〜て) to an auxiliary verb.',
        sentence_final: 'Occurs at the end of the sentence or clause.'
      }
    },
    inflection_form: {
      type: 'choice',
      instructions: `What grammatical conjugation or inflection form is "${cleanTarget}" in?`,
      options: [
        'uninflected_noun_or_particle',
        'plain_present_dictionary',
        'past_ta_form',
        'te_form',
        'passive_voice',
        'potential_form',
        'causative_or_causative_passive',
        'conditional_form',
        'polite_masu_desu'
      ],
      criteria: {
        uninflected_noun_or_particle: 'Noun, pronoun, or invariable word.',
        plain_present_dictionary: 'Plain non-past dictionary form (e.g. 食べる, 行く).',
        past_ta_form: 'Plain past tense (e.g. た, だ).',
        te_form: 'Te-form (e.g. て, で).',
        passive_voice: 'Passive form (e.g. られる, れる).',
        potential_form: 'Potential form ("can do", e.g. 買える, できる).',
        causative_or_causative_passive: 'Causative (〜せる/〜させる) or Causative-Passive (〜させられる).',
        conditional_form: 'Conditional form (〜たら, 〜ば, 〜なら).',
        polite_masu_desu: 'Polite speech (〜ます, 〜です).'
      }
    },
    pedagogical_tip_type: {
      type: 'choice',
      instructions: 'Which pedagogical tip or common pitfall is most relevant for a Japanese learner encountering this word in this context?',
      options: [
        'give_receive_direction',
        'passive_adversative_nuance',
        'potential_vs_intent',
        'polite_softener_not_literal_contrast',
        'colloquial_contraction',
        'idiomatic_set_phrase',
        'transitive_vs_intransitive_pair',
        'standard_usage'
      ],
      criteria: {
        give_receive_direction: 'Direction of favors (~てやる vs ~てくれる vs ~てもらう).',
        passive_adversative_nuance: 'The Japanese passive often carries an adversative/troubled nuance ("suffering passive").',
        potential_vs_intent: 'Distinguishing ability ("can do") from willingness ("will do").',
        polite_softener_not_literal_contrast: 'Sentence-ending けど / んだけど softens requests rather than meaning a harsh "but".',
        colloquial_contraction: 'Slang or conversational contractions (e.g. 〜ちゃった, 〜じゃん).',
        idiomatic_set_phrase: 'Fixed idiomatic expression whose meaning is greater than individual parts.',
        transitive_vs_intransitive_pair: 'Pair confusion (e.g. 開ける vs 開く, 落とす vs 落ちる).',
        standard_usage: 'Standard straightforward vocabulary usage.'
      }
    }
  };

  return questions;
}

module.exports = {
  buildTranslationRatingQuestions,
  buildVocabExplanationQuestions
};
