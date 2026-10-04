// End-to-end test script for JPDB AI Gemini simplified flow
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

const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.LLM_MODEL || 'gemini-3.5-flash-lite';
const BASE_URL = process.env.LLM_BASE || 'https://generativelanguage.googleapis.com/v1beta';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseJsonResponse(rawText) {
  let text = String(rawText || '').trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  try {
    return JSON.parse(text);
  } catch {}

  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {}
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.substring(firstBrace, lastBrace + 1));
    } catch {}
  }

  return null;
}

function renderRatingCard(card, modelName, isCardReview = false) {
  if (!card) return '';
  const score = typeof card.score === 'number' ? Math.round(card.score * 10) / 10 : 10;
  const scoreClass = score >= 9.5 ? 'high' : (score >= 7 ? 'med' : 'low');
  const bracket = card.bracket || (score >= 9.5 ? 'Flawless' : (score >= 8 ? 'Minor Nuance' : (score >= 5 ? 'Moderate Error' : (score >= 3 ? 'Major Error' : 'Fatal Error'))));
  const tag = (modelName || '').split('/').pop() || 'gemini';
  const cardTitle = isCardReview ? 'Card Translation Assessment' : 'Translation Assessment';

  const isFlawless = score >= 9.5;
  const isMinor = score >= 7 && score < 9.5;
  const mistakes = Array.isArray(card.mistakes) ? card.mistakes : (Array.isArray(card.issues) ? card.issues.filter(i => i.type === 'mistake') : []);
  const advisories = Array.isArray(card.advisories) ? card.advisories : (Array.isArray(card.issues) ? card.issues.filter(i => i.type === 'advisory') : []);
  const tokens = Array.isArray(card.tokens) ? card.tokens : [];

  return `
<details class="jpdb-ai-card" open>
  <summary class="jpdb-ai-card-head">
    <span class="jpdb-ai-card-title">${escapeHtml(cardTitle)} <span class="jpdb-ai-card-tag">${escapeHtml(tag)}</span></span>
    <span class="jpdb-ai-card-score ${scoreClass}">${score}/10 (${escapeHtml(bracket)})</span>
  </summary>
  <div class="jpdb-ai-card-body">
    ${isFlawless ? `
      <div class="jpdb-ai-card-flawless">
        <span class="jpdb-ai-card-check">✓</span> ${escapeHtml(card.summary || 'Flawless translation — all words & nuances accurately conveyed!')}
      </div>
    ` : `
      ${card.summary ? `
        <div class="jpdb-ai-card-summary ${isMinor ? 'minor' : ''}">
          <span class="jpdb-ai-card-summary-icon">⚠️</span>
          <div>${escapeHtml(card.summary)}</div>
        </div>
      ` : ''}
      ${mistakes.length > 0 ? `
        <div class="jpdb-ai-card-mistakes">
          <div class="jpdb-ai-card-mistakes-title">Detected Issues:</div>
          <ul class="jpdb-ai-card-mistakes-list">
            ${mistakes.map(m => `<li><span class="jpdb-ai-card-word">${escapeHtml(m.word || m.segment || '')}</span>: <span class="jpdb-ai-card-desc">${escapeHtml(m.description || '')}</span></li>`).join('')}
          </ul>
        </div>
      ` : ''}
      ${advisories.length > 0 ? `
        <div class="jpdb-ai-card-advisories" style="${mistakes.length > 0 ? 'margin-top:6px;' : ''}">
          <div class="jpdb-ai-card-advisories-title">Nuance Notes:</div>
          <ul class="jpdb-ai-card-advisories-list">
            ${advisories.map(a => `<li><span class="jpdb-ai-card-word advisory">${escapeHtml(a.word || a.segment || '')}</span>: <span class="jpdb-ai-card-desc">${escapeHtml(a.description || '')}</span></li>`).join('')}
          </ul>
        </div>
      ` : ''}
    `}
    ${tokens.length > 0 ? `
      <div class="jpdb-ai-card-tokens">
        ${tokens.map(t => {
          const status = (t.status || 'ok').toLowerCase();
          const cls = status === 'err' || status === 'mistake' ? 'err' : (status === 'advisory' || status === 'warn' ? 'advisory' : 'ok');
          return `<span class="jpdb-ai-card-token ${cls}">${escapeHtml(t.text)}</span>`;
        }).join(' ')}
      </div>
    ` : ''}
  </div>
</details>`.trim();
}

function renderVocabCard(card, modelName) {
  if (!card) return '';
  const tag = (modelName || '').split('/').pop() || 'gemini';
  const roleLabel = (card.role || 'vocab role').replace(/_/g, ' ');
  const tokens = Array.isArray(card.tokens) ? card.tokens : [];

  return `
<details class="jpdb-ai-card" open>
  <summary class="jpdb-ai-card-head">
    <span class="jpdb-ai-card-title">Vocab Explainer <span class="jpdb-ai-card-tag">${escapeHtml(tag)}</span></span>
    <span class="jpdb-ai-card-score ok" style="background:#2b2250;color:#c4b5fd;border:1px solid #6366f1;text-transform:capitalize;">${escapeHtml(roleLabel)}</span>
  </summary>
  <div class="jpdb-ai-card-body">
    ${card.applied_sense ? `
      <div style="font-size:12px;margin-bottom:4px;">
        <strong>Applied Sense:</strong> "${escapeHtml(card.applied_sense)}"
      </div>
    ` : ''}
    ${card.connected_with ? `
      <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">
        <strong>Connected With:</strong> ${escapeHtml(card.connected_with)}
      </div>
    ` : ''}
    ${tokens.length > 0 ? `
      <div class="jpdb-ai-card-tokens">
        ${tokens.map(t => {
          const status = (t.status || 'ok').toLowerCase();
          const cls = status === 'target' ? 'target' : (status === 'connected' || status === 'advisory' ? 'advisory' : 'ok');
          return `<span class="jpdb-ai-card-token ${cls}">${escapeHtml(t.text)}</span>`;
        }).join(' ')}
      </div>
    ` : ''}
  </div>
</details>`.trim();
}

async function callGemini(messages, isJson = false) {
  if (!API_KEY) {
    throw new Error('GEMINI_API_KEY is not set. Please set it in .env or your environment.');
  }

  const isGoogle = BASE_URL.includes('generativelanguage.googleapis.com');
  if (isGoogle) {
    const url = `${BASE_URL.replace(/\/+$/, '')}/models/${MODEL}:generateContent`;
    const contents = [];
    let sysInstruction = '';
    for (const m of messages) {
      if (m.role === 'system') sysInstruction = (sysInstruction ? sysInstruction + '\n\n' : '') + m.content;
      else contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
    }
    const body = {
      contents,
      generationConfig: {
        responseMimeType: isJson ? 'application/json' : 'text/plain',
        thinkingConfig: { thinkingLevel: 'low' }
      }
    };
    if (sysInstruction) {
      body.systemInstruction = { parts: [{ text: sysInstruction }] };
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': API_KEY
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  // OpenAI-compatible endpoint
  const payload = {
    model: MODEL,
    messages,
    stream: false
  };
  if (isJson) {
    payload.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function runTests() {
  console.log('=== JPDB AI Gemini Single-Call Flow Test ===\n');

  // Test 1: Single-word error
  console.log('--- Test 1: Rate Translation with 1 Discrepancy ("I throw what I said.") ---');
  const raw1 = await callGemini([
    { role: 'system', content: 'You are a precise, insightful Japanese tutor. Output valid JSON only.' },
    {
      role: 'user',
      content: `Evaluate student Japanese-to-English translation.
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
Tokens MUST cover the entire Japanese sentence in order without missing characters.`
    }
  ], true);
  const parsed1 = parseJsonResponse(raw1);
  console.log('Score:', parsed1.card.score, parsed1.card.bracket);
  console.log('Summary:', parsed1.card.summary);
  console.log('Mistakes count:', parsed1.card.mistakes.length);
  console.log('Mistakes:', parsed1.card.mistakes);
  console.log('Tokens:', parsed1.card.tokens);
  console.log('\nHTML Card:\n', renderRatingCard(parsed1.card, MODEL));

  // Test 2: Vocab Explainer with intact chunks
  console.log('\n--- Test 2: Explain Vocab Role (Intact Chunks) ---');
  const raw2 = await callGemini([
    { role: 'system', content: 'You are a precise, insightful Japanese tutor. Output valid JSON only.' },
    {
      role: 'user',
      content: `Explain the grammatical role and meaning of the tested vocabulary in this specific Japanese sentence.
Japanese Sentence: 自分が何を言ったかわかってるよ。
Target Vocabulary: 何
Dictionary Meanings: what, which
Reference Translation: I know what I said.

Sentence Segmentation Rules:
- Divide the Japanese sentence into a few natural, multi-word grammatical chunks / bunsetsu.
- Keep verb forms and conjugations intact as whole words.
- Mark the target vocabulary chunk with status "target".
- Mark the specific complete predicate/word it directly modifies, attaches to, or governs with status "connected".
- Mark all other chunks with status "ok".

Respond ONLY with valid JSON:
{
  "card": {
    "role": "Direct Object",
    "applied_sense": "what",
    "connected_with": "言ったか",
    "tokens": [
      {"text": "Natural phrase segment", "status": "ok" | "target" | "connected"}
    ]
  },
  "markdown": "### Role of 何 in this Sentence\\n..."
}`
    }
  ], true);
  const parsed2 = parseJsonResponse(raw2);
  console.log('Role:', parsed2.card.role);
  console.log('Applied Sense:', parsed2.card.applied_sense);
  console.log('Connected With:', parsed2.card.connected_with);
  console.log('Tokens:', parsed2.card.tokens);
  console.log('\nHTML Card:\n', renderVocabCard(parsed2.card, MODEL));

  console.log('\n=== All Tests Succeeded! ===');
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
