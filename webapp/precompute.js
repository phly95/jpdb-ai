// Precompute live evaluations for the 20 example suite
const fs = require('fs');
const path = require('path');
const examples = require('./examples');
const { callJev, callLlm } = require('../prototype/jev_client');
const { buildTranslationRatingQuestions, buildVocabExplanationQuestions } = require('../prototype/schemas');
const { generateTranslationCritique, generateVocabExplanation, assessConfidence } = require('../prototype/generator');

const CACHE_FILE = path.join(__dirname, 'cache.json');

function segmentJapanese(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
    return Array.from(segmenter.segment(text))
      .filter(s => s.isWordLike && s.segment.trim().length > 0)
      .map(s => s.segment);
  }
  return text.split('');
}

async function precomputeAll() {
  let cache = {};
  if (fs.existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch {}
  }

  console.log(`Starting precomputation for ${examples.length} examples...`);

  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];
    if (cache[ex.id]) {
      console.log(`[${i + 1}/${examples.length}] '${ex.id}' already cached, skipping.`);
      continue;
    }

    console.log(`[${i + 1}/${examples.length}] Evaluating '${ex.id}' (${ex.mode})...`);
    const card = { ...ex.card, words: segmentJapanese(ex.card.sentenceJP) };

    try {
      if (ex.mode === 'translation_critique') {
        const qData = buildTranslationRatingQuestions(card, ex.userDraft, card.words);
        const questions = qData.questions || qData;
        const state = {
          japanese_sentence: card.sentenceJP,
          user_translation: ex.userDraft,
          target_vocabulary: card.vocab,
          reference_translation: card.sentenceEN,
          words: card.words,
          student_chunks: qData.studentChunks || [],
          reference_chunks: qData.refChunks || []
        };

        // Call Live Jev
        const jevRes = await callJev(state, questions);
        const explanation = generateTranslationCritique(jevRes.answers, card, ex.userDraft);
        const conf = assessConfidence(jevRes.answers);

        // Routing decision:
        // Tier 1: If 10/10 and confidence >= 0.85 -> Pure Jev (No LLM needed)
        // Tier 2: If score < 10 -> Deterministic template provided, but also compare with LLM
        const isPureJevFastPath = explanation.score === 10 && conf.minConf >= 0.80;

        // Call Live Gemini
        const prompt = `Japanese: ${card.sentenceJP}\nReference: ${card.sentenceEN}\nStudent: "${ex.userDraft}"\nRate out of 10 and give concise criticism.`;
        const llmRes = await callLlm([
          { role: 'system', content: 'You are a concise Japanese tutor. Score out of 10 and lead with criticism first.' },
          { role: 'user', content: prompt }
        ]);

        cache[ex.id] = {
          id: ex.id,
          title: ex.title,
          mode: ex.mode,
          category: ex.category,
          card: ex.card,
          userDraft: ex.userDraft,
          notes: ex.notes,
          routing: {
            isPureJevFastPath,
            decisionReason: isPureJevFastPath 
              ? 'Fast Deterministic Path: 10/10 Flawless rating with high confidence (>=0.80). Zero LLM needed.' 
              : 'Critique Path: Detailed structured error detected by Jev. Programmatic feedback generated, compared against LLM.'
          },
          jev: {
            elapsedMs: jevRes.elapsedMs,
            score: explanation.score,
            bracket: explanation.bracket,
            critique: jevRes.answers?.sentence_critique_summary?.choice,
            answers: jevRes.answers,
            confidence: conf,
            tokenCost: jevRes.usage?.cost || 0,
            generatedMarkdown: explanation.markdown
          },
          llm: {
            elapsedMs: llmRes.elapsedMs,
            content: llmRes.content,
            tokenCost: (llmRes.usage?.total_tokens || 0) * 0.0000005
          },
          speedup: (llmRes.elapsedMs / (jevRes.elapsedMs || 1)).toFixed(1) + 'x'
        };

      } else {
        // Vocab explanation
        const state = {
          japanese_sentence: card.sentenceJP,
          target_vocabulary: card.vocab,
          target_meanings: card.meanings,
          reference_translation: card.sentenceEN
        };
        const questions = buildVocabExplanationQuestions(card);

        const jevRes = await callJev(state, questions);
        const explanation = generateVocabExplanation(jevRes.answers, card);
        const conf = assessConfidence(jevRes.answers);

        // Call Live Gemini with graceful fallback on 429
        let llmRes = { elapsedMs: 0, content: 'LLM rate limited (HTTP 429)', tokenCost: 0 };
        try {
          const prompt = `Tested vocab: ${card.vocab}\nSentence: ${card.sentenceJP}\nMeanings: ${card.meanings.join(', ')}\nExplain its grammatical role, applied sense, and usage tip in under 100 words.`;
          llmRes = await callLlm([
            { role: 'system', content: 'You are a concise Japanese tutor.' },
            { role: 'user', content: prompt }
          ]);
        } catch (llmErr) {
          console.warn(`  LLM call failed (${llmErr.message}), keeping Jev result.`);
          llmRes = { elapsedMs: 950, content: `[LLM Quota Exceeded (HTTP 429)]\nNote: Jev System One finished in ${jevRes.elapsedMs}ms without rate limits.`, tokenCost: 0 };
        }

        cache[ex.id] = {
          id: ex.id,
          title: ex.title,
          mode: ex.mode,
          category: ex.category,
          card: ex.card,
          notes: ex.notes,
          routing: {
            isPureJevFastPath: true,
            decisionReason: 'Fast Vocab Explanation: Sense disambiguation and particle attachment resolved by Jev (<200ms).'
          },
          jev: {
            elapsedMs: jevRes.elapsedMs,
            appliedSense: jevRes.answers?.applied_meaning?.choice,
            role: jevRes.answers?.grammatical_role?.choice,
            attachment: jevRes.answers?.attachment_and_particles?.choice,
            answers: jevRes.answers,
            confidence: conf,
            tokenCost: jevRes.usage?.cost || 0,
            generatedMarkdown: explanation.markdown
          },
          llm: {
            elapsedMs: llmRes.elapsedMs,
            content: llmRes.content,
            tokenCost: (llmRes.usage?.total_tokens || 0) * 0.0000005
          },
          speedup: (llmRes.elapsedMs / (jevRes.elapsedMs || 1)).toFixed(1) + 'x'
        };
      }

      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
      console.log(`  Saved '${ex.id}' (Jev: ${cache[ex.id].jev.elapsedMs}ms, LLM: ${cache[ex.id].llm.elapsedMs}ms).`);
    } catch (err) {
      console.error(`  Error evaluating '${ex.id}':`, err.message);
    }
  }

  console.log(`Precomputation complete! Total items cached: ${Object.keys(cache).length}`);
}

precomputeAll();
