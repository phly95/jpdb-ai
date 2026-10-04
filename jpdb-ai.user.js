// ==UserScript==
// @name         JPDB AI Vocab Explainer
// @namespace    https://github.com/jpdb-ai/
// @version      2.0.6
// @description  Single-model Gemini-powered Japanese tutor for jpdb.io reviews with instant visual assessment and interactive chat.
// @author       you
// @match        https://jpdb.io/review*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Do not run on learn pages
  if (location.pathname.startsWith('/learn')) return;

  // ---------- Config Defaults ----------
  const DEFAULT_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
  const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
  const DEFAULT_API_KEY = '';

  // Keep reasoning cheap/fast: "low" thinking level
  const REASONING_EFFORT = 'low';

  let updateFoot = () => {};
  let updateShortcutsUI = () => {};
  let updateDiagUI = () => {};

  const CFG = {
    get base() {
      try {
        const val = GM_getValue('jpdb_ai_base', DEFAULT_API_BASE);
        if (!val || val === 'http://100.117.72.11:20128/v1') return DEFAULT_API_BASE;
        return val.trim().replace(/\/+$/, '');
      } catch { return DEFAULT_API_BASE; }
    },
    get model() {
      try {
        const val = GM_getValue('jpdb_ai_model', DEFAULT_MODEL);
        if (!val || val === 'ag/gemini-3.8-flash-low') return DEFAULT_MODEL;
        return val.trim();
      } catch { return DEFAULT_MODEL; }
    },
    get key() {
      try {
        const val = GM_getValue('jpdb_ai_key', DEFAULT_API_KEY);
        if (!val || val === 'sk-32c602f2a3bf0a64-sc09zk-98456489') return DEFAULT_API_KEY;
        return val.trim();
      } catch { return DEFAULT_API_KEY; }
    },
    get invertEnter() { try { return !!GM_getValue('jpdb_ai_invert_enter', false); } catch { return false; } },

    set base(v) { GM_setValue('jpdb_ai_base', (v || '').trim().replace(/\/+$/, '')); },
    set model(v) { GM_setValue('jpdb_ai_model', (v || '').trim()); },
    set key(v) { GM_setValue('jpdb_ai_key', (v || '').trim()); },
    set invertEnter(v) { GM_setValue('jpdb_ai_invert_enter', !!v); },
  };

  try {
    GM_registerMenuCommand('Open AI Settings', () => {
      if (typeof ensureFab === 'function') ensureFab();
      if (typeof ensurePanel === 'function') ensurePanel();
      if (typeof toggle === 'function') toggle(true);
      if (typeof toggleSettingsView === 'function') toggleSettingsView(true);
    });
  } catch {}

  // Safe DOM text helper
  function textOf(selector, parent = document) {
    const el = parent.querySelector(selector);
    return el ? el.textContent.trim() : '';
  }

  // Get a unique token for the current card
  function getCardToken() {
    try {
      const params = new URLSearchParams(location.search);
      const paramC = params.get('c');
      if (paramC) return paramC.trim();
    } catch {}
    const sent = document.querySelector('.card-sentence .sentence, .sentence')?.textContent?.trim();
    if (sent) return sent;
    return location.pathname;
  }

  // Detect whether the answer is shown or currently hidden
  function isAnswerShown() {
    if (document.getElementById('show-answer')) return false;
    if (document.querySelector('[id^="grade-"], #grade-f, #grade-p, #grade-1')) return true;
    return (location.hash || '').includes('a') && !document.getElementById('show-answer');
  }

  // Background cache for preloaded card definitions
  const cardDataCache = {};

  async function fetchAnswerData(cToken) {
    if (!cToken) return null;
    if (cardDataCache[cToken]) return cardDataCache[cToken];
    try {
      const rEl = document.querySelector('input[name="r"]');
      const r = rEl ? rEl.value : '5';
      const url = '/review?c=' + encodeURIComponent(cToken) + '&r=' + encodeURIComponent(r);
      const res = await fetch(url);
      if (!res.ok) return null;
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, 'text/html');

      let vocabEl =
        doc.querySelector('.answer-box a.plain[href*="/vocabulary/"]') ||
        doc.querySelector('a.plain[href*="/vocabulary/"]') ||
        doc.querySelector('[class*="vocab"] a[href*="/vocabulary/"]');
      let vocab = vocabEl ? vocabEl.textContent.trim() : '';
      if (!vocab) {
        const fallback =
          doc.querySelector('.answer-box .plain') ||
          doc.querySelector('.question-box .plain') ||
          doc.querySelector('.review-reveal .plain');
        if (fallback) {
          const clone = fallback.cloneNode(true);
          clone.querySelectorAll('rt, rp, .icon-link, i, [class*="audio"]').forEach((x) => x.remove());
          vocab = clone.textContent.trim();
        }
      }

      const meaningEls = doc.querySelectorAll('.subsection-meanings .description');
      const meanings = Array.from(meaningEls)
        .map((e) => {
          const clone = e.cloneNode(true);
          const subDiv = clone.querySelector('div');
          let subText = '';
          if (subDiv) {
            subText = subDiv.textContent.replace(/\s+/g, ' ').trim();
            subDiv.remove();
          }
          const mainGloss = clone.textContent.replace(/\s+/g, ' ').trim();
          return (mainGloss + (subText ? ' — ' + subText : '')).trim();
        })
        .filter(Boolean)
        .slice(0, 12);
      const pos = textOf('.subsection-meanings .part-of-speech', doc);

      const transEl =
        doc.querySelector('.sentence-translation') ||
        doc.querySelector('.en');
      const sentenceEN = transEl ? transEl.textContent.replace(/\s+/g, ' ').trim() : '';

      const exampleEls = doc.querySelectorAll('.subsection-examples .used-in');
      const examples = Array.from(exampleEls).slice(0, 3).map((e) => e.textContent.replace(/\s+/g, ' ').trim());

      const data = {
        vocab,
        meanings,
        pos,
        sentenceEN,
        examples,
        doc,
        container: doc.querySelector('div.container'),
        html: text,
      };
      cardDataCache[cToken] = data;
      return data;
    } catch (err) {
      console.warn('[JPDB AI] Prefetch answer data error:', err);
      return null;
    }
  }

  async function ensureCardData() {
    const token = getCardToken();
    if (token && !cardDataCache[token] && !isAnswerShown()) {
      await fetchAnswerData(token);
    }
  }

  function prefetchIfQuestion() {
    if (!isAnswerShown()) {
      const token = getCardToken();
      if (token && !cardDataCache[token]) {
        fetchAnswerData(token).then(() => {
          if (isPanelOpen()) refreshCtx();
        });
      }
    }
  }

  function extractCardInfo() {
    function getCleanDomText(el) {
      if (!el) return '';
      const clone = el.cloneNode(true);
      clone.querySelectorAll('rt, rp').forEach((r) => r.remove());
      return clone.textContent.trim();
    }

    let vocabEl =
      document.querySelector('.answer-box a.plain[href*="/vocabulary/"]') ||
      document.querySelector('a.plain[href*="/vocabulary/"]') ||
      document.querySelector('[class*="vocab"] a[href*="/vocabulary/"]');
    let vocab = vocabEl ? getCleanDomText(vocabEl) : '';

    let vocabId = '';
    try {
      const params = new URLSearchParams(location.search);
      const c = params.get('c') || (document.querySelector('input[name="c"]')?.value || '');
      const parts = c.split(',');
      if (parts.length >= 2) vocabId = parts[1];
    } catch {}

    if (!vocab) {
      const fallback =
        document.querySelector('.answer-box .plain') ||
        document.querySelector('.question-box .plain') ||
        document.querySelector('.review-reveal .plain');
      if (fallback) {
        const clone = fallback.cloneNode(true);
        clone.querySelectorAll('rt, rp, .icon-link, i, [class*="audio"]').forEach((x) => x.remove());
        vocab = clone.textContent.trim();
      }
    }

    const sentEl =
      document.querySelector('.card-sentence .sentence') ||
      document.querySelector('.sentence:not(.blur)') ||
      document.querySelector('.sentence') ||
      document.querySelector('[class*="sentence"]');
    let sentenceJP = sentEl ? getCleanDomText(sentEl) : '';

    const transEl =
      document.querySelector('.card-sentence .translation') ||
      document.querySelector('.sentence-translation') ||
      document.querySelector('.translation') ||
      document.querySelector('.en');
    let sentenceEN = transEl ? transEl.textContent.trim() : '';

    const meaningEls = document.querySelectorAll('.subsection-meanings .description');
    let meanings = Array.from(meaningEls)
      .map((e) => {
        const clone = e.cloneNode(true);
        const subDiv = clone.querySelector('div');
        let subText = '';
        if (subDiv) {
          subText = subDiv.textContent.replace(/\s+/g, ' ').trim();
          subDiv.remove();
        }
        const mainGloss = clone.textContent.replace(/\s+/g, ' ').trim();
        return (mainGloss + (subText ? ' — ' + subText : '')).trim();
      })
      .filter(Boolean)
      .slice(0, 12);

    let pos = textOf('.subsection-meanings .part-of-speech') || textOf('.part-of-speech');

    const cached = cardDataCache[getCardToken()];
    if (cached) {
      if (!vocab && cached.vocab) vocab = cached.vocab;
      if (!sentenceEN && cached.sentenceEN) sentenceEN = cached.sentenceEN;
      if ((!meanings || meanings.length === 0) && cached.meanings && cached.meanings.length) meanings = cached.meanings;
      if (!pos && cached.pos) pos = cached.pos;
    }

    const cleanVocab = (vocab || '').replace(/\([^)]*\)/g, '').trim();
    const cleanSentenceJP = (sentenceJP || '').replace(/\([^)]*\)/g, '').trim();

    return {
      vocab,
      cleanVocab,
      vocabId,
      sentenceJP,
      cleanSentenceJP,
      sentenceEN,
      meanings,
      pos,
    };
  }

  // ---------- LLM Networking (OpenAI & Gemini Native Supported) ----------
  function gmPost(url, headers, body, timeout) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers,
        data: JSON.stringify(body),
        timeout: timeout || 60000,
        onload: (res) => resolve(res),
        onerror: (e) => reject(e),
        ontimeout: () => reject(new Error('Request timed out')),
      });
    });
  }

  function extractStreamingText(accumulatedText) {
    if (!accumulatedText) return '';
    const events = accumulatedText.split(/\r?\n\r?\n/);
    let fullText = '';
    for (const ev of events) {
      const lines = ev.split(/\r?\n/);
      for (const l of lines) {
        const trimmed = l.trim();
        if (trimmed.startsWith('data:')) {
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload);
            const delta = obj.choices?.[0]?.delta?.content ||
                          (obj.type === 'response.output_text.delta' ? obj.delta : '') ||
                          (typeof obj.delta === 'string' ? obj.delta : '');
            if (delta) fullText += delta;
          } catch {}
        }
      }
    }
    return fullText;
  }

  function extractTextFromResponses(data) {
    if (!data || typeof data !== 'object') return '';
    if (Array.isArray(data.candidates) && data.candidates[0]?.content?.parts) {
      const parts = data.candidates[0].content.parts.map((p) => p.text || '').join('');
      if (parts) return parts;
    }
    if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
    if (Array.isArray(data.output)) {
      let chunks = [];
      for (const item of data.output) {
        if (item && item.type === 'message' && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c && c.type === 'output_text' && typeof c.text === 'string') chunks.push(c.text);
          }
        }
      }
      if (chunks.length) return chunks.join('');
    }
    if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
      return data.choices[0].message.content;
    }
    return '';
  }

  function parseResponseText(responseText) {
    const raw = String(responseText || '').trim();
    if (!raw) return '';
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        const data = JSON.parse(raw);
        const txt = extractTextFromResponses(data);
        if (txt) return txt.trim();
      } catch {}
    }
    const streamed = extractStreamingText(raw);
    if (streamed) return streamed.trim();
    return '';
  }

  async function callLLM(messages, options = {}) {
    const base = CFG.base;
    let model = CFG.model;
    const key = CFG.key;
    const isJson = !!options.json;

    if (model.toLowerCase().includes('gemini') && model.includes(' ')) {
      model = model.trim().toLowerCase().replace(/\s+/g, '-');
    }

    const isGoogleNative = (base.includes('generativelanguage.googleapis.com') && !base.includes('/openai')) || base.includes(':generateContent');

    if (isGoogleNative) {
      if (!key) {
        throw new Error('Google Gemini API key is missing. Please enter your API key in Settings (⚙️).');
      }

      let url = base;
      if (!url.includes(':generateContent')) {
        url = url.replace(/\/+$/, '') + '/models/' + encodeURIComponent(model.replace(/^models\//, '')) + ':generateContent';
      }
      if (key && !url.includes('key=')) {
        url += (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key);
      }
      const gHeaders = { 'Content-Type': 'application/json' };
      if (key) {
        gHeaders['x-goog-api-key'] = key;
      }

      const contents = [];
      let sysInstruction = '';
      for (const m of messages) {
        if (m.role === 'system') {
          sysInstruction = (sysInstruction ? sysInstruction + '\n\n' : '') + m.content;
        } else {
          const role = m.role === 'assistant' ? 'model' : 'user';
          const last = contents[contents.length - 1];
          if (last && last.role === role) {
            last.parts.push({ text: m.content });
          } else {
            contents.push({
              role: role,
              parts: [{ text: m.content }]
            });
          }
        }
      }
      const gBody = { contents };
      if (sysInstruction) {
        gBody.systemInstruction = { parts: [{ text: sysInstruction }] };
      }
      gBody.generationConfig = {};
      if (isJson) {
        gBody.generationConfig.responseMimeType = 'application/json';
      }
      if (REASONING_EFFORT) {
        gBody.generationConfig.thinkingConfig = { thinkingLevel: REASONING_EFFORT };
      }

      try {
        const res = await gmPost(url, gHeaders, gBody, 60000);
        if (res.status >= 200 && res.status < 300) {
          const text = parseResponseText(res.responseText);
          if (text) return text.trim();
          throw new Error('Empty response from Gemini API');
        } else {
          throw new Error('Gemini API (' + res.status + '): ' + String(res.responseText || '').slice(0, 200));
        }
      } catch (err) {
        if (base.includes('generativelanguage.googleapis.com')) {
          throw err;
        }
        console.warn('[JPDB AI] Google native API call failed, falling back to OpenAI format:', err);
      }
    }

    // Standard OpenAI-compatible Chat Completions
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = 'Bearer ' + key;

    const cBody = {
      model,
      messages,
      max_tokens: 32000,
      stream: false,
      reasoning_effort: REASONING_EFFORT,
    };
    if (isJson) {
      cBody.response_format = { type: 'json_object' };
    }

    let firstErr = null;
    try {
      const chatUrl = base.endsWith('/chat/completions') ? base : (base.replace(/\/+$/, '') + '/chat/completions');
      const res = await gmPost(chatUrl, headers, cBody, 60000);
      if (res.status >= 200 && res.status < 300) {
        const text = parseResponseText(res.responseText);
        if (text) return text.trim();
        throw new Error('Empty response from model');
      } else {
        firstErr = new Error('Chat API (' + res.status + '): ' + String(res.responseText || '').slice(0, 200));
      }
    } catch (e) {
      firstErr = e;
    }

    // Fallback: Responses API non-streaming
    let systemInstruction = '';
    const input = [];
    for (const m of messages) {
      if (m.role === 'system') systemInstruction = (systemInstruction ? systemInstruction + '\n\n' : '') + m.content;
      else input.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
    }
    const rBody = {
      model,
      input,
      instructions: systemInstruction || undefined,
      max_output_tokens: 32000,
      stream: false,
      reasoning: { effort: REASONING_EFFORT },
      reasoning_effort: REASONING_EFFORT,
    };
    if (isJson) {
      rBody.response_format = { type: 'json_object' };
    }

    try {
      const respUrl = base.endsWith('/responses') ? base : (base.replace(/\/+$/, '') + '/responses');
      const res2 = await gmPost(respUrl, headers, rBody);
      if (res2.status >= 200 && res2.status < 300) {
        const text2 = parseResponseText(res2.responseText);
        if (text2) return text2.trim();
        throw new Error('Empty response from model');
      } else {
        throw new Error('Responses API (' + res2.status + '): ' + String(res2.responseText || '').slice(0, 200));
      }
    } catch (e2) {
      throw new Error(`Model API request failed: [Chat completions: ${firstErr?.message || 'unknown'}] | [Responses: ${e2?.message || 'unknown'}]`);
    }
  }

  // ---------- Prompts ----------
  const SYSTEM_PROMPT = 'You are a concise, insightful Japanese tutor helping a student reviewing on jpdb.io. Prefer short, practical explanations. Use simple English with Japanese examples. Use markdown formatting (bold, bullet lists). Always address the exact sentence and context given.';

  function buildRateTranslationPrompt(info, userDraft) {
    const cleanJp = info.cleanSentenceJP || info.sentenceJP;
    return `Evaluate student Japanese-to-English translation.
Japanese Sentence: ${cleanJp}
Target Vocab: ${info.cleanVocab || info.vocab || '(unknown)'}
Reference Translation: ${info.sentenceEN || '(none)'}
Student Translation: "${userDraft || info.sentenceEN || ''}"

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
  }

  function buildVocabExplanationPrompt(info) {
    const cleanJp = info.cleanSentenceJP || info.sentenceJP;
    const cleanTarget = info.cleanVocab || info.vocab;
    const meaningsList = (info.meanings || []).slice(0, 8).join(', ');

    return `Explain the grammatical role and meaning of the tested vocabulary in this specific Japanese sentence.
Japanese Sentence: ${cleanJp}
Target Vocabulary: ${cleanTarget}
Dictionary Meanings: ${meaningsList || '(none)'}
Reference Translation: ${info.sentenceEN || '(none)'}

In the "thought" field:
1. Identify the tested word's specific grammatical role (e.g. direct object, subject, topic).
2. Identify what exact word/predicate it directly connects to or modifies.

Sentence Segmentation Rules:
- Divide the Japanese sentence into a few natural, multi-word grammatical chunks / bunsetsu.
- Keep verb forms and conjugations intact as whole words (keep particles with their nouns and inflected auxiliary verbs intact; never split single kanji from its okurigana stem).
- Mark the target vocabulary chunk with status "target".
- Mark the specific complete predicate/word it directly modifies, attaches to, or governs with status "connected".
- Mark all other chunks with status "ok".

Respond ONLY with a valid JSON object matching this schema:
{
  "thought": "1 sentence identifying role and connection",
  "card": {
    "role": "Concise grammatical role (e.g. Direct Object, Subject, Topic, Conditional Predicate, Time Adverbial, Quoted Speech)",
    "applied_sense": "The specific English sense that applies here (e.g. what)",
    "connected_with": "The Japanese word/predicate it attaches to or modifies (or null)",
    "tokens": [
      {"text": "Natural phrase segment", "status": "ok" | "target" | "connected"}
    ]
  },
  "markdown": "### Role of ${cleanTarget} in this Sentence\\nIn this sentence, **${cleanTarget}** means \\\"...\\\", functioning as ...\\n\\n💡 **Key Nuance:** Concise practical note on how the attached particle or conjugation connects this word to the predicate."
}
Tokens MUST cover the entire Japanese sentence in order without missing characters.`;
  }

  function buildBreakdownPrompt(info) {
    const cleanJp = info.cleanSentenceJP || info.sentenceJP;
    return `Sentence: ${cleanJp}
Given translation: ${info.sentenceEN || '(none)'}

Break down this sentence in a way that makes its structure click. You may explain the pieces out of their original order when that is clearer. Do not force a mechanical word-by-word table.

Use the following section labels as plain bold labels, not Markdown headings. Adapt or omit sections when they do not fit the sentence.

**Big picture**
Start with one or two plain-English sentences explaining how to mentally parse the sentence. Identify the core message or main predicate first, especially when it appears near the end.

**Core structure**
Show the smallest phrase carrying the main message in bold, followed by a natural English gloss and a short bullet breakdown of its important words, particles, and conjugations. Explain what the remaining material modifies, quotes, qualifies, or connects to.

**Modifying or supporting parts**
Group the rest into the fewest meaningful chunks that preserve the grammar. Make every line add new information.
- Combine simple word-plus-particle units into one compact note.
- Spend detail on structure that unlocks the sentence: attachment, scope, clause boundaries, conjugation patterns, and omitted information.

**Putting it together**
Build the sentence up in two to four numbered stages, showing how each chunk combines with the next.

**Translations**
- **Literal:** close structural translation
- **Natural:** natural English translation`;
  }

  // ---------- JSON Extraction & Card HTML Rendering ----------
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
    let jsonCandidate = (firstBrace !== -1 && lastBrace > firstBrace)
      ? text.substring(firstBrace, lastBrace + 1)
      : (firstBrace !== -1 ? text.substring(firstBrace) : text);

    try {
      return JSON.parse(jsonCandidate);
    } catch {}

    // Resilient field-level extraction if overall JSON.parse fails (e.g. unescaped quotes in markdown)
    let card = null;
    let markdown = '';

    const cardIdx = jsonCandidate.indexOf('"card"');
    if (cardIdx !== -1) {
      const start = jsonCandidate.indexOf('{', cardIdx);
      if (start !== -1) {
        let depth = 0;
        let inStr = false;
        let esc = false;
        let end = -1;
        for (let i = start; i < jsonCandidate.length; i++) {
          const c = jsonCandidate[i];
          if (esc) { esc = false; continue; }
          if (c === '\\') { esc = true; continue; }
          if (c === '"') { inStr = !inStr; continue; }
          if (!inStr) {
            if (c === '{') depth++;
            else if (c === '}') {
              depth--;
              if (depth === 0) { end = i; break; }
            }
          }
        }
        if (end !== -1) {
          try {
            card = JSON.parse(jsonCandidate.substring(start, end + 1));
          } catch {}
        }
      }
    }

    const mdMatch = jsonCandidate.match(/"markdown"\s*:\s*"([\s\S]*)/);
    if (mdMatch) {
      let md = mdMatch[1];
      const lastQ = md.lastIndexOf('"');
      if (lastQ !== -1) md = md.substring(0, lastQ);
      markdown = md
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\');
    }

    if (card) {
      return { card, markdown };
    }

    return null;
  }

  function renderRatingCard(card, modelName) {
    if (!card) return '';
    const score = typeof card.score === 'number' ? Math.round(card.score * 10) / 10 : 10;
    const scoreClass = score >= 9.5 ? 'high' : (score >= 7 ? 'med' : 'low');
    const bracket = card.bracket || (score >= 9.5 ? 'Flawless' : (score >= 8 ? 'Minor Nuance' : (score >= 5 ? 'Moderate Error' : (score >= 3 ? 'Major Error' : 'Fatal Error'))));
    const tag = (modelName || CFG.model || '').split('/').pop() || 'gemini';

    const isFlawless = score >= 9.5;
    const isMinor = score >= 7 && score < 9.5;
    const mistakes = Array.isArray(card.mistakes) ? card.mistakes : (Array.isArray(card.issues) ? card.issues.filter((i) => i.type === 'mistake') : []);
    const advisories = Array.isArray(card.advisories) ? card.advisories : (Array.isArray(card.issues) ? card.issues.filter((i) => i.type === 'advisory') : []);
    const tokens = Array.isArray(card.tokens) ? card.tokens : [];

    return `
      <details class="jpdb-ai-jev-card" open>
        <summary class="jpdb-ai-jev-head" title="Click to collapse/expand assessment">
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
                  ${mistakes.map((m) => `
                    <li>
                      <span class="jpdb-ai-jev-word">${escapeHtml(m.word || m.segment || '')}</span>: 
                      <span class="jpdb-ai-jev-desc">${escapeHtml(m.description || '')}</span>
                    </li>
                  `).join('')}
                </ul>
              </div>
            ` : ''}
            ${advisories.length > 0 ? `
              <div class="jpdb-ai-jev-advisories" style="${mistakes.length > 0 ? 'margin-top:6px;' : ''}">
                <div class="jpdb-ai-jev-advisories-title">Nuance Notes:</div>
                <ul class="jpdb-ai-jev-advisories-list">
                  ${advisories.map((a) => `
                    <li>
                      <span class="jpdb-ai-jev-word advisory">${escapeHtml(a.word || a.segment || '')}</span>: 
                      <span class="jpdb-ai-jev-desc">${escapeHtml(a.description || '')}</span>
                    </li>
                  `).join('')}
                </ul>
              </div>
            ` : ''}
          `}

          ${tokens.length > 0 ? `
            <div class="jpdb-ai-jev-tokens">
              ${tokens.map((t) => {
                const status = (t.status || 'ok').toLowerCase();
                const cls = status === 'err' || status === 'mistake' ? 'err' : (status === 'advisory' || status === 'warn' ? 'advisory' : 'ok');
                return `<span class="jpdb-ai-jev-token ${cls}">${escapeHtml(t.text)}</span>`;
              }).join(' ')}
            </div>
          ` : ''}
        </div>
      </details>
    `.trim();
  }

  function renderVocabCard(card, modelName) {
    if (!card) return '';
    const tag = (modelName || CFG.model || '').split('/').pop() || 'gemini';
    const roleLabel = (card.role || 'vocab role').replace(/_/g, ' ');
    const tokens = Array.isArray(card.tokens) ? card.tokens : [];

    return `
      <details class="jpdb-ai-jev-card" open>
        <summary class="jpdb-ai-jev-head" title="Click to collapse/expand breakdown">
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
              ${tokens.map((t) => {
                const status = (t.status || 'ok').toLowerCase();
                const cls = status === 'target' ? 'target' : (status === 'connected' || status === 'advisory' ? 'advisory' : 'ok');
                return `<span class="jpdb-ai-jev-token ${cls}">${escapeHtml(t.text)}</span>`;
              }).join(' ')}
            </div>
          ` : ''}
        </div>
      </details>
    `.trim();
  }

  // ---------- Settings Management ----------
  function loadSettingsToUI() {
    const baseInput = document.getElementById('jpdb-ai-cfg-llm-base');
    const modelInput = document.getElementById('jpdb-ai-cfg-llm-model');
    const keyInput = document.getElementById('jpdb-ai-cfg-llm-key');
    const invertInput = document.getElementById('jpdb-ai-cfg-invert-enter');

    if (baseInput) baseInput.value = CFG.base;
    if (modelInput) modelInput.value = CFG.model;
    if (keyInput) keyInput.value = CFG.key;
    if (invertInput) invertInput.checked = CFG.invertEnter;
  }

  function toggleSettingsView(forceOpen) {
    const settingsView = document.getElementById('jpdb-ai-settings-view');
    const diagView = document.getElementById('jpdb-ai-diag-view');
    const msgsView = document.getElementById('jpdb-ai-msgs');
    const rowView = document.getElementById('jpdb-ai-row');
    const btnsView = document.getElementById('jpdb-ai-btns');
    if (!settingsView) return;

    const isOpening = typeof forceOpen === 'boolean' ? forceOpen : settingsView.style.display !== 'flex';

    if (isOpening) {
      if (diagView) diagView.style.display = 'none';
      loadSettingsToUI();
      if (msgsView) msgsView.style.display = 'none';
      if (rowView) rowView.style.display = 'none';
      if (btnsView) btnsView.style.display = 'none';
      settingsView.style.display = 'flex';
    } else {
      settingsView.style.display = 'none';
      if (!diagView || diagView.style.display !== 'flex') {
        if (msgsView) msgsView.style.display = 'flex';
        if (rowView) rowView.style.display = 'flex';
        if (btnsView) btnsView.style.display = 'flex';
        if (msgsView) msgsView.scrollTop = msgsView.scrollHeight;
      }
    }
  }

  function exportSettingsJson() {
    const settingsObj = {
      base: CFG.base,
      model: CFG.model,
      key: CFG.key,
      invertEnter: CFG.invertEnter,
      exportedAt: new Date().toISOString()
    };
    const jsonStr = JSON.stringify(settingsObj, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jpdb-ai-settings-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function triggerImportSettings() {
    const fileInput = document.getElementById('jpdb-ai-settings-file');
    if (fileInput) fileInput.click();
  }

  function handleSettingsFileSelect(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const obj = JSON.parse(event.target.result);
        applyImportedSettings(obj);
      } catch (err) {
        alert('Invalid JSON settings file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function applyImportedSettings(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (typeof obj.base === 'string') CFG.base = obj.base;
    if (typeof obj.model === 'string') CFG.model = obj.model;
    if (typeof obj.key === 'string') CFG.key = obj.key;
    if (typeof obj.invertEnter === 'boolean') CFG.invertEnter = obj.invertEnter;

    loadSettingsToUI();
    updateFoot();
    updateShortcutsUI();

    const statusEl = document.getElementById('jpdb-ai-settings-status');
    if (statusEl) {
      statusEl.textContent = 'Settings imported!';
      statusEl.style.display = 'inline';
      setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 2500);
    }
  }

  // ---------- Diagnostics & Raw LLM Logging ----------
  const DIAG_STORAGE_KEY = 'jpdb_ai_diagnostics_log';
  const MAX_DIAG_ENTRIES = 100;

  function getDiagnostics() {
    try {
      const raw = GM_getValue(DIAG_STORAGE_KEY, '[]');
      if (typeof raw === 'string') {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      }
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function recordDiagnostic(entry) {
    try {
      const list = getDiagnostics();
      entry.id = 'diag-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      entry.timestamp = new Date().toISOString();
      list.unshift(entry);
      if (list.length > MAX_DIAG_ENTRIES) list.length = MAX_DIAG_ENTRIES;
      GM_setValue(DIAG_STORAGE_KEY, JSON.stringify(list));
      if (typeof updateDiagUI === 'function') updateDiagUI();
      const diagView = document.getElementById('jpdb-ai-diag-view');
      if (diagView && diagView.style.display === 'flex') {
        renderDiagList();
      }
    } catch (err) {
      console.warn('[JPDB AI] Failed to record diagnostic:', err);
    }
  }

  function clearDiagnostics() {
    try {
      GM_setValue(DIAG_STORAGE_KEY, JSON.stringify([]));
      if (typeof updateDiagUI === 'function') updateDiagUI();
      const diagView = document.getElementById('jpdb-ai-diag-view');
      if (diagView && diagView.style.display === 'flex') {
        renderDiagList();
      }
    } catch {}
  }

  function downloadDiagnosticsJson() {
    const logs = getDiagnostics();
    const payload = {
      exportedAt: new Date().toISOString(),
      totalEntries: logs.length,
      currentConfig: {
        base: CFG.base,
        model: CFG.model,
      },
      entries: logs,
    };
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `jpdb-ai-diagnostics-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadSpecificDiagnostic(entry) {
    if (!entry) return;
    const json = JSON.stringify(entry, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const vocabSafe = (entry.cardInfo?.cleanVocab || entry.cardInfo?.vocab || entry.action || 'item').replace(/[^a-zA-Z0-9_\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g, '_');
    const timeSafe = (entry.timestamp || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19);
    a.download = `jpdb_diag_${vocabSafe}_${timeSafe}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function toggleDiagView(forceOpen) {
    const diagView = document.getElementById('jpdb-ai-diag-view');
    const settingsView = document.getElementById('jpdb-ai-settings-view');
    const msgsView = document.getElementById('jpdb-ai-msgs');
    const rowView = document.getElementById('jpdb-ai-row');
    const btnsView = document.getElementById('jpdb-ai-btns');
    if (!diagView) return;

    const isOpening = typeof forceOpen === 'boolean' ? forceOpen : diagView.style.display !== 'flex';

    if (isOpening) {
      if (settingsView) settingsView.style.display = 'none';
      if (msgsView) msgsView.style.display = 'none';
      if (rowView) rowView.style.display = 'none';
      if (btnsView) btnsView.style.display = 'none';
      diagView.style.display = 'flex';
      renderDiagList();
    } else {
      diagView.style.display = 'none';
      if (!settingsView || settingsView.style.display !== 'flex') {
        if (msgsView) msgsView.style.display = 'flex';
        if (rowView) rowView.style.display = 'flex';
        if (btnsView) btnsView.style.display = 'flex';
        if (msgsView) msgsView.scrollTop = msgsView.scrollHeight;
      }
    }
  }

  function renderDiagList() {
    const listEl = document.getElementById('jpdb-ai-diag-list');
    const statEl = document.getElementById('jpdb-ai-diag-stat');
    if (!listEl) return;

    const list = getDiagnostics();
    if (statEl) {
      statEl.textContent = `${list.length}`;
    }

    if (list.length === 0) {
      listEl.innerHTML = `<div style="text-align:center;padding:32px 10px;opacity:.6;font-size:12px">No diagnostics recorded yet. Rate translations or ask for explanations to log raw responses!</div>`;
      return;
    }

    listEl.innerHTML = list.map((item) => {
      const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      const actionName = (item.action || 'chat').toUpperCase();
      const vocabLabel = item.cardInfo?.cleanVocab || item.cardInfo?.vocab || item.action || 'Entry';
      const itemId = item.id || ('diag_' + (item.timestamp || ''));
      const latencyStr = typeof item.elapsedMs === 'number' ? `${item.elapsedMs}ms` : '';
      const modelTag = (item.model || '').split('/').pop() || item.model || '';

      const scoreHtml = (item.parsed && typeof item.parsed.card?.score === 'number')
        ? `<span class="jpdb-ai-jev-score ${item.parsed.card.score >= 9.5 ? 'high' : (item.parsed.card.score >= 7 ? 'med' : 'low')}" style="padding:1px 7px;font-size:10.5px">${item.parsed.card.score}/10 (${escapeHtml(item.parsed.card.bracket || '')})</span>`
        : '';

      const thoughtHtml = item.thought
        ? `<div style="margin-top:5px;font-size:11.5px;color:#1e40af;background:rgba(37,99,235,.06);padding:4px 8px;border-radius:5px;line-height:1.35;"><strong>Thought:</strong> ${escapeHtml(item.thought)}</div>`
        : '';

      return `
        <div class="jpdb-ai-diag-item" data-id="${escapeHtml(itemId)}">
          <div class="jpdb-ai-diag-item-top">
            <div style="display:flex;align-items:center;gap:6px">
              <span class="jpdb-ai-diag-action-badge">${escapeHtml(actionName)}</span>
              <span style="font-weight:700;color:#2563eb;font-size:13px">${escapeHtml(vocabLabel)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:4px">
              <span class="jpdb-ai-diag-time">${escapeHtml(timeStr)}</span>
              <button type="button" class="jpdb-ai-diag-btn-action jpdb-ai-diag-btn-copy" data-id="${escapeHtml(itemId)}" title="Copy diagnostic JSON to clipboard">📋 Copy</button>
              <button type="button" class="jpdb-ai-diag-btn-action jpdb-ai-diag-btn-dl" data-id="${escapeHtml(itemId)}" title="Download diagnostic JSON file">💾 JSON</button>
            </div>
          </div>

          ${item.cardInfo?.sentenceJP ? `<div style="margin:2px 0;font-size:11.5px"><strong>JP:</strong> ${escapeHtml(item.cardInfo.sentenceJP)}</div>` : ''}
          ${item.userDraft ? `<div style="margin:2px 0;font-size:11.5px"><strong>Student:</strong> "${escapeHtml(item.userDraft)}"</div>` : ''}
          ${item.cardInfo?.sentenceEN ? `<div style="margin:2px 0;font-size:11.5px"><strong>Reference:</strong> "${escapeHtml(item.cardInfo.sentenceEN)}"</div>` : ''}

          <div style="display:flex;align-items:center;gap:8px;margin-top:5px;font-size:11.5px">
            ${scoreHtml}
            ${latencyStr ? `<span style="opacity:.7;font-size:10.5px">${latencyStr}</span>` : ''}
            ${modelTag ? `<span style="opacity:.6;font-size:10.5px">(${escapeHtml(modelTag)})</span>` : ''}
            ${item.error ? `<span style="color:#dc2626;font-weight:700">Error: ${escapeHtml(item.error)}</span>` : ''}
          </div>

          ${thoughtHtml}

          <details class="jpdb-ai-diag-details">
            <summary style="cursor:pointer;font-weight:600;font-size:11px;color:#2563eb;margin-top:4px;user-select:none;">View Raw LLM Response</summary>
            <div class="jpdb-ai-diag-critique">${escapeHtml(item.rawResponse || '(no response text)')}</div>
          </details>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.jpdb-ai-diag-btn-copy').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const entry = getDiagnostics().find((x) => (x.id || ('diag_' + (x.timestamp || ''))) === id);
        if (!entry) return;
        const text = JSON.stringify(entry, null, 2);
        const orig = btn.textContent;
        const done = () => {
          btn.textContent = '✓ Copied!';
          setTimeout(() => { btn.textContent = orig; }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(() => {
            prompt('Copy Diagnostic JSON:', text);
          });
        } else {
          prompt('Copy Diagnostic JSON:', text);
        }
      });
    });

    listEl.querySelectorAll('.jpdb-ai-diag-btn-dl').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const entry = getDiagnostics().find((x) => (x.id || ('diag_' + (x.timestamp || ''))) === id);
        if (!entry) return;
        downloadSpecificDiagnostic(entry);
        const orig = btn.textContent;
        btn.textContent = '✓ Saved!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    });
  }

  try {
    const win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
    win.__jpdbAiExportDiagnostics = downloadDiagnosticsJson;
    win.__jpdbAiGetDiagnostics = getDiagnostics;
    win.__jpdbAiClearDiagnostics = clearDiagnostics;
    win.__jpdbAiDownloadSpecificDiagnostic = downloadSpecificDiagnostic;
    win.__jpdbAiToggleDiagView = toggleDiagView;
    if (typeof window !== 'undefined' && window !== win) {
      window.__jpdbAiExportDiagnostics = downloadDiagnosticsJson;
      window.__jpdbAiGetDiagnostics = getDiagnostics;
      window.__jpdbAiClearDiagnostics = clearDiagnostics;
      window.__jpdbAiDownloadSpecificDiagnostic = downloadSpecificDiagnostic;
      window.__jpdbAiToggleDiagView = toggleDiagView;
    }
  } catch {}

  // ---------- UI Styles ----------
  const STYLE = `
#jpdb-ai-fab{position:fixed;right:16px;bottom:16px;z-index:10000001;width:42px;height:42px;box-sizing:border-box;background:rgba(255,255,255,.8);color:#2563eb;border:1px solid rgba(37,99,235,.35);border-radius:999px;padding:0;margin:0;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.18);opacity:.85;backdrop-filter:blur(4px);pointer-events:auto;transition:background .15s,opacity .15s,transform .15s}
#jpdb-ai-fab:hover{opacity:1;background:#eff6ff}
#jpdb-ai-fab.jpdb-ai-fab-active{background:#2563eb;color:#fff;border-color:#2563eb;opacity:1;box-shadow:0 4px 14px rgba(37,99,235,.4)}
html.dark-mode #jpdb-ai-fab{background:rgba(30,30,30,.8);color:#93c5fd;border-color:rgba(147,197,253,.35)}
html.dark-mode #jpdb-ai-fab:hover{background:#1e3a5f}
html.dark-mode #jpdb-ai-fab.jpdb-ai-fab-active{background:#3b82f6;color:#fff;border-color:#3b82f6;box-shadow:0 4px 14px rgba(59,130,246,.4)}
#jpdb-ai-panel{position:fixed;right:16px;bottom:70px;width:380px;min-width:280px;min-height:200px;max-width:calc(100vw - 32px);max-height:min(70vh,640px);display:flex;flex-direction:column;z-index:10000000;background:#fff;color:#111;border:1px solid #ddd;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.3);overflow:hidden;font-family:system-ui,sans-serif;font-size:14px;resize:both}
#jpdb-ai-panel.jpdb-ai-wide{width:min(680px,calc(100vw - 32px));height:min(85vh,800px);max-height:85vh}
html.dark-mode #jpdb-ai-panel{background:#1e1e1e;color:#eee;border-color:#444}
#jpdb-ai-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;user-select:none}
#jpdb-ai-head .jpdb-ai-head-btns{margin-left:auto;display:flex;gap:6px}
#jpdb-ai-head .jpdb-ai-head-btns button{background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer}
#jpdb-ai-ctx{padding:8px 12px;font-size:12px;background:#f3f4f6;border-bottom:1px solid #e5e7eb;max-height:90px;overflow:auto}
html.dark-mode #jpdb-ai-ctx{background:#2a2a2a;border-color:#444}
#jpdb-ai-btns{display:flex;gap:6px;padding:8px 12px;flex-wrap:wrap}
#jpdb-ai-btns button{flex:1;min-width:100px;border:1px solid #2563eb;background:#eff6ff;color:#1d4ed8;border-radius:8px;padding:6px 8px;font-size:12px;font-weight:600;cursor:pointer}
html.dark-mode #jpdb-ai-btns button{background:#1e3a5f;color:#bfdbfe}
#jpdb-ai-msgs{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-height:120px}
.jpdb-ai-msg{padding:9px 12px;border-radius:8px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;box-sizing:border-box}
.jpdb-ai-user{background:#dbeafe;align-self:flex-end;max-width:90%}
html.dark-mode .jpdb-ai-user{background:#1e40af;color:#fff}
.jpdb-ai-ai{background:#f3f4f6;align-self:stretch;width:100%;max-width:100%}
html.dark-mode .jpdb-ai-ai{background:#2d2d2d}
.jpdb-ai-err{background:#fee2e2;color:#991b1b}
#jpdb-ai-row{display:flex;gap:6px;padding:8px 12px;border-top:1px solid #e5e7eb;align-items:center}
html.dark-mode #jpdb-ai-row{border-color:#444}
#jpdb-ai-input{flex:1;height:38px;min-height:38px;max-height:38px;line-height:38px;box-sizing:border-box;border:1px solid #ccc;border-radius:8px;padding:0 10px;font-size:13px;background:inherit;color:inherit;margin:0;vertical-align:middle}
#jpdb-ai-send{height:38px;min-height:38px;max-height:38px;line-height:1;box-sizing:border-box;margin:0;padding:0 14px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle}
#jpdb-ai-rate{height:38px;min-height:38px;max-height:38px;line-height:1;box-sizing:border-box;margin:0;padding:0 12px;background:#0d9488;color:#fff;border:none;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle}
#jpdb-ai-rate:hover{filter:brightness(1.1)}
html.dark-mode #jpdb-ai-rate{background:#0f766e;color:#ccfbf1}
#jpdb-ai-btns button:disabled, #jpdb-ai-send:disabled, #jpdb-ai-rate:disabled{opacity:.5;cursor:wait}
#jpdb-ai-foot{padding:4px 12px 8px;font-size:11px;opacity:.7;display:flex;justify-content:space-between;gap:8px;align-items:center}
#jpdb-ai-foot a{opacity:.9;text-decoration:none}
#jpdb-ai-foot a:hover{text-decoration:underline}
.jpdb-ai-foot-links{display:flex;gap:6px;align-items:center}

.jpdb-ai-jev-card{margin-bottom:12px;padding:10px 14px;background:rgba(37,99,235,.07);border:1px solid rgba(37,99,235,.2);border-radius:10px;font-size:12.5px;line-height:1.4;width:100%;box-sizing:border-box}
html.dark-mode .jpdb-ai-jev-card{background:rgba(37,99,235,.15);border-color:rgba(147,197,253,.25)}
.jpdb-ai-jev-head{display:flex;align-items:center;justify-content:space-between;font-weight:700;list-style:none;outline:none;user-select:none;cursor:pointer}
.jpdb-ai-jev-head::-webkit-details-marker,
.jpdb-ai-jev-head::marker{display:none;content:""}
.jpdb-ai-jev-title{display:flex;align-items:center;gap:6px;color:#1d4ed8;font-size:13px}
html.dark-mode .jpdb-ai-jev-title{color:#93c5fd}
.jpdb-ai-jev-tag{opacity:.6;font-size:10px;font-weight:normal;background:rgba(0,0,0,.06);padding:2px 6px;border-radius:4px}
html.dark-mode .jpdb-ai-jev-tag{background:rgba(255,255,255,.1)}
.jpdb-ai-jev-score{font-size:12px;font-weight:700;padding:2px 10px;border-radius:999px;color:#fff;letter-spacing:.02em}
.jpdb-ai-jev-score.high{background:#16a34a}
.jpdb-ai-jev-score.med{background:#d97706}
.jpdb-ai-jev-score.low{background:#dc2626}
.jpdb-ai-jev-body{margin-top:8px;padding-top:8px;border-top:1px solid rgba(37,99,235,.15)}
html.dark-mode .jpdb-ai-jev-body{border-color:rgba(147,197,253,.2)}
.jpdb-ai-jev-flawless{font-size:12px;font-weight:600;color:#15803d;display:flex;align-items:center;gap:6px;margin:2px 0 6px}
html.dark-mode .jpdb-ai-jev-flawless{color:#86efac}
.jpdb-ai-jev-summary{font-size:12px;font-weight:600;line-height:1.45;padding:6px 10px;border-radius:6px;background:rgba(239,68,68,.08);color:#991b1b;border:1px solid rgba(239,68,68,.2);margin-bottom:8px;display:flex;align-items:flex-start;gap:6px}
html.dark-mode .jpdb-ai-jev-summary{background:rgba(239,68,68,.18);color:#fca5a5;border-color:rgba(239,68,68,.3)}
.jpdb-ai-jev-summary.minor{background:rgba(217,119,6,.08);color:#92400e;border-color:rgba(217,119,6,.2)}
html.dark-mode .jpdb-ai-jev-summary.minor{background:rgba(217,119,6,.18);color:#fcd34d;border-color:rgba(217,119,6,.3)}
.jpdb-ai-jev-summary-icon{font-size:13px;line-height:1.2;flex-shrink:0}
.jpdb-ai-jev-check{font-size:13px;font-weight:800}
.jpdb-ai-jev-advisories{font-size:12px}
.jpdb-ai-jev-advisories-title{font-size:11px;font-weight:700;color:#d97706;margin-bottom:4px;text-transform:uppercase;letter-spacing:.03em}
html.dark-mode .jpdb-ai-jev-advisories-title{color:#fbbf24}
.jpdb-ai-jev-advisories-list{margin:0;padding-left:18px;list-style-type:disc}
.jpdb-ai-jev-advisories-list li{margin:3px 0;font-size:12px;line-height:1.4}
.jpdb-ai-jev-word.advisory{font-weight:700;color:#b45309;background:rgba(217,119,6,.12);padding:1px 6px;border-radius:4px}
html.dark-mode .jpdb-ai-jev-word.advisory{color:#fde68a;background:rgba(217,119,6,.25)}
.jpdb-ai-jev-mistakes{font-size:12px}
.jpdb-ai-jev-mistakes-title{font-size:11px;font-weight:700;color:#1e40af;margin-bottom:4px;text-transform:uppercase;letter-spacing:.03em}
html.dark-mode .jpdb-ai-jev-mistakes-title{color:#93c5fd}
.jpdb-ai-jev-mistakes-list{margin:0;padding-left:18px;list-style-type:disc}
.jpdb-ai-jev-mistakes-list li{margin:3px 0;font-size:12px;line-height:1.4}
.jpdb-ai-jev-word{font-weight:700;color:#b91c1c;background:rgba(239,68,68,.12);padding:1px 6px;border-radius:4px}
html.dark-mode .jpdb-ai-jev-word{color:#fca5a5;background:rgba(239,68,68,.25)}
.jpdb-ai-jev-desc{color:#374151}
html.dark-mode .jpdb-ai-jev-desc{color:#d1d5db}
.jpdb-ai-jev-tokens{margin-top:8px;padding-top:6px;border-top:1px dashed rgba(37,99,235,.2);display:flex;flex-wrap:wrap;gap:4px}
html.dark-mode .jpdb-ai-jev-tokens{border-color:rgba(147,197,253,.2)}
.jpdb-ai-jev-token{font-size:10.5px;padding:1px 6px;border-radius:4px;font-family:inherit}
.jpdb-ai-jev-token.ok{background:rgba(22,163,74,.1);color:#15803d}
html.dark-mode .jpdb-ai-jev-token.ok{background:rgba(22,163,74,.2);color:#86efac}
.jpdb-ai-jev-token.err{background:rgba(239,68,68,.12);color:#b91c1c;font-weight:700}
.jpdb-ai-jev-token.advisory{background:rgba(217,119,6,.12);color:#b45309;font-weight:600}
html.dark-mode .jpdb-ai-jev-token.advisory{background:rgba(217,119,6,.25);color:#fde68a}
.jpdb-ai-jev-token.target{background:rgba(99,102,241,.18);color:#4338ca;font-weight:700;border:1px solid rgba(99,102,241,.35)}
html.dark-mode .jpdb-ai-jev-token.target{background:rgba(129,140,248,.25);color:#c7d2fe;border-color:rgba(129,140,248,.45)}

.jpdb-ai-msg.md{white-space:normal}
.jpdb-ai-msg.md p{margin:.35em 0}
.jpdb-ai-msg.md p:first-child{margin-top:0}
.jpdb-ai-msg.md p:last-child{margin-bottom:0}
.jpdb-ai-msg.md h1,
.jpdb-ai-msg.md h2,
.jpdb-ai-msg.md h3,
.jpdb-ai-msg.md h4{font-family:inherit!important;font-weight:700!important;letter-spacing:normal!important;padding:0!important;margin:.7em 0 .25em 0!important;line-height:1.35!important;color:inherit!important}
.jpdb-ai-msg.md h1{font-size:1.2em!important;border-bottom:1px solid rgba(0,0,0,.1);padding-bottom:2px!important}
.jpdb-ai-msg.md h2{font-size:1.1em!important}
.jpdb-ai-msg.md h3{font-size:1.03em!important}
.jpdb-ai-msg.md h4{font-size:.95em!important}
.jpdb-ai-msg.md ul{list-style-type:disc}
.jpdb-ai-msg.md ol{list-style-type:decimal}
html.dark-mode .jpdb-ai-msg.md h1{border-color:rgba(255,255,255,.15)}
.jpdb-ai-msg.md ul,.jpdb-ai-msg.md ol{margin:.3em 0 .3em 1.2em;padding:0}
.jpdb-ai-msg.md li{margin:.15em 0}
.jpdb-ai-msg.md blockquote{margin:.4em 0;padding:.3em .6em;border-left:3px solid #93c5fd;background:rgba(147,197,253,.15);border-radius:0 6px 6px 0}
html.dark-mode .jpdb-ai-msg.md blockquote{border-color:#3b82f6}
.jpdb-ai-msg.md code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.86em;background:rgba(0,0,0,.08);padding:.1em .35em;border-radius:4px}
html.dark-mode .jpdb-ai-msg.md code{background:rgba(255,255,255,.12)}
.jpdb-ai-msg.md pre{background:rgba(0,0,0,.07);padding:8px;border-radius:8px;overflow:auto;margin:.4em 0}
html.dark-mode .jpdb-ai-msg.md pre{background:rgba(0,0,0,.4)}
.jpdb-ai-msg.md pre code{background:none;padding:0}
.jpdb-ai-msg.md table{border-collapse:collapse;margin:.4em 0;font-size:.92em;width:100%}
.jpdb-ai-msg.md th,.jpdb-ai-msg.md td{border:1px solid #ccc;padding:4px 6px;text-align:left}
html.dark-mode .jpdb-ai-msg.md th,.jpdb-ai-msg.md td{border-color:#555}
.jpdb-ai-msg.md a{color:#1d4ed8}
html.dark-mode .jpdb-ai-msg.md a{color:#93c5fd}
#jpdb-ai-panel.jpdb-ai-collapsed{min-height:0;height:auto}
#jpdb-ai-panel.jpdb-ai-collapsed #jpdb-ai-ctx,
#jpdb-ai-panel.jpdb-ai-collapsed #jpdb-ai-btns,
#jpdb-ai-panel.jpdb-ai-collapsed #jpdb-ai-msgs,
#jpdb-ai-panel.jpdb-ai-collapsed #jpdb-ai-row,
#jpdb-ai-panel.jpdb-ai-collapsed #jpdb-ai-foot{display:none}
.jpdb-ai-btn-short{display:none}
.jpdb-ai-btn-long{display:inline}

@media (max-width: 640px){
  .jpdb-ai-btn-short{display:inline}
  .jpdb-ai-btn-long{display:none}
  #jpdb-ai-fab{right:12px;bottom:12px;width:38px;height:38px;padding:0}
  #jpdb-ai-panel{right:8px!important;bottom:58px!important;left:8px!important;width:calc(100vw - 16px)!important;max-width:calc(100vw - 16px)!important;height:calc(100vh - 84px)!important;max-height:calc(100vh - 84px)!important;border-radius:14px!important;border:1px solid rgba(0,0,0,.18)!important;box-shadow:0 8px 30px rgba(0,0,0,.35)!important;resize:none!important}
  html.dark-mode #jpdb-ai-panel{border-color:rgba(255,255,255,.18)!important}
  #jpdb-ai-panel.jpdb-ai-wide{width:calc(100vw - 16px)!important;height:calc(100vh - 74px)!important;max-height:calc(100vh - 74px)!important;bottom:58px!important}
  #jpdb-ai-panel.jpdb-ai-collapsed{height:auto!important;min-height:0!important;bottom:58px!important}
  #jpdb-ai-head{padding:8px 12px;font-size:13.5px}
  #jpdb-ai-ctx{padding:6px 10px;font-size:11.5px;max-height:60px}
  #jpdb-ai-btns{padding:6px 8px;gap:5px}
  #jpdb-ai-btns button{min-width:0;padding:6px 4px;font-size:11px}
  #jpdb-ai-msgs{padding:8px 10px;gap:6px}
  .jpdb-ai-msg{padding:7px 10px;font-size:13px;line-height:1.4}
  #jpdb-ai-row{padding:6px 8px!important;gap:5px}
  #jpdb-ai-input{height:36px;min-height:36px;max-height:36px;line-height:36px;padding:0 8px;font-size:12.5px}
  #jpdb-ai-send{height:36px;min-height:36px;max-height:36px;padding:0 10px;font-size:12px;white-space:nowrap}
  #jpdb-ai-rate{height:36px;min-height:36px;max-height:36px;padding:0 9px;font-size:11.5px;white-space:nowrap}
  #jpdb-ai-foot{padding:3px 10px 6px!important;font-size:10px;gap:6px}
  #jpdb-ai-model{max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block}
  .jpdb-ai-foot-links{flex-shrink:0;gap:4px}
  .jpdb-ai-jev-card{padding:8px 10px;font-size:12px}
}

#jpdb-ai-settings-view{display:none;flex:1;flex-direction:column;min-height:0;overflow-y:auto;background:inherit;padding:10px 14px;gap:10px}
.jpdb-ai-settings-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:6px;border-bottom:1px solid rgba(0,0,0,.1);font-weight:700;font-size:12.5px}
html.dark-mode .jpdb-ai-settings-head{border-color:rgba(255,255,255,.15)}
.jpdb-ai-settings-actions{display:flex;gap:4px}
.jpdb-ai-settings-actions button{padding:3px 8px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid #d1d5db;background:#fff;color:#1f2937!important;cursor:pointer;transition:all .15s}
.jpdb-ai-settings-actions button:hover{background:#eff6ff;color:#1d4ed8!important;border-color:#3b82f6}
html.dark-mode .jpdb-ai-settings-actions button{background:#2a2a2a;color:#f3f4f6!important;border-color:#555}
html.dark-mode .jpdb-ai-settings-actions button:hover{background:#1e3a5f;color:#93c5fd!important;border-color:#60a5fa}
.jpdb-ai-settings-group{display:flex;flex-direction:column;gap:8px;padding:9px 11px;border-radius:8px;border:1px solid #e5e7eb;background:rgba(0,0,0,.02)}
html.dark-mode .jpdb-ai-settings-group{border-color:#444;background:rgba(255,255,255,.03)}
.jpdb-ai-settings-group-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;opacity:.8;margin-bottom:2px}
.jpdb-ai-settings-label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;opacity:.9}
.jpdb-ai-settings-checkbox-label{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:500;cursor:pointer;user-select:none}
.jpdb-ai-settings-input{width:100%;box-sizing:border-box;padding:5px 8px;font-size:11.5px;border-radius:6px;border:1px solid #d1d5db;background:#fff;color:#111;font-family:inherit;outline:none;transition:border-color .15s,box-shadow .15s}
.jpdb-ai-settings-input:focus{border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,.2)}
html.dark-mode .jpdb-ai-settings-input{background:#232323;color:#e5e7eb;border-color:#555}
html.dark-mode .jpdb-ai-settings-input:focus{border-color:#60a5fa;box-shadow:0 0 0 2px rgba(96,165,250,.25)}
.jpdb-ai-settings-btn-toggle{padding:0 8px;font-size:12px;border-radius:6px;border:1px solid #d1d5db;background:#f3f4f6;cursor:pointer}
html.dark-mode .jpdb-ai-settings-btn-toggle{border-color:#555;background:#333}
.jpdb-ai-settings-btn-primary{padding:6px 14px;font-size:11.5px;font-weight:600;border-radius:6px;border:1px solid #2563eb;background:#2563eb;color:#fff!important;cursor:pointer;transition:background .15s}
.jpdb-ai-settings-btn-primary:hover{background:#1d4ed8}
.jpdb-ai-settings-btn-secondary{padding:6px 12px;font-size:11.5px;font-weight:500;border-radius:6px;border:1px solid #d1d5db;background:transparent;color:inherit!important;cursor:pointer}
html.dark-mode .jpdb-ai-settings-btn-secondary{border-color:#555}

#jpdb-ai-diag-view{display:none;flex:1;flex-direction:column;min-height:0;overflow:hidden;background:inherit;padding:8px 12px;gap:8px}
.jpdb-ai-diag-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:6px;border-bottom:1px solid rgba(0,0,0,.1);font-weight:700;font-size:12px;gap:6px}
html.dark-mode .jpdb-ai-diag-head{border-color:rgba(255,255,255,.15)}
.jpdb-ai-diag-actions{display:flex;gap:4px;flex-wrap:wrap}
.jpdb-ai-diag-actions button{padding:4px 8px;font-size:11px;font-weight:600;line-height:1.2;border-radius:6px;border:1px solid #d1d5db;background:#fff;color:#1f2937!important;cursor:pointer;transition:all .15s}
.jpdb-ai-diag-actions button:hover{background:#eff6ff;color:#1d4ed8!important;border-color:#3b82f6}
html.dark-mode .jpdb-ai-diag-actions button{background:#2a2a2a;color:#f3f4f6!important;border-color:#555}
html.dark-mode .jpdb-ai-diag-actions button:hover{background:#1e3a5f;color:#93c5fd!important;border-color:#60a5fa}
#jpdb-ai-diag-list{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding-right:2px}
.jpdb-ai-diag-item{padding:9px 11px;border-radius:8px;border:1px solid #e5e7eb;background:rgba(0,0,0,.02);font-size:12px;line-height:1.4}
html.dark-mode .jpdb-ai-diag-item{border-color:#444;background:rgba(255,255,255,.03)}
.jpdb-ai-diag-item-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.jpdb-ai-diag-time{opacity:.6;font-size:10.5px}
.jpdb-ai-diag-btn-action{padding:2px 7px;font-size:10.5px;font-weight:600;border-radius:4px;border:1px solid #d1d5db;background:#fff;color:#374151!important;cursor:pointer;line-height:1.2;transition:all .15s}
.jpdb-ai-diag-btn-action:hover{background:#eff6ff;color:#1d4ed8!important;border-color:#3b82f6}
html.dark-mode .jpdb-ai-diag-btn-action{background:#2a2a2a;color:#d1d5db!important;border-color:#555}
html.dark-mode .jpdb-ai-diag-btn-action:hover{background:#1e3a5f;color:#93c5fd!important;border-color:#60a5fa}
.jpdb-ai-diag-action-badge{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(37,99,235,.1);color:#1d4ed8;border:1px solid rgba(37,99,235,.25);text-transform:uppercase}
html.dark-mode .jpdb-ai-diag-action-badge{background:rgba(59,130,246,.15);color:#93c5fd;border-color:rgba(59,130,246,.3)}
.jpdb-ai-diag-critique{margin-top:6px;padding:6px 8px;background:rgba(0,0,0,.03);border-radius:6px;font-family:monospace;font-size:11px;white-space:pre-wrap;max-height:180px;overflow-y:auto;border:1px solid rgba(0,0,0,.08)}
html.dark-mode .jpdb-ai-diag-critique{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.1)}
.jpdb-ai-diag-details{margin-top:6px;font-size:11.5px}
`;

  function injectStyle() {
    if (document.getElementById('jpdb-ai-style')) return;
    const s = document.createElement('style');
    s.id = 'jpdb-ai-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // ---------- Session Persistence ----------
  const SESSION_KEY = 'jpdb_ai_chat_session';
  let history = [];
  let msgLog = [];
  let draftInput = '';
  let panelOpen = false;
  let panelWide = false;
  let busy = false;
  let currentSessionToken = '';

  function saveSession() {
    try {
      const data = {
        token: getCardToken(),
        history,
        msgLog,
        draftInput,
        panelOpen,
        panelWide,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch {}
  }

  function initSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const currentToken = getCardToken();
      if (data && data.token === currentToken) {
        history = Array.isArray(data.history) ? data.history : [];
        msgLog = Array.isArray(data.msgLog) ? data.msgLog : [];
        draftInput = data.draftInput || '';
        panelOpen = !!data.panelOpen;
        panelWide = !!data.panelWide;
        currentSessionToken = currentToken;
      } else {
        history = [];
        msgLog = [];
        draftInput = '';
        panelOpen = data ? !!data.panelOpen : false;
        panelWide = data ? !!data.panelWide : false;
        currentSessionToken = currentToken;
      }
    } catch {}
  }

  // ---------- Markdown Renderer ----------
  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderInline(s) {
    let out = escapeHtml(s);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return out;
  }

  function renderMarkdown(src) {
    if (!src) return '';
    const lines = String(src).replace(/\r\n/g, '\n').split('\n');
    let out = [];
    let inList = false;
    let listType = null;
    let inTable = false;
    let inPre = false;
    let preBuf = [];

    const closeList = () => {
      if (inList) {
        out.push(listType === 'ol' ? '</ol>' : '</ul>');
        inList = false;
        listType = null;
      }
    };
    const closeTable = () => {
      if (inTable) {
        out.push('</tbody></table>');
        inTable = false;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.trim().startsWith('```')) {
        closeList();
        closeTable();
        if (inPre) {
          out.push('<pre><code>' + escapeHtml(preBuf.join('\n')) + '</code></pre>');
          inPre = false;
          preBuf = [];
        } else {
          inPre = true;
          preBuf = [];
        }
        continue;
      }
      if (inPre) {
        preBuf.push(line);
        continue;
      }

      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        closeList();
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        const isSep = cells.every((c) => /^:?-+:?$/.test(c));
        if (isSep) continue;
        if (!inTable) {
          inTable = true;
          out.push('<table><thead><tr>');
          for (const c of cells) out.push('<th>' + renderInline(c) + '</th>');
          out.push('</tr></thead><tbody>');
        } else {
          out.push('<tr>');
          for (const c of cells) out.push('<td>' + renderInline(c) + '</td>');
          out.push('</tr>');
        }
        continue;
      } else {
        closeTable();
      }

      const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
      if (hMatch) {
        closeList();
        const level = hMatch[1].length;
        out.push(`<h${level}>` + renderInline(hMatch[2]) + `</h${level}>`);
        continue;
      }

      const bqMatch = line.match(/^>\s?(.*)$/);
      if (bqMatch) {
        closeList();
        out.push('<blockquote>' + renderInline(bqMatch[1]) + '</blockquote>');
        continue;
      }

      const ulMatch = line.match(/^\s*[-*+]\s+(.+)$/);
      if (ulMatch) {
        if (!inList || listType !== 'ul') {
          closeList();
          inList = true;
          listType = 'ul';
          out.push('<ul>');
        }
        out.push('<li>' + renderInline(ulMatch[1]) + '</li>');
        continue;
      }

      const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
      if (olMatch) {
        if (!inList || listType !== 'ol') {
          closeList();
          inList = true;
          listType = 'ol';
          out.push('<ol>');
        }
        out.push('<li>' + renderInline(olMatch[1]) + '</li>');
        continue;
      }

      closeList();

      if (!line.trim()) {
        continue;
      }

      out.push('<p>' + renderInline(line) + '</p>');
    }

    closeList();
    closeTable();
    if (inPre) {
      out.push('<pre><code>' + escapeHtml(preBuf.join('\n')) + '</code></pre>');
    }

    return out.join('');
  }

  function setMsgMarkdown(el, mdText, cardHtml) {
    if (!el) return;
    el.classList.add('md');
    el.innerHTML = (cardHtml || '') + renderMarkdown(mdText);
  }

  function msgNode(entry) {
    const d = document.createElement('div');
    d.className = 'jpdb-ai-msg ' + (entry.role === 'user' ? 'jpdb-ai-user' : 'jpdb-ai-ai');
    if (entry.isErr) d.classList.add('jpdb-ai-err');
    if (entry.role === 'assistant') {
      setMsgMarkdown(d, entry.text, entry.jevHtml);
    } else {
      d.textContent = entry.text;
    }
    return d;
  }

  function renderLog() {
    const c = document.getElementById('jpdb-ai-msgs');
    if (!c) return;
    c.innerHTML = '';
    for (const e of msgLog) {
      c.appendChild(msgNode(e));
    }
    c.scrollTop = c.scrollHeight;
  }

  function addMsg(role, text, isErr, transient) {
    const entry = { role, text, isErr: !!isErr, jevHtml: '' };
    if (!transient) {
      msgLog.push(entry);
      saveSession();
    }
    const c = document.getElementById('jpdb-ai-msgs');
    if (c) {
      const node = msgNode(entry);
      c.appendChild(node);
      c.scrollTop = c.scrollHeight;
      return node;
    }
    return null;
  }

  function refreshCtx() {
    const token = getCardToken();
    if (token && token !== currentSessionToken) {
      initSession();
      renderLog();
    }
    const info = extractCardInfo();
    const ctx = document.getElementById('jpdb-ai-ctx');
    const isShown = isAnswerShown();
    if (ctx) {
      if (!isShown) {
        ctx.textContent = `Card: [Answer hidden] | ${info.sentenceJP || 'Review question'} (question)`;
      } else {
        ctx.textContent = `Card: ${info.vocab || '?'} | ${info.sentenceJP || 'no sentence'}${info.sentenceEN ? ' — ' + info.sentenceEN : ''} (answer shown)`;
      }
    }
    return info;
  }

  // ---------- Core Execution Functions ----------
  async function runRateTranslation() {
    if (busy) return;
    await ensureCardData();
    const inputEl = document.getElementById('jpdb-ai-input');
    const userDraft = inputEl ? inputEl.value.trim() : '';
    if (inputEl) {
      inputEl.value = '';
      draftInput = '';
      saveSession();
    }
    const info = refreshCtx();
    const userPrompt = buildRateTranslationPrompt(info, userDraft);
    const userLabel = userDraft ? `Rate my translation: "${userDraft}"` : `Rate translation for this sentence`;
    addMsg('user', userLabel);
    const thinking = addMsg('assistant', 'Evaluating translation…', false, true);
    busy = true;
    setBusy(true);

    const startTime = Date.now();
    let rawResponse = '';
    const msgs = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ];

    try {
      rawResponse = await callLLM(msgs, { json: true });
      const elapsedMs = Date.now() - startTime;
      const parsed = parseJsonResponse(rawResponse);

      recordDiagnostic({
        action: 'rate',
        model: CFG.model,
        endpoint: CFG.base,
        cardInfo: {
          vocab: info.vocab,
          cleanVocab: info.cleanVocab,
          sentenceJP: info.sentenceJP,
          sentenceEN: info.sentenceEN,
          meanings: info.meanings,
        },
        userDraft,
        promptMessages: msgs,
        rawResponse,
        thought: parsed?.thought || null,
        parsed,
        elapsedMs,
        error: null,
      });

      let cardHtml = '';
      let replyMarkdown = '';

      if (parsed && (parsed.card || parsed.markdown)) {
        if (parsed.card) {
          cardHtml = renderRatingCard(parsed.card, CFG.model);
        }
        if (parsed.markdown && typeof parsed.markdown === 'string' && !parsed.markdown.trim().startsWith('{')) {
          replyMarkdown = parsed.markdown.trim();
        } else if (parsed.card) {
          const card = parsed.card;
          const score = typeof card.score === 'number' ? card.score : 10;
          const bracket = card.bracket || (score >= 9.5 ? 'Flawless' : 'Evaluation');
          const lines = [`**Score: ${score}/10 (${bracket})**`];
          if (card.summary) lines.push('', card.summary);
          if (Array.isArray(card.mistakes) && card.mistakes.length) {
            lines.push('', '### Issues:');
            for (const m of card.mistakes) {
              lines.push(`* **${m.word || ''}**: ${m.description || ''}`);
            }
          }
          if (info.sentenceEN) {
            lines.push('', `**Reference Translation:**\n${info.sentenceEN}`);
          }
          replyMarkdown = lines.join('\n');
        }
      } else {
        replyMarkdown = rawResponse;
      }

      setMsgMarkdown(thinking, replyMarkdown, cardHtml);
      msgLog.push({ role: 'assistant', text: replyMarkdown, jevHtml: cardHtml, isErr: false });
      history.push({ role: 'user', content: userLabel });
      history.push({ role: 'assistant', content: replyMarkdown });
      saveSession();
    } catch (e) {
      const elapsedMs = Date.now() - startTime;
      recordDiagnostic({
        action: 'rate',
        model: CFG.model,
        endpoint: CFG.base,
        cardInfo: {
          vocab: info.vocab,
          cleanVocab: info.cleanVocab,
          sentenceJP: info.sentenceJP,
          sentenceEN: info.sentenceEN,
        },
        userDraft,
        promptMessages: msgs,
        rawResponse: rawResponse || null,
        thought: null,
        parsed: null,
        elapsedMs,
        error: e.message || String(e),
      });

      msgLog.push({ role: 'assistant', text: 'Error: ' + (e.message || e), isErr: true });
      thinking.textContent = 'Error: ' + (e.message || e);
      thinking.classList.add('jpdb-ai-err');
      saveSession();
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  async function runExplain(kind) {
    if (busy) return;
    await ensureCardData();
    const info = refreshCtx();
    const isExplain = kind === 'explain';
    const userPrompt = isExplain ? buildVocabExplanationPrompt(info) : buildBreakdownPrompt(info);
    const userLabel = isExplain ? `What does "${info.vocab || 'this word'}" do in this sentence?` : 'Break down this sentence please.';
    addMsg('user', userLabel);
    const thinking = addMsg('assistant', isExplain ? 'Analyzing vocab role…' : 'Thinking…', false, true);
    busy = true;
    setBusy(true);

    const startTime = Date.now();
    let rawResponse = '';
    const msgs = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ];

    try {
      rawResponse = await callLLM(msgs, { json: isExplain });
      const elapsedMs = Date.now() - startTime;

      let cardHtml = '';
      let replyMarkdown = '';
      let parsed = null;

      if (isExplain) {
        parsed = parseJsonResponse(rawResponse);
        if (parsed && (parsed.card || parsed.markdown)) {
          if (parsed.card) {
            cardHtml = renderVocabCard(parsed.card, CFG.model);
          }
          if (parsed.markdown && typeof parsed.markdown === 'string' && !parsed.markdown.trim().startsWith('{')) {
            replyMarkdown = parsed.markdown.trim();
          } else if (parsed.card) {
            const card = parsed.card;
            const lines = [`### Role of ${info.cleanVocab || info.vocab} in this Sentence`];
            if (card.role) lines.push(`In this sentence, **${info.cleanVocab || info.vocab}** functions as **${card.role}**${card.applied_sense ? ` meaning "${card.applied_sense}"` : ''}.`);
            if (card.connected_with) lines.push(`It connects directly with **${card.connected_with}**.`);
            replyMarkdown = lines.join('\n\n');
          }
        } else {
          replyMarkdown = rawResponse;
        }
      } else {
        replyMarkdown = rawResponse;
      }

      recordDiagnostic({
        action: kind,
        model: CFG.model,
        endpoint: CFG.base,
        cardInfo: {
          vocab: info.vocab,
          cleanVocab: info.cleanVocab,
          sentenceJP: info.sentenceJP,
          sentenceEN: info.sentenceEN,
          meanings: info.meanings,
        },
        promptMessages: msgs,
        rawResponse,
        thought: parsed?.thought || null,
        parsed,
        elapsedMs,
        error: null,
      });

      setMsgMarkdown(thinking, replyMarkdown, cardHtml);
      msgLog.push({ role: 'assistant', text: replyMarkdown, jevHtml: cardHtml, isErr: false });
      history.push({ role: 'user', content: userLabel });
      history.push({ role: 'assistant', content: replyMarkdown });
      saveSession();
    } catch (e) {
      const elapsedMs = Date.now() - startTime;
      recordDiagnostic({
        action: kind,
        model: CFG.model,
        endpoint: CFG.base,
        cardInfo: {
          vocab: info.vocab,
          cleanVocab: info.cleanVocab,
          sentenceJP: info.sentenceJP,
          sentenceEN: info.sentenceEN,
        },
        promptMessages: msgs,
        rawResponse: rawResponse || null,
        thought: null,
        parsed: null,
        elapsedMs,
        error: e.message || String(e),
      });

      msgLog.push({ role: 'assistant', text: 'Error: ' + (e.message || e), isErr: true });
      thinking.textContent = 'Error: ' + (e.message || e);
      thinking.classList.add('jpdb-ai-err');
      saveSession();
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  async function sendChat(text) {
    if (busy || !text.trim()) return;
    await ensureCardData();
    const info = extractCardInfo();
    let prompt = text.trim();
    if (history.length === 0) {
      prompt = `[Current card context — vocab: ${info.vocab || '?'}, sentence JP: ${info.sentenceJP || '?'}, translation: ${info.sentenceEN || '?'}, meanings: ${(info.meanings || []).join(' / ').slice(0, 400)}]\n\nUser question: ${prompt}`;
    }
    addMsg('user', text.trim());
    const input = document.getElementById('jpdb-ai-input');
    if (input) input.value = '';
    draftInput = '';
    saveSession();
    const thinking = addMsg('assistant', 'Thinking…', false, true);
    busy = true;
    setBusy(true);

    const startTime = Date.now();
    let rawResponse = '';
    const msgs = [{ role: 'system', content: SYSTEM_PROMPT }, ...history, { role: 'user', content: prompt }];

    try {
      rawResponse = await callLLM(msgs);
      const elapsedMs = Date.now() - startTime;

      recordDiagnostic({
        action: 'chat',
        model: CFG.model,
        endpoint: CFG.base,
        cardInfo: {
          vocab: info.vocab,
          sentenceJP: info.sentenceJP,
          sentenceEN: info.sentenceEN,
        },
        promptMessages: msgs,
        rawResponse,
        thought: null,
        parsed: null,
        elapsedMs,
        error: null,
      });

      setMsgMarkdown(thinking, rawResponse);
      msgLog.push({ role: 'assistant', text: rawResponse, isErr: false });
      history.push({ role: 'user', content: prompt });
      history.push({ role: 'assistant', content: rawResponse });
      saveSession();
    } catch (e) {
      const elapsedMs = Date.now() - startTime;
      recordDiagnostic({
        action: 'chat',
        model: CFG.model,
        endpoint: CFG.base,
        cardInfo: {
          vocab: info.vocab,
          sentenceJP: info.sentenceJP,
          sentenceEN: info.sentenceEN,
        },
        promptMessages: msgs,
        rawResponse: rawResponse || null,
        thought: null,
        parsed: null,
        elapsedMs,
        error: e.message || String(e),
      });

      msgLog.push({ role: 'assistant', text: 'Error: ' + (e.message || e), isErr: true });
      thinking.textContent = 'Error: ' + (e.message || e);
      thinking.classList.add('jpdb-ai-err');
      saveSession();
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  function setBusy(b) {
    const btns = document.querySelectorAll('#jpdb-ai-btns button, #jpdb-ai-send, #jpdb-ai-rate');
    btns.forEach((btn) => (btn.disabled = b));
  }

  function isPanelOpen() {
    const p = document.getElementById('jpdb-ai-panel');
    return p && p.style.display !== 'none';
  }

  const FAB_ICON_CHAT = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';
  const FAB_ICON_CLOSE = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  function syncFab() {
    const fab = document.getElementById('jpdb-ai-fab');
    if (!fab) return;
    const open = isPanelOpen();
    fab.innerHTML = open ? FAB_ICON_CLOSE : FAB_ICON_CHAT;
    fab.title = open ? 'Close AI Chat (Esc)' : 'Open AI Chat';
    if (open) fab.classList.add('jpdb-ai-fab-active');
    else fab.classList.remove('jpdb-ai-fab-active');
  }

  function toggle(show) {
    const p = document.getElementById('jpdb-ai-panel');
    if (!p) return;
    const cur = p.style.display !== 'none';
    const next = typeof show === 'boolean' ? show : !cur;
    p.style.display = next ? 'flex' : 'none';
    panelOpen = next;
    saveSession();
    syncFab();
    if (next) {
      refreshCtx();
      const input = document.getElementById('jpdb-ai-input');
      if (input) input.focus();
    }
  }

  function ensureFab() {
    if (document.getElementById('jpdb-ai-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'jpdb-ai-fab';
    fab.setAttribute('type', 'button');
    fab.setAttribute('aria-label', 'Toggle JPDB AI Chat');
    fab.innerHTML = FAB_ICON_CHAT;
    fab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
    document.body.appendChild(fab);
    syncFab();
  }

  function ensurePanel() {
    if (document.getElementById('jpdb-ai-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'jpdb-ai-panel';
    panel.style.display = 'none';
    panel.innerHTML = `
      <div id="jpdb-ai-head"><span>🤖 JPDB AI Tutor</span><span class="jpdb-ai-head-btns"><button id="jpdb-ai-wide" title="Toggle wide view">⤢</button><button id="jpdb-ai-x" title="Close (Esc)">✕</button></span></div>
      <div id="jpdb-ai-ctx"></div>
      <div id="jpdb-ai-btns">
        <button id="jpdb-ai-explain" title="Explain vocab role (A or Alt+A)">✨ <span class="jpdb-ai-btn-long">Explain vocab role</span><span class="jpdb-ai-btn-short">Explain</span></button>
        <button id="jpdb-ai-breakdown" title="Sentence breakdown (S or Alt+S)">🔍 <span class="jpdb-ai-btn-long">Sentence breakdown</span><span class="jpdb-ai-btn-short">Breakdown</span></button>
        <button id="jpdb-ai-clear" style="flex:0 1 auto;min-width:44px" title="Clear chat history">Clear</button>
      </div>
      <div id="jpdb-ai-settings-view">
        <input type="file" id="jpdb-ai-settings-file" accept=".json,application/json" style="display:none" />
        <div class="jpdb-ai-settings-head">
          <span>⚙️ Settings</span>
          <div class="jpdb-ai-settings-actions">
            <button type="button" id="jpdb-ai-settings-import-top" title="Import settings from JSON file">Import JSON</button>
            <button type="button" id="jpdb-ai-settings-export-top" title="Export settings as JSON file">Export JSON</button>
            <button type="button" id="jpdb-ai-settings-close" title="Close Settings">✕</button>
          </div>
        </div>
        <form id="jpdb-ai-settings-form" style="display:flex;flex-direction:column;gap:10px;">
          <div class="jpdb-ai-settings-group">
            <div class="jpdb-ai-settings-group-title">Gemini Model Configuration</div>
            <label class="jpdb-ai-settings-label">
              API Base URL
              <input type="text" id="jpdb-ai-cfg-llm-base" class="jpdb-ai-settings-input" placeholder="https://generativelanguage.googleapis.com/v1beta" />
            </label>
            <label class="jpdb-ai-settings-label">
              Model Name
              <input type="text" id="jpdb-ai-cfg-llm-model" class="jpdb-ai-settings-input" placeholder="gemini-3.5-flash-lite" />
            </label>
            <label class="jpdb-ai-settings-label">
              API Key
              <div style="display:flex;gap:4px;">
                <input type="password" id="jpdb-ai-cfg-llm-key" class="jpdb-ai-settings-input" placeholder="AIzaSy..." />
                <button type="button" class="jpdb-ai-settings-btn-toggle" data-target="jpdb-ai-cfg-llm-key" title="Show/Hide API key">👁️</button>
              </div>
            </label>
          </div>

          <div class="jpdb-ai-settings-group">
            <div class="jpdb-ai-settings-group-title">Interaction &amp; Shortcuts</div>
            <label class="jpdb-ai-settings-checkbox-label">
              <input type="checkbox" id="jpdb-ai-cfg-invert-enter" />
              <span>Invert Enter shortcut (Enter rates translation, Ctrl+Enter sends follow-up)</span>
            </label>
          </div>

          <div class="jpdb-ai-settings-group">
            <div class="jpdb-ai-settings-group-title">Diagnostics &amp; Raw LLM Responses</div>
            <div style="font-size:11.5px;opacity:.85;margin-bottom:6px;">
              Raw LLM responses, prompts, and alignment thoughts are logged locally.
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <button type="button" id="jpdb-ai-settings-inspect-diag" class="jpdb-ai-settings-btn-secondary" style="font-weight:600;">🔍 Inspect Diagnostics</button>
              <button type="button" id="jpdb-ai-settings-download-diag" class="jpdb-ai-settings-btn-secondary">📥 Download All JSON</button>
              <button type="button" id="jpdb-ai-settings-clear-diag" class="jpdb-ai-settings-btn-secondary">Clear</button>
              <span id="jpdb-ai-settings-diag-count" style="font-size:11px;opacity:.7;">0 recorded</span>
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
            <div style="display:flex;gap:6px;">
              <button type="button" id="jpdb-ai-settings-import" class="jpdb-ai-settings-btn-secondary">Import</button>
              <button type="button" id="jpdb-ai-settings-export" class="jpdb-ai-settings-btn-secondary">Export</button>
              <button type="button" id="jpdb-ai-settings-reset" class="jpdb-ai-settings-btn-secondary" title="Reset settings to defaults">Reset</button>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <span id="jpdb-ai-settings-status" style="font-size:11px;color:#16a34a;display:none;">Saved!</span>
              <button type="submit" class="jpdb-ai-settings-btn-primary">Save Settings</button>
            </div>
          </div>
        </form>
      </div>

      <div id="jpdb-ai-diag-view">
        <div class="jpdb-ai-diag-head">
          <span>Diagnostics (<span id="jpdb-ai-diag-stat">0</span>)</span>
          <div class="jpdb-ai-diag-actions">
            <button type="button" id="jpdb-ai-diag-export" title="Export all diagnostics as JSON file">Export JSON</button>
            <button type="button" id="jpdb-ai-diag-clear" title="Clear recorded diagnostics">Clear</button>
            <button type="button" id="jpdb-ai-diag-close" title="Back to review chat">✕</button>
          </div>
        </div>
        <div id="jpdb-ai-diag-list"></div>
      </div>

      <div id="jpdb-ai-msgs"></div>
      <div id="jpdb-ai-row">
        <input type="text" id="jpdb-ai-input" placeholder="Rate translation (Enter or Insert) · Send (Ctrl+Enter)…" />
        <button id="jpdb-ai-send" title="Send message (Enter)">Send</button>
        <button id="jpdb-ai-rate" title="Rate sentence translation (Insert, Ctrl+Enter, or T)">Rate translation</button>
      </div>
      <div id="jpdb-ai-foot">
        <span id="jpdb-ai-model">gemini</span>
        <div class="jpdb-ai-foot-links">
          <a href="#" id="jpdb-ai-invert-toggle" title="Toggle default Enter shortcut between Rate and Send">Enter: Rate</a>
          <span>·</span>
          <a href="#" id="jpdb-ai-diag" title="Translation diagnostics and raw LLM responses">Diag (0)</a>
          <span>·</span>
          <a href="#" id="jpdb-ai-cfg">settings</a>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    if (panelWide) panel.classList.add('jpdb-ai-wide');

    panel.querySelector('#jpdb-ai-head').addEventListener('click', (e) => {
      if (e.target.closest('.jpdb-ai-head-btns')) return;
      panel.classList.toggle('jpdb-ai-collapsed');
    });

    panel.querySelector('#jpdb-ai-wide').addEventListener('click', () => {
      panelWide = !panelWide;
      panel.classList.toggle('jpdb-ai-wide', panelWide);
      saveSession();
    });

    panel.querySelector('#jpdb-ai-x').addEventListener('click', () => toggle(false));
    panel.querySelector('#jpdb-ai-explain').addEventListener('click', () => runExplain('explain'));
    panel.querySelector('#jpdb-ai-breakdown').addEventListener('click', () => runExplain('breakdown'));

    panel.querySelector('#jpdb-ai-clear').addEventListener('click', () => {
      history = [];
      msgLog = [];
      draftInput = '';
      const inputEl = document.getElementById('jpdb-ai-input');
      if (inputEl) inputEl.value = '';
      renderLog();
      refreshCtx();
      saveSession();
    });

    const inputEl = panel.querySelector('#jpdb-ai-input');
    if (inputEl) {
      if (draftInput) inputEl.value = draftInput;
      inputEl.addEventListener('input', () => {
        draftInput = inputEl.value;
        saveSession();
      });
    }

    const doSend = () => {
      const val = document.getElementById('jpdb-ai-input')?.value || '';
      draftInput = '';
      saveSession();
      sendChat(val);
    };

    panel.querySelector('#jpdb-ai-send').addEventListener('click', doSend);
    panel.querySelector('#jpdb-ai-rate').addEventListener('click', runRateTranslation);

    updateShortcutsUI = function () {
      const input = panel.querySelector('#jpdb-ai-input');
      const sendBtn = panel.querySelector('#jpdb-ai-send');
      const rateBtn = panel.querySelector('#jpdb-ai-rate');
      const toggleLink = panel.querySelector('#jpdb-ai-invert-toggle');

      const isNarrow = window.innerWidth <= 640;
      if (CFG.invertEnter) {
        if (input) input.placeholder = isNarrow ? 'Rate (Enter) · Send (Ctrl+Enter)…' : 'Rate translation (Enter or Insert) · Send (Ctrl+Enter)…';
        if (sendBtn) sendBtn.title = 'Send follow-up message (Ctrl+Enter)';
        if (rateBtn) rateBtn.title = 'Rate translation (Enter, Insert, or T)';
        if (toggleLink) toggleLink.textContent = 'Enter: Rate';
      } else {
        if (input) input.placeholder = isNarrow ? 'Ask AI (Enter) · Rate (Ctrl+Enter)…' : 'Ask follow-up (Enter) · Rate translation (Ctrl+Enter or Insert)…';
        if (sendBtn) sendBtn.title = 'Send message (Enter)';
        if (rateBtn) rateBtn.title = 'Rate sentence translation (Insert, Ctrl+Enter, or T)';
        if (toggleLink) toggleLink.textContent = 'Enter: Send';
      }
    };

    window.addEventListener('resize', () => {
      updateShortcutsUI();
    });

    panel.querySelector('#jpdb-ai-invert-toggle').addEventListener('click', (e) => {
      e.preventDefault();
      CFG.invertEnter = !CFG.invertEnter;
      updateShortcutsUI();
    });

    panel.querySelector('#jpdb-ai-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const isCtrl = e.ctrlKey || e.metaKey || e.altKey;
        const doRate = CFG.invertEnter ? !isCtrl : isCtrl;
        e.preventDefault();
        if (doRate) {
          runRateTranslation();
        } else {
          doSend();
        }
      } else if (e.key === 'Insert') {
        e.preventDefault();
        runRateTranslation();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        toggle(false);
      } else if (e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        runRateTranslation();
      } else if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        runExplain('explain');
      } else if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        runExplain('breakdown');
      }
    });

    panel.querySelector('#jpdb-ai-cfg').addEventListener('click', (e) => {
      e.preventDefault();
      toggleSettingsView();
    });

    panel.querySelector('#jpdb-ai-settings-close').addEventListener('click', () => {
      toggleSettingsView(false);
    });

    const fileInput = panel.querySelector('#jpdb-ai-settings-file');
    if (fileInput) fileInput.addEventListener('change', handleSettingsFileSelect);

    const importBtnTop = panel.querySelector('#jpdb-ai-settings-import-top');
    if (importBtnTop) importBtnTop.addEventListener('click', triggerImportSettings);

    const importBtnBottom = panel.querySelector('#jpdb-ai-settings-import');
    if (importBtnBottom) importBtnBottom.addEventListener('click', triggerImportSettings);

    const exportBtnTop = panel.querySelector('#jpdb-ai-settings-export-top');
    if (exportBtnTop) exportBtnTop.addEventListener('click', exportSettingsJson);

    const exportBtnBottom = panel.querySelector('#jpdb-ai-settings-export');
    if (exportBtnBottom) exportBtnBottom.addEventListener('click', exportSettingsJson);

    panel.querySelectorAll('.jpdb-ai-settings-btn-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = btn.getAttribute('data-target');
        const input = panel.querySelector('#' + targetId);
        if (input) {
          const isPass = input.type === 'password';
          input.type = isPass ? 'text' : 'password';
          btn.textContent = isPass ? '🔒' : '👁️';
          btn.title = isPass ? 'Hide API key' : 'Show API key';
        }
      });
    });

    const settingsForm = panel.querySelector('#jpdb-ai-settings-form');
    if (settingsForm) {
      settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const baseVal = panel.querySelector('#jpdb-ai-cfg-llm-base')?.value || '';
        let modelVal = panel.querySelector('#jpdb-ai-cfg-llm-model')?.value || '';
        const keyVal = panel.querySelector('#jpdb-ai-cfg-llm-key')?.value || '';
        const invertVal = panel.querySelector('#jpdb-ai-cfg-invert-enter')?.checked || false;

        if (modelVal.toLowerCase().includes('gemini') && modelVal.includes(' ')) {
          modelVal = modelVal.trim().toLowerCase().replace(/\s+/g, '-');
        }

        CFG.base = baseVal;
        CFG.model = modelVal;
        CFG.key = keyVal;
        CFG.invertEnter = invertVal;

        updateFoot();
        updateShortcutsUI();

        const statusEl = panel.querySelector('#jpdb-ai-settings-status');
        if (statusEl) {
          statusEl.textContent = 'Settings saved!';
          statusEl.style.display = 'inline';
          setTimeout(() => {
            if (statusEl) statusEl.style.display = 'none';
          }, 2500);
        }
      });
    }

    const resetBtn = panel.querySelector('#jpdb-ai-settings-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm('Reset settings to defaults? (Your API keys will be restored to defaults)')) {
          panel.querySelector('#jpdb-ai-cfg-llm-base').value = DEFAULT_API_BASE;
          panel.querySelector('#jpdb-ai-cfg-llm-model').value = DEFAULT_MODEL;
          panel.querySelector('#jpdb-ai-cfg-llm-key').value = DEFAULT_API_KEY;
          panel.querySelector('#jpdb-ai-cfg-invert-enter').checked = true;
        }
      });
    }

    const diagLink = panel.querySelector('#jpdb-ai-diag');
    if (diagLink) {
      diagLink.addEventListener('click', (e) => {
        e.preventDefault();
        toggleDiagView();
      });
    }

    const inspectDiagBtn = panel.querySelector('#jpdb-ai-settings-inspect-diag');
    if (inspectDiagBtn) {
      inspectDiagBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleDiagView(true);
      });
    }

    const closeDiagBtn = panel.querySelector('#jpdb-ai-diag-close');
    if (closeDiagBtn) {
      closeDiagBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleDiagView(false);
      });
    }

    const exportDiagBtn = panel.querySelector('#jpdb-ai-diag-export');
    if (exportDiagBtn) {
      exportDiagBtn.addEventListener('click', (e) => {
        e.preventDefault();
        downloadDiagnosticsJson();
      });
    }

    const clearDiagPanelBtn = panel.querySelector('#jpdb-ai-diag-clear');
    if (clearDiagPanelBtn) {
      clearDiagPanelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('Clear all recorded diagnostics?')) {
          clearDiagnostics();
        }
      });
    }

    const downloadDiagBtn = panel.querySelector('#jpdb-ai-settings-download-diag');
    if (downloadDiagBtn) {
      downloadDiagBtn.addEventListener('click', (e) => {
        e.preventDefault();
        downloadDiagnosticsJson();
      });
    }

    const clearDiagBtn = panel.querySelector('#jpdb-ai-settings-clear-diag');
    if (clearDiagBtn) {
      clearDiagBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('Clear all recorded diagnostic responses?')) {
          clearDiagnostics();
        }
      });
    }

    updateDiagUI = function () {
      const logs = getDiagnostics();
      const count = logs.length;
      const diagEl = document.getElementById('jpdb-ai-diag');
      if (diagEl) {
        diagEl.textContent = `Diag (${count})`;
        diagEl.title = `${count} diagnostic response${count === 1 ? '' : 's'} recorded. Click to inspect, copy, or download.`;
      }
      const countEl = document.getElementById('jpdb-ai-settings-diag-count');
      if (countEl) {
        countEl.textContent = `${count} recorded`;
      }
      const statEl = document.getElementById('jpdb-ai-diag-stat');
      if (statEl) {
        statEl.textContent = `${count}`;
      }
    };

    updateFoot = function () {
      const el = document.getElementById('jpdb-ai-model');
      if (el) {
        const shortModel = CFG.model.replace(/^models\//, '');
        el.textContent = shortModel;
        el.title = `Model: ${CFG.model}\nEndpoint: ${CFG.base}`;
      }
      updateDiagUI();
    };
    updateFoot();
    updateShortcutsUI();

    renderLog();
    if (panelOpen) {
      panel.style.display = 'flex';
      refreshCtx();
    } else {
      refreshCtx();
    }
  }

  function ensureUI() {
    injectStyle();
    ensureFab();
    ensurePanel();
  }

  function openAndFocusInput() {
    ensureUI();
    toggle(true);
    setTimeout(() => {
      const input = document.getElementById('jpdb-ai-input');
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);
  }

  function bindGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isInput = activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.isContentEditable;

      if (e.key === 'Escape') {
        if (isPanelOpen()) {
          e.preventDefault();
          toggle(false);
        }
        return;
      }

      if (!isInput) {
        if (e.key === 'a' || e.key === 'A') {
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            ensureUI();
            toggle(true);
            runExplain('explain');
            return;
          }
        }
        if (e.key === 's' || e.key === 'S') {
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            ensureUI();
            toggle(true);
            runExplain('breakdown');
            return;
          }
        }
        if (e.key === 't' || e.key === 'T' || e.key === 'Insert') {
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            openAndFocusInput();
            return;
          }
        }
      }

      if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        ensureUI();
        toggle(true);
        runExplain('explain');
      } else if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        ensureUI();
        toggle(true);
        runExplain('breakdown');
      } else if (e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        openAndFocusInput();
      }
    });
  }

  function startWatch() {
    let lastToken = getCardToken();
    setInterval(() => {
      const curToken = getCardToken();
      if (curToken && curToken !== lastToken) {
        lastToken = curToken;
        currentSessionToken = curToken;
        initSession();
        renderLog();
        refreshCtx();
        prefetchIfQuestion();
      }
    }, 300);
  }

  // ---------- In-Place Answer Reveal ----------
  let inPlaceRevealing = false;

  async function revealAnswerInPlace(e) {
    if (e && e.preventDefault) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (inPlaceRevealing) return;
    const showBtn = document.getElementById('show-answer');
    if (!showBtn) return;
    const form = showBtn.closest('form') || document.querySelector('form[action*="review"]');
    if (!form) return;

    inPlaceRevealing = true;

    try {
      const c = form.querySelector('input[name="c"]')?.value || getCardToken();
      const r = form.querySelector('input[name="r"]')?.value || '2';
      const url = '/review?c=' + encodeURIComponent(c) + '&r=' + encodeURIComponent(r) + '#a';

      let newContainer = null;
      if (cardDataCache[c] && cardDataCache[c].container) {
        newContainer = cardDataCache[c].container.cloneNode(true);
      } else {
        const res = await fetch(url);
        if (res.ok) {
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          newContainer = doc.querySelector('div.container');
          if (c && !cardDataCache[c]) {
            cardDataCache[c] = {
              container: newContainer,
              doc,
            };
          }
        }
      }

      const oldContainer = document.querySelector('div.container');
      if (oldContainer && newContainer) {
        oldContainer.replaceWith(newContainer);
        const answerUrl = '/review?c=' + encodeURIComponent(c) + '&r=' + encodeURIComponent(r) + '#a';
        try {
          window.history.pushState({ token: c, isAnswer: true }, '', answerUrl);
        } catch {
          location.hash = '#a';
        }
        refreshCtx();
        saveSession();

        if (!isPanelOpen()) {
          setTimeout(() => {
            const autofocusEl = document.querySelector('input[autofocus], #grade-p');
            if (autofocusEl && typeof autofocusEl.focus === 'function') {
              autofocusEl.focus();
            }
          }, 10);
        }
        return;
      }
    } catch (err) {
      console.warn('[JPDB AI] In-place answer reveal error:', err);
    } finally {
      inPlaceRevealing = false;
    }
  }

  function setupAnswerInterception() {
    const neutralizeBtn = () => {
      const btn = document.getElementById('show-answer');
      if (btn && btn.type === 'submit') {
        btn.type = 'button';
      }
    };

    neutralizeBtn();

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (target && (target.id === 'show-answer' || target.closest('#show-answer'))) {
        e.preventDefault();
        e.stopPropagation();
        revealAnswerInPlace(e);
      }
    }, true);

    document.addEventListener('submit', (e) => {
      const form = e.target;
      if (form && form.querySelector('#show-answer')) {
        e.preventDefault();
        e.stopPropagation();
        revealAnswerInPlace(e);
      }
    }, true);
  }

  function boot() {
    initSession();
    ensureUI();
    bindGlobalKeys();
    setupAnswerInterception();
    startWatch();
    refreshCtx();
    prefetchIfQuestion();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
