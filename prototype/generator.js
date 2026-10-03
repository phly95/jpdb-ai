// Dynamic Explanation Generator
// Assembles concise, natural, LLM-style explanations directly from Jev decisions

function assessConfidence(answers) {
  let minConf = 1.0;
  let totalConf = 0;
  let count = 0;

  for (const [key, ans] of Object.entries(answers)) {
    if (ans && typeof ans.confidence === 'number') {
      minConf = Math.min(minConf, ans.confidence);
      totalConf += ans.confidence;
      count++;
    }
  }
  const avgConf = count > 0 ? (totalConf / count) : 1.0;
  return { minConf, avgConf };
}

function generateTranslationCritique(answers, cardInfo, userDraft) {
  const { 
    is_flawless, 
    grade_bracket, 
    sentence_critique_summary, 
    predicate_mood_and_voice, 
    benefactive_direction, 
    polarity_check,
    predicate_complex_conjugation 
  } = answers;
  
  const scoreMap = {
    '10_flawless': 10,
    '8_minor_nuance': 8,
    '5_moderate_error': 5,
    '3_major_error': 3,
    '1_fatal_error': 1
  };
  const baseScore = scoreMap[grade_bracket?.choice] || 8;
  const isFlawless = (is_flawless?.noul >= 0.82 && baseScore === 10) || baseScore === 10;

  // 1. Flawless reviews
  if (isFlawless && (!sentence_critique_summary || sentence_critique_summary.choice === 'no_flaws_accurate')) {
    const lines = [
      `**Score: 10/10 (Flawless)**\n`,
      `Your translation accurately captures the meaning, tone, and grammatical intent with no deductions.`
    ];
    if (cardInfo.sentenceEN && cardInfo.sentenceEN.toLowerCase() !== userDraft.trim().toLowerCase()) {
      lines.push(`\n**Reference Translation:**\n"${cardInfo.sentenceEN}"`);
    }
    return {
      score: 10,
      bracket: '10_flawless',
      markdown: lines.join('\n')
    };
  }

  // Bracket label formatting
  const bracketLabels = {
    '8_minor_nuance': 'Minor Nuance',
    '5_moderate_error': 'Moderate Error',
    '3_major_error': 'Major Error',
    '1_fatal_error': 'Fatal Error'
  };
  const label = bracketLabels[grade_bracket?.choice] || 'Evaluation';

  const predWord = cardInfo.vocab || 'The predicate';
  let critiqueText = '';

  // 2. Synthesize dynamic excerpt comparison or concise critique
  const stEx = answers.flawed_student_excerpt?.choice;
  const refEx = answers.correct_reference_excerpt?.choice;
  const rel = answers.contrast_relation?.choice;

  const complex = predicate_complex_conjugation?.choice;
  const pol = polarity_check?.choice;
  const critique = sentence_critique_summary?.choice;
  const pred = predicate_mood_and_voice?.choice;
  const benef = benefactive_direction?.choice;

  if (stEx && refEx && rel && rel !== 'accurate_equivalent') {
    // Dynamic excerpt-grounded natural language contrast
    if (rel === 'passive_vs_active_reversal' || critique === 'passive_voice_reversed' || pred === 'passive_vs_active_error') {
      critiqueText = `Instead of translating **${predWord}** as passive (*"${refEx}"*), your draft translated it actively as *"${stEx}"*, reversing who received the action.`;
    } else if (rel === 'causative_reversal' || complex === 'causative_passive_inverted') {
      critiqueText = `In Japanese, the causative-passive **${predWord}** expresses being subjected to an action (*"${refEx}"*), but you translated it as causing the action (*"${stEx}"*).`;
    } else if (rel === 'benefactive_direction_inverted' || critique === 'wrong_benefactive_or_recipient' || benef === 'recipient_reversed_self_vs_other') {
      critiqueText = `You translated **${predWord}** as *"${stEx}"*, but it indicates a favor received from someone else (*"${refEx}"*), not a favor you performed.`;
    } else if (rel === 'potential_vs_intent' || critique === 'potential_or_modality_error' || pred === 'potential_vs_intent_error') {
      critiqueText = `You translated **${predWord}** as *"${stEx}"*, but the potential form expresses *"${refEx}"* (ability/possibility rather than future certainty).`;
    } else if (rel === 'obligation_vs_absence' || complex === 'double_negative_obligation_inverted') {
      critiqueText = `**${predWord}** expresses an obligation (*"${refEx}"*), but your translation *"${stEx}"* turned it into an absence of obligation.`;
    } else if (rel === 'counterfactual_regret_vs_condition' || complex === 'conditional_regret_missed') {
      critiqueText = `**${predWord}** expresses counterfactual regret (*"${refEx}"*), rather than a literal factual condition (*"${stEx}"*).`;
    } else if (rel === 'question_vs_statement' || critique === 'interrogative_or_question_error') {
      critiqueText = `You translated this as an open question (*"${stEx}"*), but **${predWord}** is an indefinite pronoun in a statement (*"${refEx}"*).`;
    } else {
      critiqueText = `In this context, **${predWord}** naturally translates to *"${refEx}"*, whereas *"${stEx}"* sounds slightly awkward or overly literal.`;
    }
  } else if (complex && complex !== 'accurate_or_not_stacked' && complex !== 'stacked_conjugation_not_applicable') {
    if (complex === 'causative_passive_inverted') {
      critiqueText = `You inverted the causative-passive: **${predWord}** expresses being subjected to an action ("was made to / was kept waiting"), not that you actively made someone else wait.`;
    } else if (complex === 'causative_benefactive_inverted') {
      critiqueText = `You misunderstood the causative-benefactive: **${predWord}** expresses being granted permission or receiving a favor ("let me do it"), not actively forcing someone else.`;
    } else if (complex === 'potential_change_of_state_missed') {
      critiqueText = `**${predWord}** expresses becoming unable to do something with regret ("ended up unable to..."), rather than a simple refusal or past negative.`;
    } else if (complex === 'conditional_regret_missed') {
      critiqueText = `**${predWord}** expresses counterfactual regret ("I should have / wish I hadn't"), rather than a factual condition ("if...").`;
    } else if (complex === 'double_negative_obligation_inverted') {
      critiqueText = `**${predWord}** is an obligation pattern meaning "have no choice but to / must do", but you translated it as an inability ("cannot do").`;
    }
  } else if (pol === 'polarity_inverted') {
    critiqueText = `Polarity reversed: The Japanese sentence expresses a negative statement, but you translated it as affirmative (or vice versa).`;
  } else if (critique === 'passive_voice_reversed' || pred === 'passive_vs_active_error') {
    critiqueText = `You reversed the passive voice: **${predWord}** indicates the subject is receiving the action, not initiating it.`;
  } else if (critique === 'subject_object_inverted') {
    critiqueText = `You inverted who did what to whom: the grammatical subject and object were swapped.`;
  } else if (critique === 'wrong_benefactive_or_recipient' || benef === 'recipient_reversed_self_vs_other') {
    critiqueText = `You reversed the favor direction: **${predWord}** indicates an action performed for someone else rather than for oneself (or vice versa).`;
  } else if (critique === 'interrogative_or_question_error') {
    critiqueText = `You translated this as an open question ("what"), but **${predWord}** is an indefinite pronoun ("something/anything") in a statement of desire.`;
  } else if (critique === 'potential_or_modality_error' || pred === 'potential_vs_intent_error') {
    critiqueText = `**${predWord}** is in the potential form ("can do"), but you translated it as simple future intent ("will do").`;
  } else if (pred === 'tense_past_present_error' || critique === 'tense_or_aspect_error') {
    critiqueText = `Tense mismatch: past tense was translated as present/future (or continuous aspect was missed).`;
  } else if (critique === 'minor_nuance_or_word_choice_difference') {
    if (predWord === '今度') {
      critiqueText = `In an invitation context, **今度** naturally means "sometime soon" or "next time", whereas translating it literally as "this time" sounds awkward in English.`;
    } else {
      critiqueText = `The overall communicative meaning is understood, but there is a slight nuance gap or dropped modifier compared to natural native phrasing.`;
    }
  } else if (critique === 'wrong_verb_or_action') {
    critiqueText = `The core verb or action was misunderstood or mistranslated.`;
  } else {
    critiqueText = `The translation conveys part of the sentence, but misses the precise grammatical structure.`;
  }

  const lines = [
    `**Score: ${baseScore}/10 (${label})**\n`,
    `**Critique:** ${critiqueText}`
  ];

  if (cardInfo.sentenceEN) {
    lines.push(`\n**Reference Translation:**\n"${cardInfo.sentenceEN}"`);
  }

  return {
    score: baseScore,
    bracket: grade_bracket?.choice || '8_minor_nuance',
    markdown: lines.join('\n')
  };
}

function generateVocabExplanation(answers, cardInfo) {
  const { applied_meaning, grammatical_role, attachment_and_particles, inflection_form, pedagogical_tip_type, connected_target_word } = answers;
  
  const cleanTarget = (cardInfo.vocab || '').replace(/\([^)]*\)/g, '').trim();
  const meanings = cardInfo.meanings || [];
  
  let chosenSense = meanings[0] || 'target definition';
  if (applied_meaning && applied_meaning.choice) {
    const match = applied_meaning.choice.match(/sense_(\d+)/);
    if (match && meanings[parseInt(match[1], 10)]) {
      chosenSense = meanings[parseInt(match[1], 10)];
    }
  }

  const role = grammatical_role?.choice;
  const attach = attachment_and_particles?.choice;
  const inflect = inflection_form?.choice;
  const tip = pedagogical_tip_type?.choice;
  const targetWord = (connected_target_word?.choice && connected_target_word.choice !== 'none_or_independent') ? connected_target_word.choice : null;

  const inflectionLabels = {
    plain_present_dictionary: 'plain non-past dictionary form',
    past_ta_form: 'past tense (〜た / 〜だ)',
    te_form: 'connective 〜て form',
    passive_voice: 'passive voice (〜られる / 〜れる)',
    potential_form: 'potential form ("can do")',
    causative_or_causative_passive: 'causative or causative-passive form',
    conditional_form: 'conditional form (〜たら / 〜ば / 〜なら)',
    polite_masu_desu: 'polite form (〜ます / 〜です)',
    adverbial_form: 'adverbial form'
  };

  const isInflectionConfident = (inflection_form?.confidence || 0) >= 0.75;
  const inflectionText = isInflectionConfident && inflect && inflect !== 'uninflected_noun_or_particle'
    ? ` (${inflectionLabels[inflect] || inflect})`
    : '';

  let roleExplanation = '';

  if (role === 'direct_object') {
    if (targetWord) {
      roleExplanation = `functioning as the direct object (marked by **を**) in the clause with **${targetWord}**`;
    } else {
      roleExplanation = `functioning as the direct object receiving the action of the verb, marked by **を**`;
    }
  } else if (role === 'grammatical_subject') {
    if (targetWord) {
      roleExplanation = `functioning as the grammatical subject (marked by **が**) associated with **${targetWord}**`;
    } else {
      roleExplanation = `functioning as the grammatical subject performing or undergoing the action, marked by the identifier particle **が**`;
    }
  } else if (role === 'topic_marker') {
    roleExplanation = `functioning as the conversational topic and contextual anchor of the sentence, framed by the topic particle **は**`;
  } else if (role === 'indirect_object_or_destination') {
    if (targetWord) {
      roleExplanation = `indicating the destination, target, or recipient for **${targetWord}**, marked by **に** / **へ**`;
    } else {
      roleExplanation = `indicating the target, recipient, or direction of the action, marked by **に** / **へ**`;
    }
  } else if (role === 'location_or_means') {
    if (targetWord) {
      roleExplanation = `specifying the location, means, or instrument where **${targetWord}** takes place, marked by **で**`;
    } else {
      roleExplanation = `specifying the location of the action or the means used, marked by **で**`;
    }
  } else if (role === 'demonstrative_determiner') {
    const cleanNoun = targetWord ? targetWord.replace(/[はがをにでとのへ]+$/, '') : '';
    roleExplanation = cleanNoun
      ? `functioning as a demonstrative determiner (連体詞) directly modifying the noun **${cleanNoun}**`
      : `functioning as a demonstrative determiner (連体詞) specifying the following noun`;
  } else if (role === 'noun_modifying_relative_clause') {
    const cleanNoun = targetWord ? targetWord.replace(/[はがをにでとのへ]+$/, '') : '';
    if (cleanNoun) {
      roleExplanation = `functioning as an attributive modifier directly describing the noun **${cleanNoun}**`;
    } else {
      roleExplanation = `functioning as an attributive / relative clause directly modifying the following noun`;
    }
  } else if (role === 'adverbial_modifier') {
    if (targetWord) {
      roleExplanation = `functioning as an adverbial modifier modifying the predicate **${targetWord}**`;
    } else {
      roleExplanation = `functioning as an adverbial modifier describing manner, degree, or time`;
    }
  } else if (role === 'connective_te_form') {
    if (targetWord) {
      roleExplanation = `is in the connective 〜て form, chaining this action into **${targetWord}**`;
    } else {
      roleExplanation = `is in the connective 〜て form, linking sequential actions or attaching to an auxiliary verb`;
    }
  } else if (role === 'subordinate_clause_verb') {
    roleExplanation = `functioning as the verb within an embedded, conditional, or subordinate clause`;
  } else if (role === 'particle_or_sentence_ender') {
    roleExplanation = `functions as a conversational particle or sentence-ending expression providing pragmatic nuance`;
  } else {
    // main_predicate_verb
    roleExplanation = `serving as the main predicate verb of the sentence${inflectionText}`;
  }

  const tipsMap = {
    ko_so_a_do_proximity: 'Remember the ko-so-a-do proximity system: こ- indicates something close to the speaker (or currently being mentioned), そ- is close to the listener, あ- is distant from both, and ど- is the question form ("which").',
    prenoun_determiner_no_particle: 'This word is a pre-noun determiner (連体詞): it always modifies a noun directly and cannot stand alone or take particles like の or は.',
    give_receive_direction: 'Pay attention to favor direction: 〜てやる is done for someone younger, a pet, or third party; 〜てくれる is done for the speaker ("for me"); 〜てもらう is receiving a favor.',
    passive_adversative_nuance: 'In Japanese, the passive voice often expresses that the subject was negatively affected or troubled by someone else\'s action (the "adversative" or suffering passive).',
    potential_vs_intent: 'Potential forms express capability or opportunity ("can do"), not just future intention.',
    polite_softener_not_literal_contrast: 'Sentence-ending softeners like 〜けど or 〜んだけど soften the tone and avoid abruptness; they rarely mean a harsh "but".',
    colloquial_contraction: 'Note the conversational contraction used here in casual speech.',
    transitive_vs_intransitive_pair: 'Watch out for transitive vs. intransitive verb pairing in this construction.',
    polysemous_idiomatic_sense: `Notice how context dictates this specific sense over other dictionary definitions.`,
    case_particle_governance: 'Pay close attention to which particle marks this word (を for direct object, が for subject, に for target, で for location/means).',
    standard_usage: role === 'demonstrative_determiner'
      ? 'Remember the ko-so-a-do system: この refers to something physically or contextually close to the speaker.'
      : 'Focus on how the attached particle or inflection connects this word to the main predicate.'
  };

  const lines = [
    `### Role of **${cleanTarget}** in this Sentence\n`,
    `In this sentence, **${cleanTarget}** means **"${chosenSense}"**, ${roleExplanation}.\n`,
    `💡 **Key Nuance:** ${tipsMap[tip] || tipsMap.standard_usage}`
  ];

  return {
    markdown: lines.join('\n')
  };
}

module.exports = {
  assessConfidence,
  generateTranslationCritique,
  generateVocabExplanation
};
