// Precompute live evaluations for the 100 example catalog
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPrecompute() {
  console.log(`=== Starting Precomputation on ${examples.length} Examples ===`);

  let cache = {};
  if (fs.existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch {}
  }

  // 1. First run Jev evaluations for all examples that need them
  const jevResults = {};
  const roleDistribution = {};

  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];
    const card = { ...ex.card, words: segmentJapanese(ex.card.sentenceJP) };

    if (cache[ex.id]?.jev && cache[ex.id]?.routing) {
      jevResults[ex.id] = cache[ex.id].jev;
      if (ex.mode === 'vocab_explanation') {
        const r = cache[ex.id].jev.role || 'unknown';
        roleDistribution[r] = (roleDistribution[r] || 0) + 1;
      }
      continue;
    }

    process.stdout.write(`[${i + 1}/${examples.length}] Jev evaluating '${ex.id}' (${ex.mode})... `);
    const t0 = Date.now();

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

        const res = await callJev(state, questions);
        const explanation = generateTranslationCritique(res.answers, card, ex.userDraft);
        const conf = assessConfidence(res.answers);
        const isPureJevFastPath = explanation.score === 10 || (conf.minConf >= 0.80);

        jevResults[ex.id] = {
          elapsedMs: res.elapsedMs,
          score: explanation.score,
          bracket: explanation.bracket,
          critique: res.answers?.sentence_critique_summary?.choice,
          answers: res.answers,
          confidence: conf,
          tokenCost: res.usage?.cost || 0,
          generatedMarkdown: explanation.markdown
        };

        cache[ex.id] = {
          ...ex,
          card,
          routing: {
            isPureJevFastPath,
            decisionReason: isPureJevFastPath
              ? 'Fast Deterministic Path: High-confidence Jev decision. Zero LLM needed.'
              : 'Critique Path: Detailed structured error detected by Jev. Programmatic feedback generated, compared against LLM.'
          },
          jev: jevResults[ex.id]
        };
        console.log(`Done (${res.elapsedMs}ms, Score: ${explanation.score}/10)`);
      } else {
        // Vocab explanation
        const state = {
          japanese_sentence: card.sentenceJP,
          target_vocabulary: card.vocab,
          target_meanings: card.meanings,
          reference_translation: card.sentenceEN,
          words: card.words
        };
        const questions = buildVocabExplanationQuestions(card);

        const res = await callJev(state, questions);
        const explanation = generateVocabExplanation(res.answers, card);
        const conf = assessConfidence(res.answers);
        const role = res.answers?.grammatical_role?.choice || 'main_predicate_verb';
        roleDistribution[role] = (roleDistribution[role] || 0) + 1;

        jevResults[ex.id] = {
          elapsedMs: res.elapsedMs,
          appliedSense: res.answers?.applied_meaning?.choice,
          role,
          connectedWord: res.answers?.connected_target_word?.choice,
          attachment: res.answers?.attachment_and_particles?.choice,
          answers: res.answers,
          confidence: conf,
          tokenCost: res.usage?.cost || 0,
          generatedMarkdown: explanation.markdown
        };

        cache[ex.id] = {
          ...ex,
          card,
          routing: {
            isPureJevFastPath: true,
            decisionReason: 'Fast Vocab Explanation: Syntactic role, sense disambiguation, and attachment resolved by Jev (<250ms).'
          },
          jev: jevResults[ex.id]
        };
        console.log(`Done (${res.elapsedMs}ms, Role: ${role})`);
      }

      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
  }

  // 2. Parallel LLM Dispatch (spaced 1000ms apart as requested)
  console.log('\n=== Starting 1-per-second Parallel LLM Evaluation ===');
  const itemsNeedingLlm = examples.filter((ex) => !cache[ex.id]?.llm || !cache[ex.id].llm.content || cache[ex.id].llm.content.includes('429'));
  console.log(`Items needing LLM comparative evaluation: ${itemsNeedingLlm.length}`);

  const activePromises = [];

  for (let i = 0; i < itemsNeedingLlm.length; i++) {
    const ex = itemsNeedingLlm[i];
    const card = ex.card;

    let msgs;
    if (ex.mode === 'translation_critique') {
      const prompt = `Japanese: ${card.sentenceJP}\nReference: ${card.sentenceEN}\nStudent: "${ex.userDraft}"\nRate out of 10 and give concise criticism.`;
      msgs = [
        { role: 'system', content: 'You are a concise Japanese tutor. Score out of 10 and lead with criticism first.' },
        { role: 'user', content: prompt }
      ];
    } else {
      const prompt = `Tested vocab: ${card.vocab}\nSentence: ${card.sentenceJP}\nMeanings: ${card.meanings.join(', ')}\nExplain its grammatical role, applied sense, and usage tip in under 80 words.`;
      msgs = [
        { role: 'system', content: 'You are a concise Japanese tutor.' },
        { role: 'user', content: prompt }
      ];
    }

    const p = (async (index, item) => {
      try {
        const llmRes = await callLlm(msgs);
        const jevElapsed = cache[item.id]?.jev?.elapsedMs || 200;
        const speedup = (llmRes.elapsedMs / jevElapsed).toFixed(1) + 'x';

        cache[item.id].llm = {
          elapsedMs: llmRes.elapsedMs,
          content: llmRes.content,
          tokenCost: (llmRes.usage?.total_tokens || 0) * 0.0000005
        };
        cache[item.id].speedup = speedup;
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
        console.log(`  ✓ [LLM ${index + 1}/${itemsNeedingLlm.length}] '${item.id}' completed (${llmRes.elapsedMs}ms, ${speedup} speedup)`);
      } catch (e) {
        console.warn(`  ✗ [LLM ${index + 1}/${itemsNeedingLlm.length}] '${item.id}' error: ${e.message}`);
      }
    })(i, ex);

    activePromises.push(p);

    // Rate-limit launcher to 1 request per second
    if (i < itemsNeedingLlm.length - 1) {
      await sleep(1000);
    }
  }

  // Await all parallel LLM calls
  await Promise.all(activePromises);

  console.log('\n=== PRECOMPUTATION SUMMARY ===');
  console.log(`Total examples in catalog: ${examples.length}`);
  console.log(`Cached entries in cache.json: ${Object.keys(cache).length}`);
  console.log('\nVocab Grammatical Role Distribution (50 entries):');
  console.table(roleDistribution);
}

runPrecompute();
