const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const examples = require('./examples');
const { callJev, callLlm } = require('../prototype/jev_client');
const { buildTranslationRatingQuestions, buildVocabExplanationQuestions } = require('../prototype/schemas');
const { generateTranslationCritique, generateVocabExplanation, assessConfidence } = require('../prototype/generator');

const PORT = 3030;
const CACHE_FILE = path.join(__dirname, 'cache.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function segmentJapanese(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
    return Array.from(segmenter.segment(text))
      .filter(s => s.isWordLike && s.segment.trim().length > 0)
      .map(s => s.segment);
  }
  return text.split('');
}

function getCachedData() {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch {}
  }
  return {};
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: Get all examples with cached evaluation data
  if (pathname === '/api/examples' && req.method === 'GET') {
    const cache = getCachedData();
    const combined = examples.map(ex => {
      const cached = cache[ex.id];
      if (cached) return cached;
      return {
        ...ex,
        routing: { isPureJevFastPath: false, decisionReason: 'Pending live computation' },
        jev: null,
        llm: null
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(combined));
    return;
  }

  // API: Run Live Evaluation on custom or selected item
  if (pathname === '/api/evaluate' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(bodyStr);
        const { mode, card, userDraft, id } = payload;
        const processedCard = {
          ...card,
          words: segmentJapanese(card.sentenceJP)
        };

        if (mode === 'translation_critique') {
          const qData = buildTranslationRatingQuestions(processedCard, userDraft, processedCard.words);
          const questions = qData.questions || qData;
          const state = {
            japanese_sentence: processedCard.sentenceJP,
            user_translation: userDraft,
            target_vocabulary: processedCard.vocab,
            reference_translation: processedCard.sentenceEN,
            words: processedCard.words,
            student_chunks: qData.studentChunks || [],
            reference_chunks: qData.refChunks || []
          };

          const t0Jev = Date.now();
          const jevRes = await callJev(state, questions);
          const explanation = generateTranslationCritique(jevRes.answers, processedCard, userDraft);
          const conf = assessConfidence(jevRes.answers);
          const isPureJevFastPath = explanation.score === 10 && conf.minConf >= 0.80;

          const prompt = `Japanese: ${processedCard.sentenceJP}\nReference: ${processedCard.sentenceEN}\nStudent: "${userDraft}"\nRate out of 10 and give concise criticism.`;
          const llmRes = await callLlm([
            { role: 'system', content: 'You are a concise Japanese tutor. Score out of 10 and lead with criticism first.' },
            { role: 'user', content: prompt }
          ]);

          const result = {
            id: id || 'custom_' + Date.now(),
            mode: 'translation_critique',
            card: processedCard,
            userDraft,
            routing: {
              isPureJevFastPath,
              decisionReason: isPureJevFastPath
                ? 'Fast Deterministic Path: 10/10 Flawless rating with high confidence. Zero LLM needed.'
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

          // Save to cache if it matches an existing ID
          if (id) {
            const cache = getCachedData();
            cache[id] = { ...cache[id], ...result };
            fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;

        } else {
          // Vocab explanation
          const state = {
            japanese_sentence: processedCard.sentenceJP,
            target_vocabulary: processedCard.vocab,
            target_meanings: processedCard.meanings,
            reference_translation: processedCard.sentenceEN
          };
          const questions = buildVocabExplanationQuestions(processedCard);

          const jevRes = await callJev(state, questions);
          const explanation = generateVocabExplanation(jevRes.answers, processedCard);
          const conf = assessConfidence(jevRes.answers);

          const prompt = `Tested vocab: ${processedCard.vocab}\nSentence: ${processedCard.sentenceJP}\nMeanings: ${processedCard.meanings.join(', ')}\nExplain its grammatical role, applied sense, and usage tip in under 100 words.`;
          const llmRes = await callLlm([
            { role: 'system', content: 'You are a concise Japanese tutor.' },
            { role: 'user', content: prompt }
          ]);

          const result = {
            id: id || 'custom_' + Date.now(),
            mode: 'vocab_explanation',
            card: processedCard,
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

          if (id) {
            const cache = getCachedData();
            cache[id] = { ...cache[id], ...result };
            fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
        }

      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Static file serving from public/
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`JPDB AI Evaluation Webapp listening on http://127.0.0.1:${PORT}`);
});
