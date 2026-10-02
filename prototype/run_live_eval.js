// Live Evaluation Runner
// Runs side-by-side comparison between Jev-powered Programmatic Generation vs Generative LLM (Gemini 3.5)

const fs = require('fs');
const { callJev, callLlm } = require('./jev_client');
const { buildTranslationRatingQuestions, buildVocabExplanationQuestions } = require('./schemas');
const { generateTranslationCritique, generateVocabExplanation, assessConfidence } = require('./generator');

function segmentJapanese(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
    return Array.from(segmenter.segment(text))
      .filter(s => s.isWordLike && s.segment.trim().length > 0)
      .map(s => s.segment);
  }
  return text.split('');
}

async function runLiveEvaluation() {
  const rawTestCases = fs.readFileSync(__dirname + '/test_cases.json', 'utf8');
  const testCases = JSON.parse(rawTestCases);

  console.log(`======================================================================`);
  console.log(`🚀 RUNNING LIVE EVALUATION: JEV (SYSTEM ONE) VS GEMINI 3.5 FLASH LITE`);
  console.log(`======================================================================\n`);

  const results = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    console.log(`----------------------------------------------------------------------`);
    console.log(`Test [${i + 1}/${testCases.length}]: ${tc.id} (${tc.type})`);
    console.log(`Japanese: ${tc.card.sentenceJP}`);
    if (tc.userDraft) console.log(`User Draft: "${tc.userDraft}"`);

    const card = { ...tc.card, words: segmentJapanese(tc.card.sentenceJP) };

    if (tc.type === 'translation_critique') {
      const state = {
        japanese_sentence: card.sentenceJP,
        user_translation: tc.userDraft,
        target_vocabulary: card.vocab,
        reference_translation: card.sentenceEN,
        words: card.words
      };
      const questions = buildTranslationRatingQuestions(card, tc.userDraft, card.words);

      // 1. Call Live Jev
      process.stdout.write(`  Calling Jev (${Object.keys(questions).length} parallel questions)... `);
      let jevRes;
      try {
        jevRes = await callJev(state, questions);
        console.log(`Done! (${jevRes.elapsedMs}ms, ${jevRes.usage?.input_tokens || '?'} tokens, $${(jevRes.usage?.cost || 0).toFixed(6)})`);
      } catch (e) {
        console.log(`Failed: ${e.message}`);
        continue;
      }

      // Generate dynamic programmatic explanation
      const programmaticExplanation = generateTranslationCritique(jevRes.answers, card, tc.userDraft);
      const conf = assessConfidence(jevRes.answers);

      // 2. Call Live Gemini for comparison
      const prompt = `Japanese: ${card.sentenceJP}\nCard Translation: ${card.sentenceEN}\nStudent Draft: "${tc.userDraft}"\nRate out of 10 and give concise criticism.`;
      process.stdout.write(`  Calling Gemini 3.5 Flash Lite... `);
      let llmRes;
      try {
        llmRes = await callLlm([
          { role: 'system', content: 'You are a concise Japanese tutor. Score out of 10 and lead with criticism first.' },
          { role: 'user', content: prompt }
        ]);
        console.log(`Done! (${llmRes.elapsedMs}ms, ${llmRes.usage?.total_tokens || '?'} tokens)`);
      } catch (e) {
        console.log(`Failed: ${e.message}`);
        llmRes = { content: 'LLM Error', elapsedMs: 0 };
      }

      console.log(`\n  [JEV DYNAMIC EXPLANATION (Programmatic)]:`);
      console.log(programmaticExplanation.markdown.split('\n').map(l => '    ' + l).join('\n'));

      console.log(`\n  [GEMINI OUTPUT]:`);
      console.log(llmRes.content.slice(0, 300).split('\n').map(l => '    ' + l).join('\n') + (llmRes.content.length > 300 ? '...' : ''));

      results.push({
        id: tc.id,
        type: tc.type,
        jevElapsed: jevRes.elapsedMs,
        llmElapsed: llmRes.elapsedMs,
        speedup: (llmRes.elapsedMs / (jevRes.elapsedMs || 1)).toFixed(1) + 'x',
        jevScore: programmaticExplanation.score,
        jevCritique: jevRes.answers?.sentence_critique_summary?.choice,
        tokenCost: jevRes.usage?.cost || 0
      });

    } else if (tc.type === 'vocab_explanation') {
      const state = {
        japanese_sentence: card.sentenceJP,
        target_vocabulary: card.vocab,
        target_meanings: card.meanings,
        reference_translation: card.sentenceEN
      };
      const questions = buildVocabExplanationQuestions(card);

      // 1. Call Live Jev
      process.stdout.write(`  Calling Jev (Vocab explanation fan-out)... `);
      let jevRes;
      try {
        jevRes = await callJev(state, questions);
        console.log(`Done! (${jevRes.elapsedMs}ms, ${jevRes.usage?.input_tokens || '?'} tokens, $${(jevRes.usage?.cost || 0).toFixed(6)})`);
      } catch (e) {
        console.log(`Failed: ${e.message}`);
        continue;
      }

      const programmaticExplanation = generateVocabExplanation(jevRes.answers, card);

      // 2. Call Live Gemini
      const prompt = `Tested vocab: ${card.vocab}\nSentence: ${card.sentenceJP}\nMeanings: ${card.meanings.join(', ')}\nExplain its grammatical role, applied sense, and usage tip in under 100 words.`;
      process.stdout.write(`  Calling Gemini 3.5 Flash Lite... `);
      let llmRes;
      try {
        llmRes = await callLlm([
          { role: 'system', content: 'You are a concise Japanese tutor.' },
          { role: 'user', content: prompt }
        ]);
        console.log(`Done! (${llmRes.elapsedMs}ms, ${llmRes.usage?.total_tokens || '?'} tokens)`);
      } catch (e) {
        console.log(`Failed: ${e.message}`);
        llmRes = { content: 'LLM Error', elapsedMs: 0 };
      }

      console.log(`\n  [JEV DYNAMIC EXPLANATION (Programmatic)]:`);
      console.log(programmaticExplanation.markdown.split('\n').map(l => '    ' + l).join('\n'));

      console.log(`\n  [GEMINI OUTPUT]:`);
      console.log(llmRes.content.slice(0, 300).split('\n').map(l => '    ' + l).join('\n') + (llmRes.content.length > 300 ? '...' : ''));

      results.push({
        id: tc.id,
        type: tc.type,
        jevElapsed: jevRes.elapsedMs,
        llmElapsed: llmRes.elapsedMs,
        speedup: (llmRes.elapsedMs / (jevRes.elapsedMs || 1)).toFixed(1) + 'x',
        appliedSense: jevRes.answers?.applied_meaning?.choice,
        role: jevRes.answers?.grammatical_role?.choice,
        tokenCost: jevRes.usage?.cost || 0
      });
    }
  }

  console.log(`\n======================================================================`);
  console.log(`📊 LIVE EVALUATION SUMMARY`);
  console.log(`======================================================================`);
  console.table(results);

  fs.writeFileSync(__dirname + '/eval_results.json', JSON.stringify(results, null, 2));
}

runLiveEvaluation().catch(console.error);
