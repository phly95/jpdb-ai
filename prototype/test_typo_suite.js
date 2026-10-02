const { callJev } = require('./jev_client');
const examples = require('../webapp/examples');

// Helper to extract phrase chunks
function extractPhraseChunks(text) {
  if (!text) return [];
  const clean = text.trim();
  const chunks = new Set();
  const clauses = clean.split(/[,;\—\–]|\b(?:and|but|so|because|although|while|if|when)\b/i)
    .map((s) => s.trim().replace(/^[\.,!?"'\s]+|[\.,!?"'\s]+$/g, ''))
    .filter((s) => s.length > 0);

  for (const c of clauses) {
    chunks.add(c);
    const subParts = c.split(/\b(?:to|for|at|in|on|by|from|with)\b/i)
      .map((s) => s.trim().replace(/^[\.,!?"'\s]+|[\.,!?"'\s]+$/g, ''))
      .filter((s) => s.length > 3 && s.includes(' '));
    subParts.forEach((sp) => chunks.add(sp));
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

function buildQuestionsWithTypo(card, userDraft, words) {
  const cleanTarget = (card.vocab || '').replace(/\([^)]*\)/g, '').trim();
  const studentChunks = extractPhraseChunks(userDraft);
  const refChunks = extractPhraseChunks(card.sentenceEN || '');
  const userWords = (userDraft || '').trim().split(/\s+/).map(w => w.replace(/^[\.,!?"'\s]+|[\.,!?"'\s]+$/g, '')).filter(w => w.length > 0);

  const toCriteria = (arr) => Object.fromEntries(arr.map((k) => [k, null]));

  const questions = {
    is_flawless: {
      type: 'noul',
      instructions: {
        question: 'Is `user_translation` an accurate, faithful, natural, or idiomatic translation of `japanese_sentence` in context?',
        focus: 'Translations that convey the natural communicative meaning, pragmatic tone, or idiomatic sense count as flawless (1.0). Minor English typos, phonetic homophones (e.g. their/there, its/it\'s, hear/here), or autocorrect slips do not disqualify a translation if Japanese comprehension is accurate.'
      }
    },
    english_typo_check: {
      type: 'choice',
      instructions: {
        question: 'Does `user_translation` contain an English keyboard typo, homophone, or autocorrect slip (e.g. "now" for "not", "their" for "there", "we\'ll" for "well", "hear" for "here", "to" for "too", "its" for "it\'s") where the underlying Japanese comprehension was otherwise accurate?',
        focus: 'Determine whether a word discrepancy is a harmless English keyboard/autocorrect slip or a genuine Japanese comprehension failure.'
      },
      options: [
        'no_typos_clean_english',
        'likely_english_typo_with_sound_comprehension',
        'genuine_japanese_comprehension_error'
      ],
      criteria: {
        no_typos_clean_english: 'English is spelled correctly or has only trivial punctuation variation.',
        likely_english_typo_with_sound_comprehension: 'An English word looks like an obvious keyboard typo or autocorrect slip (e.g. typing "now" instead of "not" in "it\'s okay to now know that") where the Japanese grammar was clearly understood.',
        genuine_japanese_comprehension_error: 'The discrepancy is due to mistranslating the Japanese meaning, grammar, or vocabulary, not an English keyboard typo.'
      }
    },
    grade_bracket: {
      type: 'choice',
      instructions: 'Grade this translation on the 10/10 scale considering contextual accuracy and natural English phrasing compared to `reference_translation`. Note: Natural synonyms and direct translations count as 10_flawless. Obvious English typos or homophones (like typing "now" for "not") where Japanese comprehension is accurate should be graded as 8_minor_nuance (8/10), NOT a major or fatal error.',
      options: ['10_flawless', '8_minor_nuance', '5_moderate_error', '3_major_error', '1_fatal_error'],
      criteria: {
        '10_flawless': 'Flawless translation.',
        '8_minor_nuance': 'Good translation with minor nuance difference, dropped secondary modifier, or harmless English typo with sound Japanese comprehension.',
        '5_moderate_error': 'Noticeable grammatical error.',
        '3_major_error': 'Major error: wrong core verb, reversed passive/active, inverted subject/object.',
        '1_fatal_error': 'Fatal error.'
      }
    },
    severity: {
      type: 'score',
      instructions: 'Rate overall accuracy on the 5-point severity scale from 0 (fatal error) to 4 (flawless).',
      legend: ['fatal_error', 'major_error', 'moderate_error', 'minor_nuance', 'flawless'],
      criteria: [
        'Fatal error (Level 0)',
        'Major error (Level 1)',
        'Moderate error (Level 2)',
        'Minor nuance (Level 3)',
        'Flawless (Level 4)'
      ]
    },
    sentence_critique_summary: {
      type: 'choice',
      instructions: 'Identify the primary translation flaw or deduction reason in `user_translation`.',
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
        no_flaws_accurate: 'Accurate and natural.',
        wrong_benefactive_or_recipient: 'Confused benefactive favor direction.',
        passive_voice_reversed: 'Reversed passive voice into active.',
        subject_object_inverted: 'Inverted subject and object.',
        wrong_verb_or_action: 'Core verb mistranslated.',
        tense_or_aspect_error: 'Past vs present/future.',
        potential_or_modality_error: 'Potential vs intent.',
        interrogative_or_question_error: 'Question word missed or changed.',
        minor_nuance_or_word_choice_difference: 'Minor nuance difference.'
      }
    },
    benefactive_direction: {
      type: 'choice',
      instructions: 'Evaluate benefactive direction.',
      options: ['correct_benefactive_or_not_applicable', 'recipient_reversed_self_vs_other', 'benefactive_omitted'],
      criteria: {
        correct_benefactive_or_not_applicable: 'Correct or N/A.',
        recipient_reversed_self_vs_other: 'Reversed self vs other.',
        benefactive_omitted: 'Benefactive omitted.'
      }
    },
    predicate_mood_and_voice: {
      type: 'choice',
      instructions: 'Evaluate tense, voice, and mood.',
      options: ['correct_or_not_applicable', 'potential_vs_intent_error', 'passive_vs_active_error', 'tense_past_present_error', 'predicate_omitted_or_wrong'],
      criteria: {
        correct_or_not_applicable: 'Correct or N/A.',
        potential_vs_intent_error: 'Potential vs intent.',
        passive_vs_active_error: 'Passive vs active.',
        tense_past_present_error: 'Tense error.',
        predicate_omitted_or_wrong: 'Wrong predicate.'
      }
    },
    predicate_complex_conjugation: {
      type: 'choice',
      instructions: 'Analyze any compound or stacked predicate.',
      options: [
        'accurate_or_not_stacked',
        'causative_passive_inverted',
        'causative_benefactive_inverted',
        'potential_change_of_state_missed',
        'conditional_regret_missed',
        'double_negative_obligation_inverted'
      ],
      criteria: {
        accurate_or_not_stacked: 'Accurate or N/A.',
        causative_passive_inverted: 'Causative-passive inverted.',
        causative_benefactive_inverted: 'Causative-benefactive inverted.',
        potential_change_of_state_missed: 'Potential change of state missed.',
        conditional_regret_missed: 'Conditional regret missed.',
        double_negative_obligation_inverted: 'Double negative obligation inverted.'
      }
    }
  };

  if (userWords.length > 0) {
    questions.suspected_typo_word = {
      type: 'choice',
      instructions: 'Which word in `user_translation` is the suspected typo or keyboard slip? If there are no typos, select none.',
      options: ['none', ...userWords.slice(0, 10)],
      criteria: toCriteria(['none', ...userWords.slice(0, 10)])
    };
  }

  if (studentChunks.length > 0 && refChunks.length > 0) {
    questions.flawed_student_excerpt = {
      type: 'choice',
      instructions: 'Which excerpt in `student_chunks` contains the primary mistranslation or nuance divergence?',
      options: studentChunks,
      criteria: toCriteria(studentChunks)
    };
    questions.correct_reference_excerpt = {
      type: 'choice',
      instructions: 'Which excerpt in `reference_chunks` correctly expresses that part in English?',
      options: refChunks,
      criteria: toCriteria(refChunks)
    };
    questions.contrast_relation = {
      type: 'choice',
      instructions: 'Contrast the student excerpt with the reference excerpt.',
      options: [
        'passive_vs_active_reversal',
        'causative_reversal',
        'benefactive_direction_inverted',
        'potential_vs_intent',
        'obligation_vs_absence',
        'counterfactual_regret_vs_condition',
        'question_vs_statement',
        'degree_or_modifier_omitted',
        'word_choice_or_nuance_mismatch',
        'accurate_equivalent'
      ],
      criteria: toCriteria([
        'passive_vs_active_reversal',
        'causative_reversal',
        'benefactive_direction_inverted',
        'potential_vs_intent',
        'obligation_vs_absence',
        'counterfactual_regret_vs_condition',
        'question_vs_statement',
        'degree_or_modifier_omitted',
        'word_choice_or_nuance_mismatch',
        'accurate_equivalent'
      ])
    };
  }

  return questions;
}

// Logic to check safe fast-path eligibility
function evaluateFastPathEligibility(answers, overall, dynamicCritique) {
  if (overall === 10) {
    return { eligible: true, reason: '10/10 Flawless translation' };
  }

  // Typo fast path
  if (answers.english_typo_check?.choice === 'likely_english_typo_with_sound_comprehension' && answers.english_typo_check?.confidence >= 0.80) {
    return { eligible: true, reason: 'High-confidence English typo detection with sound Japanese comprehension' };
  }

  // High-confidence decision-level error detection
  const bracketConf = answers.grade_bracket?.confidence ?? 0;
  const complex = answers.predicate_complex_conjugation;
  const benef = answers.benefactive_direction;
  const summary = answers.sentence_critique_summary;
  const pred = answers.predicate_mood_and_voice;

  const isClearComplexError = complex && complex.choice !== 'accurate_or_not_stacked' && complex.confidence >= 0.75;
  const isClearBenefactiveError = benef && benef.choice === 'recipient_reversed_self_vs_other' && benef.confidence >= 0.80;
  const isClearVoiceError = (summary?.choice === 'passive_voice_reversed' || pred?.choice === 'passive_vs_active_error') && (summary?.confidence >= 0.75 || pred?.confidence >= 0.75);
  const isClearPotentialError = (summary?.choice === 'potential_or_modality_error' || pred?.choice === 'potential_vs_intent_error') && (summary?.confidence >= 0.75 || pred?.confidence >= 0.75);
  const isClearSummaryError = summary && summary.choice !== 'no_flaws_accurate' && summary.confidence >= 0.80;

  if (bracketConf >= 0.65 && (isClearComplexError || isClearBenefactiveError || isClearVoiceError || isClearPotentialError || isClearSummaryError) && dynamicCritique) {
    return { eligible: true, reason: 'High-confidence decision-level structural error detection' };
  }

  return { eligible: false, reason: 'Ambiguous or borderline confidence; requires LLM reasoning' };
}

module.exports = {
  buildQuestionsWithTypo,
  evaluateFastPathEligibility,
  extractPhraseChunks
};
