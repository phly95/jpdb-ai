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

  // Test 1: Flawless Rating
  console.log('--- Test 1: Rate Flawless Translation ---');
  const t0 = Date.now();
  const raw1 = await callGemini([
    { role: 'system', content: 'You are a Japanese tutor. Output valid JSON only.' },
    {
      role: 'user',
      content: `Evaluate student translation.
Sentence: 自分が何を言ったかわかってるよ。
Target Vocab: 何
Reference: I know what I said.
Student Translation: "I know what I said."

Respond ONLY with valid JSON:
{
  "card": {
    "score": 10,
    "bracket": "Flawless",
    "summary": "1 concise sentence summary",
    "mistakes": [],
    "advisories": [],
    "tokens": [{"text": "segment", "status": "ok"}]
  },
  "markdown": "Detailed critique leading with **Score: 10/10 (Flawless)**"
}`
    }
  ], true);
  console.log(`Latency: ${Date.now() - t0}ms`);
  const parsed1 = parseJsonResponse(raw1);
  console.log('Score:', parsed1.card.score, parsed1.card.bracket);
  console.log('Summary:', parsed1.card.summary);
  console.log('HTML Card:\n', renderRatingCard(parsed1.card, MODEL));
  console.log('Markdown:\n', parsed1.markdown);

  // Test 2: Error Rating
  console.log('\n--- Test 2: Rate Translation with Error ---');
  const t1 = Date.now();
  const raw2 = await callGemini([
    { role: 'system', content: 'You are a Japanese tutor. Output valid JSON only.' },
    {
      role: 'user',
      content: `Evaluate student translation.
Sentence: 自分が何を言ったかわかってるよ。
Target Vocab: 何
Reference: I know what I said.
Student Translation: "I know what you said."

Respond ONLY with valid JSON:
{
  "card": {
    "score": number (0-10),
    "bracket": "Flawless" | "Minor Nuance" | "Moderate Error" | "Major Error" | "Fatal Error",
    "summary": "1 concise sentence summary",
    "mistakes": [{"word": "segment", "description": "why"}],
    "advisories": [{"word": "segment", "description": "why"}],
    "tokens": [{"text": "segment", "status": "ok" | "err" | "advisory"}]
  },
  "markdown": "Detailed critique leading with **Score: X/10 (Bracket)**"
}`
    }
  ], true);
  console.log(`Latency: ${Date.now() - t1}ms`);
  const parsed2 = parseJsonResponse(raw2);
  console.log('Score:', parsed2.card.score, parsed2.card.bracket);
  console.log('Summary:', parsed2.card.summary);
  console.log('Mistakes:', parsed2.card.mistakes);
  console.log('HTML Card:\n', renderRatingCard(parsed2.card, MODEL));
  console.log('Markdown:\n', parsed2.markdown);

  // Test 3: Explain Vocab Role
  console.log('\n--- Test 3: Explain Vocab Role ---');
  const t2 = Date.now();
  const raw3 = await callGemini([
    { role: 'system', content: 'You are a Japanese tutor. Output valid JSON only.' },
    {
      role: 'user',
      content: `Explain tested vocab role.
Sentence: 自分が何を言ったかわかってるよ。
Target Vocab: 何
Meanings: what, which
Reference: I know what I said.

Respond ONLY with valid JSON:
{
  "card": {
    "role": "e.g. Direct Object",
    "applied_sense": "what",
    "connected_with": "言ったか",
    "tokens": [{"text": "segment", "status": "ok" | "target" | "connected"}]
  },
  "markdown": "### Role of 何 in this Sentence\\n..."
}`
    }
  ], true);
  console.log(`Latency: ${Date.now() - t2}ms`);
  const parsed3 = parseJsonResponse(raw3);
  console.log('Role:', parsed3.card.role);
  console.log('Applied Sense:', parsed3.card.applied_sense);
  console.log('Connected With:', parsed3.card.connected_with);
  console.log('HTML Card:\n', renderVocabCard(parsed3.card, MODEL));
  console.log('Markdown:\n', parsed3.markdown);

  // Test 4: Follow-up Chat Turn
  console.log('\n--- Test 4: Follow-up Chat Turn ---');
  const t3 = Date.now();
  const reply4 = await callGemini([
    { role: 'system', content: 'You are a concise Japanese tutor. Respond in markdown.' },
    { role: 'user', content: 'What does "何" do in this sentence?\nSentence: 自分が何を言ったかわかってるよ。' },
    { role: 'assistant', content: parsed3.markdown }, // Note: Clean markdown outside of pill in history!
    { role: 'user', content: 'Why is "か" placed after 言った?' }
  ], false);
  console.log(`Latency: ${Date.now() - t3}ms`);
  console.log('Assistant Reply:\n', reply4);

  console.log('\n=== All Tests Succeeded! ===');
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
