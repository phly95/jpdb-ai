const fs = require('fs');
const path = require('path');

// Auto-load .env if present
try {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = (m[2] || '').trim().replace(/^['"]|['"]$/g, '');
      }
    }
  }
} catch {}

const KEY = process.env.GEMINI_API_KEY || '';
if (!KEY) {
  console.error('Error: GEMINI_API_KEY is not set. Please set it in .env or your environment.');
  process.exit(1);
}

const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${KEY}`;

const prompt = `Evaluate student Japanese-to-English translation.
Japanese Sentence: 自分が何を言ったかわかってるよ。
Target Vocab: 何
Reference Translation: I know what I said.
Student Translation: "I throw what I said."

In the "thought" field, perform this strict step-by-step diff before generating the card:
1. English word-by-word diff:
   - Identify every English word/phrase in the student translation that accurately matches the meaning of the reference translation.
   - Pinpoint the exact English word or concept that was changed, replaced, or missing.
2. Japanese meaning mapping:
   - Trace the accurately translated English words back to their Japanese source. Those Japanese words MUST NOT be blamed or marked as errors!
   - Trace the single missing or replaced English concept back to the specific Japanese word/predicate that actually expresses it.
3. Verification:
   - Isolate the error exclusively to the Japanese word/predicate that expresses the missed concept.
   - Do NOT assume the tested target vocab is the error if the student successfully translated that word in English.

Translation Discrepancy & Issue Detection Rules:
- Compare the student's translation strictly against the reference translation and the Japanese sentence.
- Pinpoint the EXACT discrepancy. Be flexible and specific.
- Avoid cascading, repetitive, or phantom issue bullets. If only one word, predicate, or grammatical role was mistranslated, output ONLY ONE issue specifically explaining that exact error. Do not flag other innocent parts of the sentence.
- If there are no errors (10/10), "mistakes" and "advisories" MUST be empty arrays.

Sentence Segmentation Rules:
- Divide the Japanese sentence into a few natural, multi-word grammatical chunks (bunsetsu / clause chunks).
- NEVER split into individual characters or isolated kana (keep verb stems and conjugations intact as whole chunks).
- Mark only the specific chunk that was mistranslated or omitted as "err" (or "advisory" for a minor nuance). Correct chunks must be "ok".
- This should yield a clean presentation of coherent segments (e.g. green segment, red segment, green segment).

Respond ONLY with a valid JSON object matching this schema:
{
  "thought": "Step-by-step English diff, Japanese mapping, and error isolation",
  "card": {
    "score": number (0 to 10),
    "bracket": "Flawless" | "Minor Nuance" | "Moderate Error" | "Major Error" | "Fatal Error",
    "summary": "1 concise sentence specifically describing the assessment",
    "mistakes": [{"word": "Japanese phrase", "description": "Specific explanation of the error"}],
    "advisories": [{"word": "Japanese phrase", "description": "Specific nuance note"}],
    "tokens": [
      {"text": "Natural phrase segment", "status": "ok" | "err" | "advisory"}
    ]
  },
  "markdown": "Detailed critique leading with **Score: X/10 (Bracket)**, then clear breakdown of any issues, then the correct reference translation."
}
Tokens MUST cover the entire Japanese sentence in order without missing characters.`;

async function runSingle(level) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingLevel: level
      }
    }
  };

  const t0 = Date.now();
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const elapsed = Date.now() - t0;
  const data = await res.json();
  const usage = data.usageMetadata || {};
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  let thoughtLen = 0;
  let parsed = null;
  try {
    parsed = JSON.parse(text);
    thoughtLen = parsed.thought ? parsed.thought.length : 0;
  } catch {}
  return {
    elapsed,
    candidatesTokenCount: usage.candidatesTokenCount || 0,
    promptTokenCount: usage.promptTokenCount || 0,
    thoughtLen,
    score: parsed?.card?.score,
    tokensSummary: parsed?.card?.tokens?.map(t => `${t.text}:${t.status}`).join(' ')
  };
}

async function benchmark() {
  console.log('=== Benchmarking 3.5 Flash Lite: Minimal vs Low Thinking Level ===');
  console.log('Running warm-up calls...');
  await runSingle('minimal');
  await runSingle('low');

  const NUM_RUNS = 8;
  const results = { minimal: [], low: [] };

  for (let i = 1; i <= NUM_RUNS; i++) {
    console.log(`\n--- Run ${i}/${NUM_RUNS} ---`);
    
    // Minimal
    const rMin = await runSingle('minimal');
    results.minimal.push(rMin);
    console.log(`[minimal] Latency: ${rMin.elapsed}ms | tokens: ${rMin.candidatesTokenCount} | thought chars: ${rMin.thoughtLen} | score: ${rMin.score}`);

    await new Promise(r => setTimeout(r, 700));

    // Low
    const rLow = await runSingle('low');
    results.low.push(rLow);
    console.log(`[low]     Latency: ${rLow.elapsed}ms | tokens: ${rLow.candidatesTokenCount} | thought chars: ${rLow.thoughtLen} | score: ${rLow.score}`);

    await new Promise(r => setTimeout(r, 700));
  }

  function stats(arr) {
    const latencies = arr.map(x => x.elapsed).sort((a, b) => a - b);
    const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    const median = latencies[Math.floor(latencies.length / 2)];
    const min = latencies[0];
    const max = latencies[latencies.length - 1];
    const avgTokens = Math.round(arr.map(x => x.candidatesTokenCount).reduce((a, b) => a + b, 0) / arr.length);
    const avgThoughtChars = Math.round(arr.map(x => x.thoughtLen).reduce((a, b) => a + b, 0) / arr.length);
    return { avg, median, min, max, avgTokens, avgThoughtChars, latencies };
  }

  const minStats = stats(results.minimal);
  const lowStats = stats(results.low);

  console.log('\n================ SUMMARY ================');
  console.log('MINIMAL thinkingLevel:', minStats);
  console.log('LOW     thinkingLevel:', lowStats);
  console.log('Difference (Low - Minimal):', {
    avgDiffMs: lowStats.avg - minStats.avg,
    medianDiffMs: lowStats.median - minStats.median,
    percentChange: `${Math.round(((lowStats.avg - minStats.avg) / minStats.avg) * 100)}%`
  });
}

benchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
