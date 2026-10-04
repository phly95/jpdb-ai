// End-to-end test script for JPDB AI Gemini simplified flow
const ENDPOINT = 'http://100.117.72.11:20128/v1/chat/completions';
const API_KEY = 'sk-32c602f2a3bf0a64-sc09zk-98456489';
const MODEL = 'ag/gemini-3.8-flash-low';

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

function renderRatingCard(card, modelName) {
  if (!card) return '';
  const score = typeof card.score === 'number' ? Math.round(card.score * 10) / 10 : 10;
  const scoreClass = score >= 9.5 ? 'high' : (score >= 7 ? 'med' : 'low');
  const bracket = card.bracket || (score >= 9.5 ? 'Flawless' : (score >= 8 ? 'Minor Nuance' : (score >= 5 ? 'Moderate Error' : (score >= 3 ? 'Major Error' : 'Fatal Error'))));
  const tag = (modelName || '').split('/').pop() || 'gemini';

  const isFlawless = score >= 9.5;
  const isMinor = score >= 7 && score < 9.5;
  const mistakes = Array.isArray(card.mistakes) ? card.mistakes : (Array.isArray(card.issues) ? card.issues.filter(i => i.type === 'mistake') : []);
  const advisories = Array.isArray(card.advisories) ? card.advisories : (Array.isArray(card.issues) ? card.issues.filter(i => i.type === 'advisory') : []);
  const tokens = Array.isArray(card.tokens) ? card.tokens : [];

  return `
<details class="jpdb-ai-jev-card" open>
  <summary class="jpdb-ai-jev-head">
    <span class="jpdb-ai-jev-title">⚡ Instant Assessment <span class="jpdb-ai-jev-tag">${escapeHtml(tag)}</span></span>
    <span class="jpdb-ai-jev-score ${scoreClass}">${score}/10 (${escapeHtml(bracket)})</span>
  </summary>
  <div class="jpdb-ai-jev-body">
    ${isFlawless ? `
      <div class="jpdb-ai-jev-flawless">
        <span class="jpdb-ai-jev-check">✓</span> ${escapeHtml(card.summary || 'Flawless translation — all words & nuances accurately conveyed!')}
      </div>
    ` : `
      ${card.summary ? `
        <div class="jpdb-ai-jev-summary ${isMinor ? 'minor' : ''}">
          <span class="jpdb-ai-jev-summary-icon">⚠️</span>
          <div>${escapeHtml(card.summary)}</div>
        </div>
      ` : ''}
      ${mistakes.length > 0 ? `
        <div class="jpdb-ai-jev-mistakes">
          <div class="jpdb-ai-jev-mistakes-title">Detected Issues:</div>
          <ul class="jpdb-ai-jev-mistakes-list">
            ${mistakes.map(m => `<li><span class="jpdb-ai-jev-word">${escapeHtml(m.word || m.segment || '')}</span>: <span class="jpdb-ai-jev-desc">${escapeHtml(m.description || '')}</span></li>`).join('')}
          </ul>
        </div>
      ` : ''}
      ${advisories.length > 0 ? `
        <div class="jpdb-ai-jev-advisories" style="${mistakes.length > 0 ? 'margin-top:6px;' : ''}">
          <div class="jpdb-ai-jev-advisories-title">Nuance Notes:</div>
          <ul class="jpdb-ai-jev-advisories-list">
            ${advisories.map(a => `<li><span class="jpdb-ai-jev-word advisory">${escapeHtml(a.word || a.segment || '')}</span>: <span class="jpdb-ai-jev-desc">${escapeHtml(a.description || '')}</span></li>`).join('')}
          </ul>
        </div>
      ` : ''}
    `}
    ${tokens.length > 0 ? `
      <div class="jpdb-ai-jev-tokens">
        ${tokens.map(t => {
          const status = (t.status || 'ok').toLowerCase();
          const cls = status === 'err' || status === 'mistake' ? 'err' : (status === 'advisory' || status === 'warn' ? 'advisory' : 'ok');
          return `<span class="jpdb-ai-jev-token ${cls}">${escapeHtml(t.text)}</span>`;
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
<details class="jpdb-ai-jev-card" open>
  <summary class="jpdb-ai-jev-head">
    <span class="jpdb-ai-jev-title">⚡ Instant Vocab Explainer <span class="jpdb-ai-jev-tag">${escapeHtml(tag)}</span></span>
    <span class="jpdb-ai-jev-score ok" style="background:#2b2250;color:#c4b5fd;border:1px solid #6366f1;text-transform:capitalize;">${escapeHtml(roleLabel)}</span>
  </summary>
  <div class="jpdb-ai-jev-body">
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
      <div class="jpdb-ai-jev-tokens">
        ${tokens.map(t => {
          const status = (t.status || 'ok').toLowerCase();
          const cls = status === 'target' ? 'target' : (status === 'connected' || status === 'advisory' ? 'advisory' : 'ok');
          return `<span class="jpdb-ai-jev-token ${cls}">${escapeHtml(t.text)}</span>`;
        }).join(' ')}
      </div>
    ` : ''}
  </div>
</details>`.trim();
}

async function callGemini(messages, isJson = false) {
  const payload = {
    model: MODEL,
    messages,
    stream: false
  };
  if (isJson) {
    payload.response_format = { type: 'json_object' };
  }

  const res = await fetch(ENDPOINT, {
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
  return data.choices[0].message.content;
}

async function runTests() {
  console.log('=== JPDB AI Gemini Single-Call Flow Test ===\n');

  // Test 1: Single-word error (Image 1 case: "I throw what I said.")
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

Translation Discrepancy & Issue Detection Rules:
- Compare the student's translation strictly against the reference translation and the Japanese sentence.
- Pinpoint the EXACT discrepancy. Be flexible and specific.
- Avoid cascading, repetitive, or phantom issue bullets. If only one word, predicate, or grammatical role was mistranslated, output ONLY ONE issue specifically explaining that exact error. Do not flag other innocent parts of the sentence.

Sentence Segmentation Rules:
- Divide the Japanese sentence into a few natural, multi-word grammatical chunks (bunsetsu/clause chunks, e.g. "自分が", "何を言ったか", "わかってるよ").
- NEVER split into individual characters or isolated kana (keep verb stems and conjugations intact as whole chunks).
- Mark only the specific chunk that was mistranslated or omitted as "err" (or "advisory" for a minor nuance). Correct chunks must be "ok".
- This should yield a clean presentation of coherent segments (e.g. green segment, red segment, green segment).

Respond ONLY with valid JSON:
{
  "card": {
    "score": 4,
    "bracket": "Major Error",
    "summary": "1 concise sentence specifically describing the assessment",
    "mistakes": [{"word": "Japanese phrase", "description": "Specific explanation of the error"}],
    "advisories": [],
    "tokens": [
      {"text": "Natural phrase segment", "status": "ok" | "err" | "advisory"}
    ]
  },
  "markdown": "Detailed critique leading with **Score: X/10 (Bracket)**, then clear breakdown of any issues, then the correct reference translation."
}`
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
- Keep verb forms and conjugations intact as whole words (e.g. keep "何を" or "何", and "言った" or "言ったか" intact; never split single kanji like "言" + "った").
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
