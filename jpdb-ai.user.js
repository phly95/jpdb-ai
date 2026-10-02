// ==UserScript==
// @name         JPDB AI Vocab Explainer
// @namespace    https://github.com/jpdb-ai/
// @version      1.0.87
// @description  Adds an AI button to jpdb.io reviews to explain the tested vocab's role in the sentence + free chat. Uses OpenAI-compatible Responses API.
// @author       you
// @match        https://jpdb.io/review*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      100.117.72.11
// @connect      openrouter.ai
// @connect      generativelanguage.googleapis.com
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

  const DEFAULT_JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
  const DEFAULT_JEV_MODEL = 'typesafe/jev-1.13';
  const DEFAULT_JEV_KEY = '';

  // Keep reasoning cheap/fast: "minimal" thinking level for both APIs.
  const REASONING_EFFORT = 'low';

  let updateFoot = () => {};
  let updateShortcutsUI = () => {};

  const CFG = {
    get base() { try { return (GM_getValue('jpdb_ai_base', DEFAULT_API_BASE) || DEFAULT_API_BASE).trim().replace(/\/+$/, ''); } catch { return DEFAULT_API_BASE; } },
    get model() { try { return (GM_getValue('jpdb_ai_model', DEFAULT_MODEL) || DEFAULT_MODEL).trim(); } catch { return DEFAULT_MODEL; } },
    get key() { try { return (GM_getValue('jpdb_ai_key', DEFAULT_API_KEY) || DEFAULT_API_KEY).trim(); } catch { return DEFAULT_API_KEY; } },
    get invertEnter() { try { return !!GM_getValue('jpdb_ai_invert_enter', false); } catch { return false; } },

    get jevEndpoint() { try { return (GM_getValue('jpdb_ai_jev_endpoint', DEFAULT_JEV_ENDPOINT) || DEFAULT_JEV_ENDPOINT).trim(); } catch { return DEFAULT_JEV_ENDPOINT; } },
    get jevModel() { try { return (GM_getValue('jpdb_ai_jev_model', DEFAULT_JEV_MODEL) || DEFAULT_JEV_MODEL).trim(); } catch { return DEFAULT_JEV_MODEL; } },
    get jevKey() { try { return (GM_getValue('jpdb_ai_jev_key', DEFAULT_JEV_KEY) || DEFAULT_JEV_KEY).trim(); } catch { return DEFAULT_JEV_KEY; } },

    set base(v) { GM_setValue('jpdb_ai_base', (v || '').trim().replace(/\/+$/, '')); },
    set model(v) { GM_setValue('jpdb_ai_model', (v || '').trim()); },
    set key(v) { GM_setValue('jpdb_ai_key', (v || '').trim()); },
    set invertEnter(v) { GM_setValue('jpdb_ai_invert_enter', !!v); },
    set jevEndpoint(v) { GM_setValue('jpdb_ai_jev_endpoint', (v || '').trim()); },
    set jevModel(v) { GM_setValue('jpdb_ai_jev_model', (v || '').trim()); },
    set jevKey(v) { GM_setValue('jpdb_ai_jev_key', (v || '').trim()); },
  };

  try {
    GM_registerMenuCommand('Open AI Settings', () => {
      if (typeof ensureFab === 'function') ensureFab();
      if (typeof ensurePanel === 'function') ensurePanel();
      if (typeof toggle === 'function') toggle(true);
      if (typeof toggleSettingsView === 'function') toggleSettingsView(true);
    });
    GM_registerMenuCommand('Toggle Enter / Ctrl+Enter mapping', () => {
      CFG.invertEnter = !CFG.invertEnter;
      alert('Switched to: ' + (CFG.invertEnter ? 'Enter = Rate translation, Ctrl+Enter = Send' : 'Enter = Send, Ctrl+Enter = Rate translation'));
      location.reload();
    });
  } catch {}

  // ---------- Card identification & scraping ----------
  function rubyToText(root) {
    if (!root) return '';
    const clone = root.cloneNode(true);
    clone.querySelectorAll('ruby').forEach((r) => {
      const rt = r.querySelector('rt');
      let baseText = '';
      r.childNodes.forEach((n) => {
        if (n.nodeType === 3) baseText += n.textContent;
      });
      baseText = baseText.trim();
      const reading = rt ? rt.textContent.trim() : '';
      const replacement = reading ? `${baseText}(${reading})` : baseText;
      r.replaceWith(document.createTextNode(replacement));
    });
    clone.querySelectorAll('.icon-link, [class*="audio"], i').forEach((x) => x.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function textOf(sel, scope) {
    const el = (scope || document).querySelector(sel);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  // Token that uniquely identifies the current review card (stable across Question <-> Answer)
  function getCardToken() {
    const inputC = document.querySelector('input[name="c"]');
    if (inputC && inputC.value) return inputC.value.trim();
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
    // If the "Show answer" button is in the DOM, answer is definitely hidden!
    if (document.getElementById('show-answer')) return false;
    // If grade buttons exist (e.g. #grade-1, #grade-p, #grade-f), answer is shown!
    if (document.querySelector('[id^="grade-"], #grade-f, #grade-p, #grade-1')) return true;
    // Fallback: check location hash and absence of show-answer
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
        .map((e) => e.textContent.replace(/\s+/g, ' ').trim())
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
    // Vocab word
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

    // Sentence JP
    const sentEl =
      document.querySelector('.card-sentence .sentence') ||
      document.querySelector('.sentence:not(.blur)') ||
      document.querySelector('.sentence') ||
      document.querySelector('.jp');
    const sentenceJP = sentEl ? rubyToText(sentEl) : '';

    // Translation
    const transEl =
      document.querySelector('.sentence-translation') ||
      document.querySelector('.en');
    let sentenceEN = transEl ? transEl.textContent.replace(/\s+/g, ' ').trim() : '';

    // Meanings + POS
    const meaningEls = document.querySelectorAll('.subsection-meanings .description');
    let meanings = Array.from(meaningEls).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12);
    let pos = textOf('.subsection-meanings .part-of-speech');

    // Extra examples
    const exampleEls = document.querySelectorAll('.subsection-examples .used-in');
    let examples = Array.from(exampleEls).slice(0, 3).map((e) => e.textContent.replace(/\s+/g, ' ').trim());

    // Merge background prefetch data if available
    const token = getCardToken();
    const bg = token ? cardDataCache[token] : null;
    if (bg) {
      if (!vocab && bg.vocab) vocab = bg.vocab;
      if (!sentenceEN && bg.sentenceEN) sentenceEN = bg.sentenceEN;
      if ((!meanings || meanings.length === 0) && bg.meanings && bg.meanings.length) {
        meanings = bg.meanings;
      }
      if (!pos && bg.pos) pos = bg.pos;
      if ((!examples || examples.length === 0) && bg.examples && bg.examples.length) {
        examples = bg.examples;
      }
    }

    const isAnswer = isAnswerShown();
    return { vocab, vocabId, sentenceJP, sentenceEN, meanings, pos, examples, isAnswer, url: location.href };
  }

  // ---------- LLM call (Streaming 2-Stage Display with Fallbacks) ----------
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

  async function callLLM(messages) {
    const base = CFG.base;
    let model = CFG.model;
    const key = CFG.key;

    // Normalize model string if user typed with spaces (e.g. Gemini 3.5 Flash Lite -> gemini-3.5-flash-lite)
    if (model.toLowerCase().includes('gemini') && model.includes(' ')) {
      model = model.trim().toLowerCase().replace(/\s+/g, '-');
    }

    // Detect Google Generative Language native endpoint
    const isGoogleNative = (base.includes('generativelanguage.googleapis.com') && !base.includes('/openai')) || base.includes(':generateContent');

    if (isGoogleNative) {
      let url = base;
      if (!url.includes(':generateContent')) {
        url = url.replace(/\/+$/, '') + '/models/' + encodeURIComponent(model.replace(/^models\//, '')) + ':generateContent';
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

  // ---------- Prompt building ----------
  const SYSTEM_PROMPT = 'You are a concise Japanese tutor helping a student reviewing vocabulary on jpdb.io. Prefer short, practical explanations. Use simple English with Japanese examples. Use markdown sparingly (bold, bullet lists). Always address the exact sentence given.';

  function buildExplainPrompt(info) {
    const lines = [];
    lines.push(`Tested vocab word: ${info.vocab || '(unknown — see URL)'}${info.vocabId ? ` (jpdb vocab id ${info.vocabId})` : ''}`);
    if (info.pos) lines.push(`Part of speech: ${info.pos}`);
    if (info.sentenceJP) lines.push(`Example sentence (JP): ${info.sentenceJP}`);
    if (info.sentenceEN) lines.push(`Given English translation: ${info.sentenceEN}`);
    if (info.meanings && info.meanings.length) lines.push(`Dictionary meanings shown on card:\n- ${info.meanings.join('\n- ')}`);
    lines.push(`\nPlease explain:`);
    lines.push(`1. The grammatical role / meaning of "${info.vocab || 'the tested word'}" IN THIS SENTENCE (which dictionary sense applies, what it attaches to, particle/conjugation/usage notes).`);
    lines.push(`2. How the sentence works as a whole — brief word-by-word breakdown showing how "${info.vocab || 'the word'}" fits in.`);
    lines.push(`3. One quick tip to remember this usage (and one common confusion to avoid).`);
    lines.push(`Keep it under ~220 words unless the grammar is tricky.`);
    return lines.join('\n');
  }

  function buildBreakdownPrompt(info) {
    return `Sentence: ${info.sentenceJP || '(no sentence found)'}
Given translation: ${info.sentenceEN || '(none)'}

Break down this sentence in a way that makes its structure click. You may explain the pieces out of their original order when that is clearer. Do not force a mechanical word-by-word table.

Use the following section labels as plain bold labels, not Markdown headings. Adapt or omit sections when they do not fit the sentence.

**Big picture**
Start with one or two plain-English sentences explaining how to mentally parse the sentence. Identify the core message or main predicate first, especially when it appears near the end.

**Core structure**
Show the smallest phrase carrying the main message in bold, followed by a natural English gloss and a short bullet breakdown of its important words, particles, and conjugations. Explain what the remaining material modifies, quotes, qualifies, or connects to.

**Modifying or supporting parts**
Group the rest into the fewest meaningful chunks that preserve the grammar. Make every line add new information.

For each chunk:
- Put the Japanese chunk, optional reading, compact gloss, and grammar explanation on one line whenever practical.
- Do not first gloss a chunk and then repeat its individual words underneath. Break out a component only if its role is not already clear from the chunk-level explanation.
- Combine simple word-plus-particle units, such as 君が, into one compact note: **君が** (きみが) — “you,” marked as the subject of the embedded clause.
- Assume common beginner vocabulary needs no separate definition unless its sentence-specific sense matters.
- Spend detail on the structure that unlocks the sentence: attachment, scope, clause boundaries, conjugation patterns, contrast, implication, and omitted information.
- Explain a grammar point only once. Later references should build on it rather than restate it.
- Explicitly explain connectors such as という, の, and こと; relative clauses; particles; auxiliary forms; and omitted subjects when present.
- Note informal spellings or contractions and give the standard form when relevant.

Prefer information-dense entries like:
- **君が** (きみが) — “you,” the subject of the embedded clause.
- **そうゆうことを** (standard: そういうことを) — “such a thing,” marked as the object of する.
- **してはならない** — “must not do”; する → して + the prohibition pattern 〜てはならない.

Avoid repetitive entries like:
- **君が** (“you”)
- **君**: you
- **が**: subject marker

**Putting it together**
Build the sentence up in two to four numbered stages, showing how each chunk combines with the next.

**Translations**
End with:
- **Literal:** a close structural translation
- **Natural:** a natural English translation

Use clean Markdown with bold labels and lists. Do not output raw HTML, CSS classes, or a word | reading | meaning table. Prioritize the grammar relationships that unlock the sentence over dictionary-style definitions. Be concise but thorough, usually 250–450 words.`;
  }

    // ---------- System One Jev-1.13 Evaluation ----------

  function getJapaneseSentenceWords(sentence, targetVocab) {
    if (!sentence) return targetVocab ? [targetVocab] : [];
    const clean = sentence.replace(/\([^)]*\)/g, '').trim();
    const cleanTarget = (targetVocab || '').replace(/\([^)]*\)/g, '').trim();

    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
      const initialSegments = Array.from(segmenter.segment(clean))
        .filter((s) => s.isWordLike && s.segment.trim().length > 0)
        .map((s) => s.segment);

      // Split any segments where a particle was fused with a following interrogative or adverb (e.g. "はいつ" -> "は" + "いつ")
      const particles = ['は', 'が', 'を', 'に', 'で', 'へ', 'と', 'も', 'より', 'から'];
      const followWords = ['いつ', 'どこ', 'だれ', '誰', 'なに', '何', 'どう', 'なぜ', '何故', 'どれ', 'どの', 'どちら', 'いくら', 'いくつ', 'どんな', 'もう', 'まだ', 'いま', '今', 'ここ', 'そこ', 'あそこ', 'これ', 'それ', 'あれ'];

      const rawSegments = [];
      for (const seg of initialSegments) {
        let split = false;
        for (const p of particles) {
          if (seg.startsWith(p) && seg.length > p.length) {
            const rest = seg.slice(p.length);
            if (followWords.some((fw) => rest.startsWith(fw))) {
              rawSegments.push(p);
              rawSegments.push(rest);
              split = true;
              break;
            }
          }
        }
        if (!split) rawSegments.push(seg);
      }

      let text = clean;
      const tokens = [];

      while (text.length > 0) {
        if (cleanTarget && text.startsWith(cleanTarget)) {
          tokens.push(cleanTarget);
          text = text.slice(cleanTarget.length);
          continue;
        }

        let matched = null;
        for (const seg of rawSegments) {
          if (text.startsWith(seg)) {
            if (!matched || seg.length > matched.length) {
              matched = seg;
            }
          }
        }

        if (matched) {
          tokens.push(matched);
          text = text.slice(matched.length);
        } else {
          tokens.push(text[0]);
          text = text.slice(1);
        }
      }

      const merged = [];
      for (let j = 0; j < tokens.length; j++) {
        const tok = tokens[j];

        // Always glue small kana (っ, ゃ, ゅ, ょ, etc.) or hatsuon 'ん' to previous token!
        if (j > 0 && /^[っゃゅょぁぃぅぇぉん]/.test(tok)) {
          merged[merged.length - 1] += tok;
          continue;
        }

        // Attach single particle to preceding word
        if (j > 0 && tok.length === 1 && ['は', 'が', 'を', 'に', 'で', 'へ', 'と', 'も', 'よ', 'ね', 'の', 'か'].includes(tok)) {
          const prev = merged[merged.length - 1];
          if (prev && !['は', 'が', 'を', 'に', 'で', 'へ', 'と', 'も'].includes(prev)) {
            merged[merged.length - 1] = prev + tok;
            continue;
          }
        }

        // Attach single hiragana inflection to preceding verb stem
        if (j > 0 && tok.length === 1 && /^[ぁ-ん]$/.test(tok)) {
          const prev = merged[merged.length - 1];
          if (prev && !['は', 'が', 'を', 'に', 'で', 'へ', 'と', 'も', 'よ', 'ね', 'わ'].includes(prev)) {
            merged[merged.length - 1] = prev + tok;
            continue;
          }
        }

        // Attach auxiliary verb morphemes, desire (~たい, ~みたい), and benefactives
        if (j > 0 && ['ない', 'たい', 'みたい', 'れる', 'られる', 'せる', 'させる', 'て', 'た', 'ば', 'ろう', 'ます', 'ません', 'くれ', 'やる', 'やって'].some((aux) => tok.startsWith(aux) || tok === aux)) {
          const prev = merged[merged.length - 1];
          if (prev && !['は', 'が', 'を', 'に', 'で', 'へ', 'と', 'も'].includes(prev)) {
            merged[merged.length - 1] = prev + tok;
            continue;
          }
        }

        merged.push(tok);
      }

      // Clean up any remaining small isolated auxiliary fragments (like trailing 'せんか' or 'か')
      const finalTokens = [];
      for (let j = 0; j < merged.length; j++) {
        const tok = merged[j];
        if (j > 0 && /^(?:せんか|ませんか|ません|ます|か|の|ね|よ)$/.test(tok)) {
          finalTokens[finalTokens.length - 1] += tok;
          continue;
        }
        finalTokens.push(tok);
      }

      const filtered = finalTokens.filter((w) => w.trim().length > 0 && !/^[、。！？\s.,!?…]+$/.test(w));
      if (filtered.length > 0) return filtered;
    }

    return cleanTarget ? [cleanTarget] : [clean];
  }

  function extractPhraseChunks(text) {
    if (!text) return [];
    const clean = text.trim();
    const chunks = new Set();
    const clauses = clean.split(/[,;\—\–]|\b(?:and|but|so|because|although|while|if|when)\b/i)
      .map((s) => s.trim().replace(/^[\.,!?"'\s]+|[\.,!?"'\s]+$/g, ''))
      .filter((s) => s.length > 0);

    for (const c of clauses) {
      chunks.add(c);
      const subParts = c.split(/\b(?:to|for|at|in|on|by|from|with)\b/i)
        .map((s) => s.trim().replace(/^[\.,!?"'\s]+|[\.,!?"'\s]+$/g, ''))
        .filter((s) => s.length > 3 && s.includes(' '));
      subParts.forEach((sp) => chunks.add(sp));
    }

    if (chunks.size < 2) {
      const words = clean.split(/\s+/);
      if (words.length >= 4) {
        chunks.add(words.slice(0, Math.ceil(words.length / 2)).join(' '));
        chunks.add(words.slice(Math.floor(words.length / 2)).join(' '));
      }
    }
    return Array.from(chunks).slice(0, 5);
  }

  function assessConfidence(answers) {
    let minConf = 1.0;
    let totalConf = 0;
    let count = 0;

    for (const [key, ans] of Object.entries(answers || {})) {
      if (ans && typeof ans.confidence === 'number') {
        minConf = Math.min(minConf, ans.confidence);
        totalConf += ans.confidence;
        count++;
      }
    }
    const avgConf = count > 0 ? (totalConf / count) : 1.0;
    return { minConf, avgConf };
  }

  function parseJevScores(answers, words, targetVocab, userDraft, referenceTranslation) {
    if (!answers) return null;
    words = Array.isArray(words) ? words : [];

    const isFlawlessProb = typeof answers.is_flawless?.noul === 'number' ? answers.is_flawless.noul : 0.5;
    const bracketChoice = answers.grade_bracket?.choice || '8_minor_nuance';
    const rawSeverity = answers.severity?.score;
    const severityScore = (typeof rawSeverity === 'number' && Number.isFinite(rawSeverity) && rawSeverity >= 0 && rawSeverity <= 4) ? rawSeverity : null;

    const { minConf: minConfidence, avgConf: avgConfidence } = assessConfidence(answers);

    // 1. Sentence-level structural checks (tokenizer-independent, evaluated independently)
    const sentenceCritiques = [];
    const summaryCritiqueChoice = answers.sentence_critique_summary?.choice;
    const benefactiveChoice = answers.benefactive_direction?.choice;
    const predCheck = answers.predicate_mood_and_voice?.choice;
    const interCheck = answers.interrogative_check?.choice;
    const polCheck = answers.polarity_check?.choice;
    const scopeCheck = answers.question_type_and_scope?.choice;
    const complexChoice = answers.predicate_complex_conjugation?.choice;

    const typoCheck = answers.english_typo_check?.choice;
    const typoConf = answers.english_typo_check?.confidence ?? 0;
    const typoWord = answers.suspected_typo_word?.choice;
    const isTypo = typoCheck === 'likely_english_typo_with_sound_comprehension' && typoConf >= 0.70;

    if (scopeCheck === 'confused_indefinite_with_wh_word') {
      sentenceCritiques.push({
        code: 'confused_indefinite_with_wh_word',
        severity: 'critical',
        label: 'Question scope error: Confused an indefinite pronoun (e.g. 何か "something" / 誰か "someone") with an open wh-question word ("what" / "who"), turning a yes/no question into an open-ended question.'
      });
    }

    if (complexChoice && complexChoice !== 'accurate_or_not_stacked' && complexChoice !== 'stacked_conjugation_not_applicable') {
      const complexLabels = {
        causative_passive_inverted: 'Causative-passive inverted: Expresses being subjected to an action ("was made to / was kept waiting"), not that you actively caused it.',
        causative_benefactive_inverted: 'Causative-benefactive mismatch: Expresses receiving permission or a favor ("let me do it"), not actively forcing someone else.',
        potential_change_of_state_missed: 'Potential + change of state missed: Expresses becoming unable to do something with regret ("ended up unable to..."), rather than a simple refusal or past negative.',
        conditional_regret_missed: 'Conditional regret missed: Expresses counterfactual regret ("I should have / wish I hadn\'t"), rather than a factual condition ("if...").',
        double_negative_obligation_inverted: 'Double-negative obligation inverted: Expresses necessity ("have no choice but to / must do"), but was translated as inability ("cannot do").'
      };
      sentenceCritiques.push({
        code: complexChoice,
        severity: ['causative_passive_inverted', 'causative_benefactive_inverted', 'double_negative_obligation_inverted'].includes(complexChoice) ? 'critical' : 'moderate',
        label: complexLabels[complexChoice] || 'Complex conjugation error'
      });
    }

    if (benefactiveChoice === 'recipient_reversed_self_vs_other') {
      sentenceCritiques.push({
        code: 'wrong_benefactive_or_recipient',
        severity: 'critical',
        label: 'Receiver/beneficiary mismatch: Confused who the action was done for (e.g. translated an action done for someone else or a pet as "me", or confused give/receive direction).'
      });
    } else if (benefactiveChoice === 'benefactive_omitted') {
      sentenceCritiques.push({
        code: 'benefactive_omitted',
        severity: 'moderate',
        label: 'Benefactive nuance omitted: the translation does not convey that the action was performed for someone.'
      });
    }

    if (predCheck === 'passive_vs_active_error') {
      sentenceCritiques.push({
        code: 'passive_voice_reversed',
        severity: 'critical',
        label: 'Grammatical voice reversed: Passive voice was translated as active (or subject/agent inverted).'
      });
    } else if (predCheck === 'potential_vs_intent_error') {
      sentenceCritiques.push({
        code: 'potential_or_modality_error',
        severity: 'moderate',
        label: "Modality mismatch: Potential form ('can / be able to') was translated as intent ('will')."
      });
    } else if (predCheck === 'tense_past_present_error') {
      sentenceCritiques.push({
        code: 'tense_or_aspect_error',
        severity: 'moderate',
        label: 'Tense/aspect mismatch: Confused past tense with present/future, or continuous aspect.'
      });
    } else if (predCheck === 'predicate_omitted_or_wrong') {
      sentenceCritiques.push({
        code: 'wrong_verb_or_action',
        severity: 'critical',
        label: 'Core predicate mismatch: the main action was omitted or mistranslated.'
      });
    }

    if (polCheck === 'polarity_inverted') {
      sentenceCritiques.push({
        code: 'polarity_inverted',
        severity: 'critical',
        label: 'Polarity reversed: Affirmative statement was translated as negative, or vice-versa.'
      });
    }

    if (interCheck === 'question_word_omitted' || interCheck === 'wrong_question_word') {
      sentenceCritiques.push({
        code: 'interrogative_or_question_error',
        severity: 'moderate',
        label: 'Question structure error: The question word or interrogative meaning was missed or changed.'
      });
    }

    // High-level critique dictionary
    const summaryCritiqueLabels = {
      wrong_benefactive_or_recipient: 'Receiver/beneficiary mismatch: Confused who the action was done for (e.g. translated an action done for someone else or a pet as "me", or confused give/receive direction).',
      passive_voice_reversed: 'Grammatical voice reversed: Passive voice was translated as active (subject was receiving the action).',
      subject_object_inverted: 'Subject/object inverted: Confused who did what to whom in an active sentence.',
      agent_or_passive_reversed: 'Grammatical voice reversed: Confused subject vs object or active vs passive voice.',
      wrong_verb_or_action: 'Core action mismatch: The main verb or core action was mistranslated or misunderstood.',
      tense_or_aspect_error: 'Tense/aspect mismatch: Confused past tense with present/future, or continuous aspect.',
      potential_or_modality_error: "Modality/mood mismatch: Confused ability/potential ('can') with intent ('will'), or certainty with possibility.",
      interrogative_or_question_error: 'Question structure error: The question word or interrogative meaning was missed or changed.',
      minor_nuance_or_word_choice_difference: 'Minor nuance difference: Captured the general meaning, but with slight nuance, word choice, or phrasing variation.'
    };

    if (summaryCritiqueChoice && summaryCritiqueChoice !== 'no_flaws_accurate' && summaryCritiqueChoice !== 'minor_nuance_or_word_choice_difference') {
      if (!sentenceCritiques.some((sc) => sc.code === summaryCritiqueChoice)) {
        sentenceCritiques.push({
          code: summaryCritiqueChoice,
          severity: ['wrong_benefactive_or_recipient', 'passive_voice_reversed', 'subject_object_inverted', 'agent_or_passive_reversed', 'wrong_verb_or_action'].includes(summaryCritiqueChoice) ? 'critical' : 'moderate',
          label: summaryCritiqueLabels[summaryCritiqueChoice] || 'Translation discrepancy noted.'
        });
      }
    }

    // Dynamic Excerpt Contrast
    const stEx = answers.flawed_student_excerpt?.choice;
    const refEx = answers.correct_reference_excerpt?.choice;
    const rel = answers.contrast_relation?.choice;
    let excerptComparison = null;
    if (stEx && refEx && rel && rel !== 'accurate_equivalent') {
      excerptComparison = {
        studentExcerpt: stEx,
        referenceExcerpt: refEx,
        relation: rel
      };
    }

    const mistakes = [];
    const advisories = [];
    const cleanTarget = (targetVocab || '').replace(/\([^)]*\)/g, '').trim();

    // 2. Check target vocabulary specific diagnostic
    const tvAns = answers.target_vocab_handling;
    const tvChoice = tvAns?.choice;
    const tvConf = tvAns?.confidence ?? 0;

    if (cleanTarget && tvChoice) {
      const tvIdx = words.findIndex((w) => w === cleanTarget || cleanTarget.includes(w) || w.includes(cleanTarget));
      if (tvChoice === 'awkward_or_literal_misfit') {
        advisories.push({
          tokenIndex: tvIdx >= 0 ? tvIdx : null,
          word: cleanTarget,
          type: 'awkward_or_literal_misfit',
          description: 'awkward word sense or literal nuance misfit in this context',
          confidence: tvConf
        });
      } else if (tvChoice === 'wrong_definition_or_misinterpreted') {
        mistakes.push({
          tokenIndex: tvIdx >= 0 ? tvIdx : null,
          word: cleanTarget,
          type: 'wrong_definition_or_misinterpreted',
          description: 'tested vocabulary was mistranslated or misunderstood',
          confidence: tvConf
        });
      } else if (tvChoice === 'omitted_or_missing') {
        mistakes.push({
          tokenIndex: tvIdx >= 0 ? tvIdx : null,
          word: cleanTarget,
          type: 'omitted_or_missing',
          description: 'tested vocabulary was completely omitted from translation',
          confidence: tvConf
        });
      }
    }

    // 3. Check granular word diagnostics by tokenIndex (content words only)
    const interrogativeWords = ['いつ', 'どこ', 'だれ', '誰', 'なに', '何', 'どう', 'なぜ', '何故', 'どれ', 'どの', 'どちら', 'いくら', 'いくつ', 'どんな'];

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      // Skip if this token was already claimed by target vocabulary check
      if (mistakes.some((m) => m.tokenIndex === i) || advisories.some((a) => a.tokenIndex === i)) continue;

      const pOmitted = answers['word_' + i + '_omitted']?.noul ?? 0;
      const senseAns = answers['word_' + i + '_sense'];
      const senseChoice = senseAns?.choice || 'natural_correct_sense';
      const senseConf = senseAns?.confidence ?? 0;

      const gramAns = answers['word_' + i + '_grammar'];
      const gramChoice = gramAns?.choice || 'correct_grammar_or_not_applicable';
      const gramConf = gramAns?.confidence ?? 0;

      const isInterrogative = interrogativeWords.some((iw) => w.includes(iw));
      const interrogativeConfirmedPresent = isInterrogative && interCheck === 'correct_or_no_interrogative';

      if (gramChoice === 'recipient_or_beneficiary_error') {
        mistakes.push({
          tokenIndex: i,
          word: w,
          type: 'recipient_or_beneficiary_error',
          description: 'benefactive direction reversed: confused who the action was done for (favor for other/pet vs me)',
          confidence: gramConf
        });
      } else if (gramChoice === 'voice_passive_active_error') {
        mistakes.push({
          tokenIndex: i,
          word: w,
          type: 'voice_passive_active_error',
          description: 'passive/active voice reversed or subject/agent inverted',
          confidence: gramConf
        });
      } else if (gramChoice === 'modality_or_mood_error') {
        const modalityDesc = (function (tok) {
          if (/(?:ば|たら|なら|と)(?:なあ|いい|のに)?$/.test(tok) || tok.includes('なあ') || tok.includes('のに')) {
            return "conditional wish ('I wish / if only') confused with active desire or intent";
          }
          if (/(?:れる|られる|える|ける|せる|できる)$/.test(tok)) {
            return "potential ability ('can') confused with future intent ('will')";
          }
          if (/(?:かもしれない|かも|だろう|らしい|ようだ|よう)$/.test(tok)) {
            return "uncertainty or possibility ('might/may') translated with false certainty";
          }
          return "grammatical mood or modality mismatch (wish, potential, or intent)";
        })(w);
        mistakes.push({
          tokenIndex: i,
          word: w,
          type: 'modality_or_mood_error',
          description: modalityDesc,
          confidence: gramConf
        });
      } else if (gramChoice === 'tense_or_aspect_error') {
        mistakes.push({
          tokenIndex: i,
          word: w,
          type: 'tense_or_aspect_error',
          description: 'tense or aspect confused (past vs present/future)',
          confidence: gramConf
        });
      } else if (senseChoice === 'awkward_or_literal_misfit') {
        advisories.push({
          tokenIndex: i,
          word: w,
          type: 'awkward_or_literal_misfit',
          description: 'awkward word sense or literal nuance misfit in this context',
          confidence: senseConf
        });
      } else if (senseChoice === 'mistranslated_or_wrong_meaning') {
        mistakes.push({
          tokenIndex: i,
          word: w,
          type: 'mistranslated_or_wrong_meaning',
          description: 'meaning was misinterpreted or mistranslated',
          confidence: senseConf
        });
      } else if (pOmitted >= 0.85 && !interrogativeConfirmedPresent) {
        mistakes.push({
          tokenIndex: i,
          word: w,
          type: 'omitted_or_missing',
          description: 'omitted or missing from translation',
          confidence: pOmitted
        });
      }
    }

    // 4. Synthesize Dynamic Concise Critique (LLM-style synthesis)
    const isTargetFlawed = tvChoice && tvChoice !== 'natural_accurate_sense';
    const omittedItem = mistakes.find((m) => m.type === 'omitted_or_missing' && m.word && !m.word.startsWith('Sentence:'));
    const specificWordIssue = mistakes.find((m) => m.word && !m.word.startsWith('Sentence:')) || advisories.find((a) => a.word && !a.word.startsWith('Sentence:'));

    // Determine the relevant focus word: if tested vocab is flawed, use it; otherwise use the specific flawed word, or infer the verb
    const verbToken = words.find((w) => /(?:さ?れる|られ|させ|ちゃう|ちゃった|なかっ|ばよかった|わけにはいかない|たい|でした|ます)$/.test(w));
    const predWord = isTargetFlawed ? cleanTarget : (verbToken || specificWordIssue?.word || 'The predicate');
    const targetWord = isTargetFlawed ? cleanTarget : (specificWordIssue?.word || null);
    let dynamicCritique = '';

    if (isTypo) {
      if (typoWord && typoWord !== 'none') {
        dynamicCritique = `Your Japanese comprehension is sound, but "**${typoWord}**" appears to be an English typo or autocorrect slip in your translation.`;
      } else {
        dynamicCritique = `Your Japanese comprehension is sound, but your translation appears to contain a minor English keyboard typo or autocorrect slip.`;
      }
    } else if (omittedItem && (!isTargetFlawed || omittedItem.word === cleanTarget)) {
      if (stEx && refEx) {
        dynamicCritique = `Your draft ("${stEx}") missed **${omittedItem.word}**, omitting the degree nuance conveyed in the reference translation ("${refEx}").`;
      } else {
        dynamicCritique = `Your translation missed the word **${omittedItem.word}**, omitting the nuance of degree in this context.`;
      }
    } else if (stEx && refEx && rel && rel !== 'accurate_equivalent') {
      if (rel === 'passive_vs_active_reversal' || summaryCritiqueChoice === 'passive_voice_reversed' || predCheck === 'passive_vs_active_error') {
        dynamicCritique = `Instead of translating "${predWord}" as passive ("${refEx}"), your draft translated it actively as "${stEx}", reversing who received the action.`;
      } else if (rel === 'causative_reversal' || complexChoice === 'causative_passive_inverted') {
        dynamicCritique = `In Japanese, the causative-passive "${predWord}" expresses being subjected to an action ("${refEx}"), but you translated it as causing the action ("${stEx}").`;
      } else if (rel === 'benefactive_direction_inverted' || summaryCritiqueChoice === 'wrong_benefactive_or_recipient' || benefactiveChoice === 'recipient_reversed_self_vs_other') {
        dynamicCritique = `You translated "${predWord}" as "${stEx}", but it indicates a favor received from someone else ("${refEx}"), not a favor you performed.`;
      } else if (rel === 'potential_vs_intent' || summaryCritiqueChoice === 'potential_or_modality_error' || predCheck === 'potential_vs_intent_error') {
        dynamicCritique = `You translated "${predWord}" as "${stEx}", but the potential form expresses "${refEx}" (ability/possibility rather than future certainty).`;
      } else if (rel === 'obligation_vs_absence' || complexChoice === 'double_negative_obligation_inverted') {
        dynamicCritique = `"${predWord}" expresses an obligation ("${refEx}"), but your translation "${stEx}" turned it into an absence of obligation.`;
      } else if (rel === 'counterfactual_regret_vs_condition' || complexChoice === 'conditional_regret_missed') {
        dynamicCritique = `"${predWord}" expresses counterfactual regret ("${refEx}"), rather than a literal factual condition ("${stEx}").`;
      } else if (rel === 'question_vs_statement' || summaryCritiqueChoice === 'interrogative_or_question_error' || scopeCheck === 'confused_indefinite_with_wh_word') {
        dynamicCritique = `You translated this as an open question ("${stEx}"), but "${predWord}" is an indefinite pronoun in a statement ("${refEx}").`;
      } else if (rel === 'degree_or_modifier_omitted') {
        dynamicCritique = `Your draft ("${stEx}") omitted a modifier or degree nuance conveyed in the reference translation ("${refEx}").`;
      } else {
        if (targetWord && isTargetFlawed) {
          dynamicCritique = `In this context, "${targetWord}" naturally translates to "${refEx}", whereas "${stEx}" sounds slightly awkward or overly literal.`;
        } else {
          dynamicCritique = `In this sentence, the natural phrasing is "${refEx}" rather than "${stEx}".`;
        }
      }
    } else if (complexChoice && complexChoice !== 'accurate_or_not_stacked' && complexChoice !== 'stacked_conjugation_not_applicable') {
      if (complexChoice === 'causative_passive_inverted') {
        dynamicCritique = `You inverted the causative-passive: "${predWord}" expresses being subjected to an action ("was made to / was kept waiting"), not that you actively made someone else wait.`;
      } else if (complexChoice === 'causative_benefactive_inverted') {
        dynamicCritique = `You misunderstood the causative-benefactive: "${predWord}" expresses being granted permission or receiving a favor ("let me do it"), not actively forcing someone else.`;
      } else if (complexChoice === 'potential_change_of_state_missed') {
        dynamicCritique = `"${predWord}" expresses becoming unable to do something with regret ("ended up unable to..."), rather than a simple refusal or past negative.`;
      } else if (complexChoice === 'conditional_regret_missed') {
        dynamicCritique = `"${predWord}" expresses counterfactual regret ("I should have / wish I hadn't"), rather than a factual condition ("if...").`;
      } else if (complexChoice === 'double_negative_obligation_inverted') {
        dynamicCritique = `"${predWord}" is an obligation pattern meaning "have no choice but to / must do", but you translated it as an inability ("cannot do").`;
      }
    } else if (polCheck === 'polarity_inverted') {
      dynamicCritique = `Polarity reversed: The Japanese sentence expresses a negative statement, but you translated it as affirmative (or vice versa).`;
    } else if (summaryCritiqueChoice === 'passive_voice_reversed' || predCheck === 'passive_vs_active_error') {
      dynamicCritique = `You reversed the passive voice: "${predWord}" indicates the subject is receiving the action, not initiating it.`;
    } else if (summaryCritiqueChoice === 'subject_object_inverted') {
      dynamicCritique = `You inverted who did what to whom: the grammatical subject and object were swapped.`;
    } else if (summaryCritiqueChoice === 'wrong_benefactive_or_recipient' || benefactiveChoice === 'recipient_reversed_self_vs_other') {
      dynamicCritique = `You reversed the favor direction: "${predWord}" indicates an action performed for someone else rather than for oneself (or vice versa).`;
    } else if (scopeCheck === 'confused_indefinite_with_wh_word' || summaryCritiqueChoice === 'interrogative_or_question_error') {
      dynamicCritique = `You translated this as an open question ("what"), but "${predWord}" is an indefinite pronoun ("something/anything") in a statement.`;
    } else if (summaryCritiqueChoice === 'potential_or_modality_error' || predCheck === 'potential_vs_intent_error') {
      dynamicCritique = `"${predWord}" is in the potential form ("can do"), but you translated it as simple future intent ("will do").`;
    } else if (predCheck === 'tense_past_present_error' || summaryCritiqueChoice === 'tense_or_aspect_error') {
      dynamicCritique = `Tense mismatch: past tense was translated as present/future (or continuous aspect was missed).`;
    } else if (summaryCritiqueChoice === 'minor_nuance_or_word_choice_difference') {
      if (isTargetFlawed && predWord === '今度') {
        dynamicCritique = `In an invitation context, 今度 naturally means "sometime soon" or "next time", whereas translating it literally as "this time" sounds awkward in English.`;
      } else if (specificWordIssue && specificWordIssue.word !== cleanTarget) {
        dynamicCritique = `Noticeable nuance gap with **${specificWordIssue.word}**: ${specificWordIssue.description}.`;
      } else {
        dynamicCritique = `The overall communicative meaning is understood, but there is a slight nuance gap or dropped modifier compared to natural native phrasing.`;
      }
    } else if (summaryCritiqueChoice === 'wrong_verb_or_action') {
      dynamicCritique = `The core verb or action was misunderstood or mistranslated.`;
    }

    // 5. Strict Scoring and Presentation Reconciliation:
    const hasCriticalFault = sentenceCritiques.some((sc) => sc.severity === 'critical') || mistakes.some((m) => m.type === 'wrong_definition_or_misinterpreted');
    const hasModerateFault = sentenceCritiques.some((sc) => sc.severity === 'moderate');
    const isCleanFlawless = (!hasCriticalFault && !hasModerateFault && mistakes.length === 0 && advisories.length === 0 && sentenceCritiques.length === 0 && isFlawlessProb >= 0.80);
    const hasAdvisory = advisories.length > 0 || mistakes.length > 0 || (!isCleanFlawless && summaryCritiqueChoice === 'minor_nuance_or_word_choice_difference');

    const isFlawlessCandidate = (isFlawlessProb >= 0.85 && bracketChoice === '10_flawless' && (severityScore === null || severityScore >= 3.5));

    let overall = 8;
    if (isTypo) {
      overall = 8;
    } else if (!hasCriticalFault && !hasModerateFault && !hasAdvisory && (isCleanFlawless || isFlawlessCandidate || bracketChoice === '10_flawless' || isFlawlessProb >= 0.85)) {
      overall = 10;
    } else if (bracketChoice === '10_flawless') {
      overall = hasCriticalFault ? 5 : (hasModerateFault ? 7 : 8);
    } else if (bracketChoice === '8_minor_nuance') {
      overall = (mistakes.length === 0 && sentenceCritiques.length === 0 && isFlawlessProb >= 0.80) ? 10 : (hasCriticalFault ? 6 : 8);
    } else if (bracketChoice === '5_moderate_error') {
      overall = (severityScore !== null ? severityScore >= 2.15 : false) ? 6 : 5;
    } else if (bracketChoice === '3_major_error') {
      overall = (severityScore !== null ? severityScore >= 1.25 : false) ? 4 : 3;
    } else if (bracketChoice === '1_fatal_error') {
      overall = (severityScore !== null ? severityScore >= 0.7 : false) ? 2 : 1;
    } else {
      overall = hasCriticalFault ? 4 : (hasModerateFault ? 6 : 8);
    }

    const bracketLabels = {
      '10_flawless': 'Flawless',
      '8_minor_nuance': 'Minor Nuance',
      '5_moderate_error': 'Moderate Error',
      '3_major_error': 'Major Error',
      '1_fatal_error': 'Fatal Error'
    };
    const bracketLabel = isTypo ? 'Minor Nuance' : (bracketLabels[bracketChoice] || (overall === 10 ? 'Flawless' : 'Evaluation'));

    if (overall === 10 || isTypo) {
      if (overall === 10) dynamicCritique = '';
      excerptComparison = null;
    }

    const summaryCritiqueText = overall === 10 ? '' : (dynamicCritique || (sentenceCritiques.length > 0 ? sentenceCritiques[0].label : ''));
    const scoreLabel = `${overall}/10`;
    const scoreClass = overall === 10 ? 'high' : (overall >= 7 ? 'med' : 'low');

    // Filter granular mistakes/advisories to avoid repeating the target vocab or morpheme splinters if dynamic critique already explains it
    const displayMistakes = (overall === 10 || isTypo) ? [] : (summaryCritiqueText ? mistakes.filter((m) => m.word !== cleanTarget && !m.word.startsWith('Sentence:')) : mistakes);
    const displayAdvisories = (overall === 10 || isTypo) ? [] : (summaryCritiqueText ? advisories.filter((a) => a.word !== cleanTarget && !a.word.startsWith('Sentence:')) : advisories);

    // Decision-level confidence assessment
    const bracketConf = answers.grade_bracket?.confidence ?? 0;
    const isClearComplexError = complexChoice && complexChoice !== 'accurate_or_not_stacked' && complexChoice !== 'stacked_conjugation_not_applicable' && (answers.predicate_complex_conjugation?.confidence ?? 0) >= 0.75;
    const isClearBenefactiveError = benefactiveChoice === 'recipient_reversed_self_vs_other' && (answers.benefactive_direction?.confidence ?? 0) >= 0.80;
    const isClearVoiceError = (summaryCritiqueChoice === 'passive_voice_reversed' || predCheck === 'passive_vs_active_error') && ((answers.sentence_critique_summary?.confidence ?? 0) >= 0.75 || (answers.predicate_mood_and_voice?.confidence ?? 0) >= 0.75);
    const isClearPotentialError = (summaryCritiqueChoice === 'potential_or_modality_error' || predCheck === 'potential_vs_intent_error') && ((answers.sentence_critique_summary?.confidence ?? 0) >= 0.75 || (answers.predicate_mood_and_voice?.confidence ?? 0) >= 0.75);
    const isClearSummaryError = summaryCritiqueChoice && summaryCritiqueChoice !== 'no_flaws_accurate' && (answers.sentence_critique_summary?.confidence ?? 0) >= 0.80;
    const isDecisionConfident = (isClearComplexError || isClearBenefactiveError || isClearVoiceError || isClearPotentialError || isClearSummaryError);

    return {
      overall,
      scoreLabel,
      scoreClass,
      bracketLabel,
      summaryCritiqueText,
      dynamicCritique,
      excerptComparison,
      sentenceCritiques,
      mistakes,
      advisories,
      displayMistakes,
      displayAdvisories,
      isFlawlessProb,
      severityScore,
      bracket: isTypo ? '8_minor_nuance' : bracketChoice,
      words,
      minConfidence,
      avgConfidence,
      isTypo,
      typoConfidence: typoConf,
      typoWord: (typoWord && typoWord !== 'none') ? typoWord : null,
      bracketConfidence: bracketConf,
      isDecisionConfident,
      rawAnswers: answers
    };
  }

  function renderJevCard(metrics, modelName) {
    if (!metrics) return '';
    const { overall, scoreLabel, scoreClass, bracketLabel, summaryCritiqueText, excerptComparison, displayMistakes, displayAdvisories, words } = metrics;
    const isMinor = overall >= 7;

    const mistakesToShow = displayMistakes || [];
    const advisoriesToShow = displayAdvisories || [];
    const hasMistakes = mistakesToShow.length > 0;
    const hasAdvisories = advisoriesToShow.length > 0;
    const tag = modelName || CFG.jevModel || DEFAULT_JEV_MODEL;

    return `
      <details class="jpdb-ai-jev-card" open>
        <summary class="jpdb-ai-jev-head" title="Click to collapse/expand breakdown">
          <span class="jpdb-ai-jev-title">⚡ Instant Assessment <span class="jpdb-ai-jev-tag">${escapeHtml(tag)}</span></span>
          <span class="jpdb-ai-jev-score ${scoreClass}" title="Calculated instant score: ${overall}/10">${scoreLabel}${bracketLabel ? ` (${escapeHtml(bracketLabel)})` : ''}</span>
        </summary>
        <div class="jpdb-ai-jev-body">
          ${overall < 10 && excerptComparison ? `
            <div class="jpdb-ai-jev-excerpt">
              <span class="jpdb-ai-jev-pill err" title="Your draft excerpt">"${escapeHtml(excerptComparison.studentExcerpt)}"</span>
              <span class="jpdb-ai-jev-arrow">➔</span>
              <span class="jpdb-ai-jev-pill ok" title="Reference translation excerpt">"${escapeHtml(excerptComparison.referenceExcerpt)}"</span>
            </div>
          ` : ''}

          ${overall < 10 && summaryCritiqueText ? `
            <div class="jpdb-ai-jev-summary ${isMinor ? 'minor' : ''}">
              <span class="jpdb-ai-jev-summary-icon">⚠️</span>
              <div>${renderInline(escapeHtml(summaryCritiqueText))}</div>
            </div>
          ` : ''}

          ${overall < 10 && hasMistakes ? `
            <div class="jpdb-ai-jev-mistakes">
              <div class="jpdb-ai-jev-mistakes-title">Detected Issues:</div>
              <ul class="jpdb-ai-jev-mistakes-list">
                ${mistakesToShow.map((m) => `
                  <li>
                    <span class="jpdb-ai-jev-word">${escapeHtml(m.word)}</span>: 
                    <span class="jpdb-ai-jev-desc">${renderInline(escapeHtml(m.description))}</span>
                  </li>
                `).join('')}
              </ul>
            </div>
          ` : ''}

          ${overall < 10 && hasAdvisories ? `
            <div class="jpdb-ai-jev-advisories" style="${hasMistakes ? 'margin-top:6px;' : ''}">
              <div class="jpdb-ai-jev-advisories-title">Nuance Notes:</div>
              <ul class="jpdb-ai-jev-advisories-list">
                ${advisoriesToShow.map((a) => `
                  <li>
                    <span class="jpdb-ai-jev-word advisory">${escapeHtml(a.word)}</span>: 
                    <span class="jpdb-ai-jev-desc">${renderInline(escapeHtml(a.description))}</span>
                  </li>
                `).join('')}
              </ul>
            </div>
          ` : ''}

          ${overall === 10 ? `
            <div class="jpdb-ai-jev-flawless">
              <span class="jpdb-ai-jev-check">✓</span> Flawless translation — all words &amp; nuances accurately conveyed!
            </div>
          ` : (!hasMistakes && !hasAdvisories && !summaryCritiqueText ? `
            <div class="jpdb-ai-jev-nuance-note">
              <span class="jpdb-ai-jev-info-icon">ℹ️</span> Minor nuance difference or phrasing variation (see detailed critique below)
            </div>
          ` : '')}

          ${words && words.length > 0 ? `
            <div class="jpdb-ai-jev-tokens">
              ${words.map((w, idx) => {
                const isErr = overall < 10 && (metrics.mistakes || []).some((m) => m.tokenIndex === idx || (m.tokenIndex === null && (m.word === w || m.word.includes(w) || w.includes(m.word))));
                const isAdv = overall < 10 && !isErr && (metrics.advisories || []).some((a) => a.tokenIndex === idx || (a.tokenIndex === null && (a.word === w || a.word.includes(w) || w.includes(a.word))));
                const tokenClass = isErr ? 'err' : (isAdv ? 'advisory' : 'ok');
                return `<span class="jpdb-ai-jev-token ${tokenClass}">${escapeHtml(w)}</span>`;
              }).join(' ')}
            </div>
          ` : ''}
        </div>
      </details>
    `.trim();
  }

  function getJevConnection() {
    const endpoint = CFG.jevEndpoint || DEFAULT_JEV_ENDPOINT;
    const key = CFG.jevKey;
    let model = CFG.jevModel || DEFAULT_JEV_MODEL;

    let url = endpoint.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    if (!url.endsWith('/decisions') && !url.endsWith('/systemone')) {
      if (url.includes('openrouter.ai')) {
        url = url.replace(/\/+$/, '') + '/api/alpha/decisions';
      } else {
        url = url.replace(/\/+$/, '') + '/systemone';
      }
    }

    if (url.includes('openrouter.ai') && model.startsWith('openrouter/')) {
      model = model.replace(/^openrouter\//, '');
    }

    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = 'Bearer ' + key;
    if (url.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://jpdb.io';
      headers['X-Title'] = 'JPDB AI Explainer';
    }

    return { url, headers, model };
  }

  async function callJevEvaluation(info, userDraft) {
    const t0 = Date.now();
    try {
      const conn = getJevConnection();
      const url = conn.url;
      const headers = conn.headers;
      const model = conn.model;

      const cleanJp = (info.sentenceJP || '').replace(/\([^)]*\)/g, '').trim();
      const cleanTarget = (info.vocab || '').replace(/\([^)]*\)/g, '').trim();
      const targetText = userDraft || info.sentenceEN || '';
      const allWords = getJapaneseSentenceWords(info.sentenceJP, info.vocab);
      const contentWords = (allWords || []).filter((w) => w && w.length > 1 && !['から', 'まで', 'より', 'けど', 'ので', 'のに', 'んだ'].includes(w));
      const words = contentWords.length > 0 ? contentWords : allWords;

      const studentChunks = extractPhraseChunks(targetText);
      const refChunks = extractPhraseChunks(info.sentenceEN || '');
      const userWords = (targetText || '').trim().split(/\s+/).map((w) => w.replace(/^[\.,!?"'\s]+|[\.,!?"'\s]+$/g, '')).filter((w) => w.length > 0);

      const state = {
        japanese_sentence: cleanJp || info.sentenceJP || '',
        user_translation: targetText,
        target_vocabulary: cleanTarget || info.vocab || '',
        target_meanings: (info.meanings || []).slice(0, 3),
        reference_translation: info.sentenceEN || '',
        words: words,
        user_words: userWords,
        student_chunks: studentChunks,
        reference_chunks: refChunks
      };

      const questions = {
        is_flawless: {
          type: 'noul',
          instructions: {
            question: 'Is `user_translation` an accurate, faithful, natural, or idiomatic translation of `japanese_sentence` in context?',
            focus: 'Translations that convey the natural communicative meaning, pragmatic tone, or idiomatic sense count as flawless (1.0). Natural English nominalization or equivalent phrasing (e.g. translating an embedded question clause 何を意味するのか as "the meaning of this word" rather than literally "what this word means") counts as flawless (1.0). Minor English typos, phonetic homophones (e.g. their/there, its/it\'s, hear/here), or autocorrect slips do not disqualify a translation if Japanese comprehension is accurate. CRITICAL EXCEPTION: Confusing an indefinite pronoun like 何か ("something/anything") with an open wh-question word like 何 ("what"), turning a yes/no question into an open-ended wh-question, is a clear semantic error and MUST return 0.0 (false).'
          }
        },
        english_typo_check: {
          type: 'choice',
          instructions: {
            question: 'Does `user_translation` contain an English keyboard typo, homophone, or autocorrect slip (e.g. "now" for "not", "their" for "there", "we\'ll" for "well", "hear" for "here", "to" for "too", "its" for "it\'s") where the underlying Japanese comprehension was otherwise accurate?',
            focus: 'Determine whether a word discrepancy is a harmless English keyboard/autocorrect slip or a genuine Japanese comprehension failure.'
          },
          options: [
            'no_typos_clean_english',
            'likely_english_typo_with_sound_comprehension',
            'genuine_japanese_comprehension_error'
          ],
          criteria: {
            no_typos_clean_english: 'English is spelled correctly or has only trivial punctuation variation.',
            likely_english_typo_with_sound_comprehension: 'An English word looks like an obvious keyboard typo or autocorrect slip (e.g. typing "now" instead of "not" in "it\'s okay to now know that") where the Japanese grammar was clearly understood.',
            genuine_japanese_comprehension_error: 'The discrepancy is due to mistranslating the Japanese meaning, grammar, or vocabulary, not an English keyboard typo.'
          }
        },
        grade_bracket: {
          type: 'choice',
          instructions: 'Grade this translation on the 10/10 scale considering contextual accuracy and natural English phrasing compared to `reference_translation`. Note: Natural synonyms, equivalent phrasings, and natural nominalizations of embedded clauses (e.g. "the meaning of this word" for 何を意味するのか, direct translations like "what I thought" for 思っていた, "talked to" for 話した, "found" for 見つけた), idiomatic expressions, conversational softeners, and natural equivalents capture the communicative intent perfectly and should receive 10_flawless. Obvious English typos or homophones (like typing "now" for "not") where Japanese comprehension is accurate should be graded as 8_minor_nuance (8/10), NOT a major or fatal error.',
          options: ['10_flawless', '8_minor_nuance', '5_moderate_error', '3_major_error', '1_fatal_error'],
          criteria: {
            '10_flawless': 'Flawless, natural, and contextually idiomatic translation (including conversational synonyms and natural nominalizations of embedded clauses). Conveys the communicative intent and tone with no deductions.',
            '8_minor_nuance': 'Good translation with minor nuance difference, dropped secondary modifier, or harmless English typo with sound Japanese comprehension.',
            '5_moderate_error': 'Noticeable grammatical or vocabulary error (e.g. potential vs intent, certainty vs possibility, wrong tense, or missed key grammar point).',
            '3_major_error': 'Major error: wrong core verb, reversed passive/active, inverted subject/object, or vital clause missing.',
            '1_fatal_error': 'Fatal error: completely wrong meaning, inverted polarity, unrelated hallucination, or nonsense.'
          }
        },
        severity: {
          type: 'score',
          instructions: 'Rate overall accuracy on the 5-point severity scale from 0 (fatal error) to 4 (flawless). Flawless and natural idiomatic translations, as well as translations with minor English typos or homophones (e.g. their/there, we\'ll/well) where Japanese comprehension is accurate, must receive Level 4 (flawless).',
          legend: ['fatal_error', 'major_error', 'moderate_error', 'minor_nuance', 'flawless'],
          criteria: [
            'Fatal error (Level 0): completely wrong message, nonsense, or inverted meaning',
            'Major error (Level 1): wrong core verb, reversed subject/object/passive, or vital clause missing',
            'Moderate error (Level 2): key grammar point or target vocab misunderstood',
            'Minor nuance (Level 3): good translation, but slight nuance shift, awkward word choice, or minor omission',
            'Flawless (Level 4): natural, accurate, faithful English translation with no deductions'
          ]
        },
        sentence_critique_summary: {
          type: 'choice',
          instructions: 'Identify the primary translation flaw or deduction reason in `user_translation` compared to `japanese_sentence` and `reference_translation`. If the translation is idiomatic and accurately conveys the intent (including natural nominalization of embedded clauses like "the meaning of this word" for 何を意味するのか), select no_flaws_accurate.',
          options: [
            'no_flaws_accurate',
            'wrong_benefactive_or_recipient',
            'passive_voice_reversed',
            'subject_object_inverted',
            'wrong_verb_or_action',
            'tense_or_aspect_error',
            'potential_or_modality_error',
            'interrogative_or_question_error',
            'minor_nuance_or_word_choice_difference'
          ],
          criteria: {
            no_flaws_accurate: 'Accurate, faithful, and natural translation with no notable errors (including valid synonyms, natural nominalization of embedded clauses like "the meaning of this word" for 何を意味するのか, direct translations like "thought" for 思っていた, idiomatic equivalents, conversational softeners, and minor English typos or homophones where Japanese meaning is understood).',
            wrong_benefactive_or_recipient: 'Confused the recipient or beneficiary of the action (e.g. translated ~てやってくれ as doing a favor for "me" instead of a third party/pet, or confused give/receive direction).',
            passive_voice_reversed: 'Reversed passive voice into active (e.g. "was told" translated as "I told"), where subject was receiving the action.',
            subject_object_inverted: 'Inverted the grammatical subject and object/agent in an active sentence (who did what to whom).',
            wrong_verb_or_action: 'The core verb or action was mistranslated or misunderstood.',
            tense_or_aspect_error: 'Past vs present/future tense was confused.',
            potential_or_modality_error: "Potential ('can') vs intent ('will'), or certainty vs possibility.",
            interrogative_or_question_error: 'A genuine question word or question structure was missed or changed in a way that damages the meaning.',
            minor_nuance_or_word_choice_difference: 'A genuine semantic nuance difference, dropped modifier, or awkward phrasing (do NOT select this for valid synonyms or direct translations like "thought" for 思っていた).'
          }
        },
        benefactive_direction: {
          type: 'choice',
          instructions: 'Evaluate the benefactive direction (who does what for whose benefit, e.g. ~てやる, ~てくれる, ~てもらう) in `user_translation` compared to `japanese_sentence`.',
          options: [
            'correct_benefactive_or_not_applicable',
            'recipient_reversed_self_vs_other',
            'benefactive_omitted'
          ],
          criteria: {
            correct_benefactive_or_not_applicable: 'Beneficiary and recipient are correctly understood, or sentence does not use benefactives.',
            recipient_reversed_self_vs_other: 'Translated an action for someone else / a third party / a pet (~てやる) as an action for oneself ("me"), or vice versa.',
            benefactive_omitted: 'The favor/benefactive nuance was completely dropped.'
          }
        },
        target_vocab_handling: {
          type: 'choice',
          instructions: `Evaluate specifically how the tested vocabulary word "${cleanTarget}" was translated in \`user_translation\` given its role in \`japanese_sentence\` and \`reference_translation\`. Note: Conversational sentence-ending particles/softeners (like けど/んだけど, ね, よ) soften requests or indicate polite hesitation; capturing their communicative tone naturally without a literal "but" counts as natural_accurate_sense. Idiomatic phrases (like もう in もう知らない / "I'm done with you") count as natural_accurate_sense.`,
          options: ['natural_accurate_sense', 'awkward_or_literal_misfit', 'wrong_definition_or_misinterpreted', 'omitted_or_missing'],
          criteria: {
            natural_accurate_sense: 'The target vocabulary, its idiomatic meaning, or its pragmatic conversational role is appropriately captured or naturally conveyed.',
            awkward_or_literal_misfit: 'The target vocabulary was translated with an awkward literal definition that clashes with context (e.g. "this time" for 今度 when referring to a future action).',
            wrong_definition_or_misinterpreted: 'The target vocabulary was completely mistranslated or misunderstood.',
            omitted_or_missing: 'An essential lexical word was completely omitted from the translation without pragmatic reflection.'
          }
        },
        predicate_mood_and_voice: {
          type: 'choice',
          instructions: 'Evaluate the main verb/predicate of `japanese_sentence` in `user_translation` for tense, voice (passive/active), and mood (potential "can" vs intent "will").',
          options: ['correct_or_not_applicable', 'potential_vs_intent_error', 'passive_vs_active_error', 'tense_past_present_error', 'predicate_omitted_or_wrong'],
          criteria: {
            correct_or_not_applicable: 'The predicate tense, voice, and mood are accurately translated (e.g. やりなさい -> "do it", 言われた -> "were told"), or sentence has no inflected verb.',
            potential_vs_intent_error: 'Potential form ("can / be able to") was translated as simple intent ("will") or vice versa.',
            passive_vs_active_error: 'Passive voice ("was seen", "was told") was reversed to active ("I saw", "I told") or agent/object inverted.',
            tense_past_present_error: 'Past tense translated as present/future, or vice versa.',
            predicate_omitted_or_wrong: 'The main action/verb was omitted or mistranslated.'
          }
        },
        predicate_complex_conjugation: {
          type: 'choice',
          instructions: {
            question: 'Analyze any compound, stacked, or heavily inflected predicate in `japanese_sentence` (e.g. causative-passive 〜させられる/〜される, causative-benefactive 〜させてくれる/〜させてやる, potential change-of-state 〜なくなっちゃった, conditional regret 〜なければよかった, double-negative obligation 〜ないわけにはいかない). Did `user_translation` accurately convey the full combination of forms?',
            focus: 'Identify if any layer of the stacked conjugation was inverted, misinterpreted, or dropped.'
          },
          options: [
            'accurate_or_not_stacked',
            'causative_passive_inverted',
            'causative_benefactive_inverted',
            'potential_change_of_state_missed',
            'conditional_regret_missed',
            'double_negative_obligation_inverted'
          ],
          criteria: {
            accurate_or_not_stacked: 'The combined meanings of all stacked affixes (causative, passive, tense, benefactive) are accurately conveyed, or predicate is simple.',
            causative_passive_inverted: 'Causative-passive (〜させられる / 〜される, e.g. 待たされた) was translated as active causative or simple active, inverting who was subjected to the action (e.g. "I made them wait" instead of "I was kept waiting").',
            causative_benefactive_inverted: 'Causative-benefactive (〜させてくれる / 〜させてやる, e.g. 行かせてくれた) was misunderstood regarding who granted permission or who performed the action.',
            potential_change_of_state_missed: 'Potential + change of state / regret (〜なくなっちゃった) was translated as simple past negative rather than becoming unable to do.',
            conditional_regret_missed: 'Conditional regret (〜ばよかった / 〜なければよかった) was translated as an active factual condition rather than regret ("I should have / I shouldn\'t have").',
            double_negative_obligation_inverted: 'Double negative or bound obligation pattern (〜ないわけにはいかない, 〜ざるを得ない) was translated as a negative/inability rather than an obligation ("must go / have no choice").'
          }
        },
        interrogative_check: {
          type: 'choice',
          instructions: 'If `japanese_sentence` contains a question word or interrogative clause (e.g. 何を意味するのか), was it accurately conveyed in `user_translation`? Note: Natural English nominalization (e.g. translating 何を意味するのか as "the meaning of this word" rather than literally "what this word means") accurately conveys the interrogative concept and counts as correct_or_no_interrogative.',
          options: ['correct_or_no_interrogative', 'question_word_omitted', 'wrong_question_word'],
          criteria: {
            correct_or_no_interrogative: 'The question word or interrogative clause is accurately conveyed (e.g. "いつ" -> "when", or embedded clause 何を意味するのか naturally nominalized as "the meaning of this word"), or sentence has no interrogative.',
            question_word_omitted: 'The question word was omitted, losing the interrogative concept.',
            wrong_question_word: 'A different question word was used (e.g. "where" instead of "when").'
          }
        },
        question_type_and_scope: {
          type: 'choice',
          instructions: 'Evaluate question type and pronoun scope. Did `user_translation` confuse an indefinite pronoun (e.g. 何か "something/anything", 誰か "someone", どこか "somewhere") with an open wh-question word (e.g. 何 "what", 誰 "who"), turning a yes/no question into an open-ended question?',
          options: ['correct_question_type_and_pronoun', 'confused_indefinite_with_wh_word', 'not_applicable'],
          criteria: {
            correct_question_type_and_pronoun: 'Indefinite pronouns ("something/anything") and wh-words ("what") are correctly distinguished.',
            confused_indefinite_with_wh_word: 'An indefinite pronoun like 何か (something/anything) was mistranslated as "what" (confusing 何か with 何/何を), turning a yes/no question (Are you waiting for something?) into an open question (What are you waiting for?).',
            not_applicable: 'Sentence contains no indefinite pronouns or question scope issues.'
          }
        },
        polarity_check: {
          type: 'choice',
          instructions: 'Did `user_translation` preserve the affirmative vs negative polarity of `japanese_sentence`?',
          options: ['polarity_preserved', 'polarity_inverted'],
          criteria: {
            polarity_preserved: 'Affirmative remains affirmative; negative remains negative (or idiomatic equivalent like "I\'m done with you" for もう知らない).',
            polarity_inverted: 'An affirmative statement was translated as negative, or a negative statement was translated as affirmative.'
          }
        }
      };

      const toCriteria = (arr) => Object.fromEntries(arr.map((k) => [k, null]));

      if (userWords.length > 0) {
        const typoCandidates = ['none', ...userWords.slice(0, 10)];
        questions.suspected_typo_word = {
          type: 'choice',
          instructions: 'Which word in `user_translation` is the suspected typo or keyboard slip? If there are no typos, select none.',
          options: typoCandidates,
          criteria: toCriteria(typoCandidates)
        };
      }

      if (studentChunks.length > 0 && refChunks.length > 0) {

        questions.flawed_student_excerpt = {
          type: 'choice',
          instructions: {
            question: 'Which excerpt in `student_chunks` contains the primary mistranslation, omission, or nuance divergence in `user_translation` compared to `japanese_sentence`?',
            focus: 'Pick the specific phrase chunk where the student translation diverges from the Japanese sentence.'
          },
          options: studentChunks,
          criteria: toCriteria(studentChunks)
        };

        questions.correct_reference_excerpt = {
          type: 'choice',
          instructions: {
            question: 'Which excerpt in `reference_chunks` correctly expresses that part of `japanese_sentence` in English?',
            focus: 'Pick the corresponding proper English phrase for that part of the sentence.'
          },
          options: refChunks,
          criteria: toCriteria(refChunks)
        };

        questions.contrast_relation = {
          type: 'choice',
          instructions: {
            question: 'Contrast the student excerpt with the reference excerpt.',
            focus: 'Characterize the exact difference between the student phrasing and the reference translation.'
          },
          options: [
            'passive_vs_active_reversal',
            'causative_reversal',
            'benefactive_direction_inverted',
            'potential_vs_intent',
            'obligation_vs_absence',
            'counterfactual_regret_vs_condition',
            'question_vs_statement',
            'degree_or_modifier_omitted',
            'word_choice_or_nuance_mismatch',
            'accurate_equivalent'
          ],
          criteria: {
            passive_vs_active_reversal: 'Student translated as active subject, reference is passive recipient.',
            causative_reversal: 'Student translated as active causer, reference is subjected person.',
            benefactive_direction_inverted: 'Favor direction reversed (doing favor for someone vs receiving favor).',
            potential_vs_intent: 'Potential ability/can vs future certainty/will.',
            obligation_vs_absence: 'Obligation (must do) vs absence of obligation.',
            counterfactual_regret_vs_condition: 'Counterfactual wish/regret vs literal condition.',
            question_vs_statement: 'Open question vs indefinite pronoun statement.',
            degree_or_modifier_omitted: 'A degree modifier, adverb, or softening word (e.g. そう/very, あまり/not much, ちょっと) was dropped.',
            word_choice_or_nuance_mismatch: 'Literal phrasing or nuance misfit.',
            accurate_equivalent: 'Student phrasing and reference phrasing are equivalent in meaning.'
          }
        };
      }

      const grammarCriteria = {
        correct_grammar_or_not_applicable: 'Tense, voice, aspect, and mood are correctly translated, or this word is an uninflected noun, pronoun, or particle.',
        recipient_or_beneficiary_error: 'Confused who the action is done for (e.g. translated ~てやってくれ as doing a favor for "me" instead of "him/her/the pet").',
        tense_or_aspect_error: 'Past vs present/future tense was confused, or continuous aspect was wrong.',
        voice_passive_active_error: 'Passive voice reversed to active (e.g. "was seen" -> "I saw") or subject/agent inverted.',
        modality_or_mood_error: "Grammatical mood or modality mismatch: Confused potential ('can'), intent ('will'), conditional wish ('wish I were / if only'), permission ('may'), obligation ('must'), or certainty vs possibility ('might/may')."
      };

      const senseCriteria = {
        natural_correct_sense: 'The word is translated with natural nuance, idiomatic equivalence, or contextually correct meaning (including obvious English typos or phonetic homophones like their/there).',
        awkward_or_literal_misfit: 'The translation picked a literal or secondary dictionary definition that does not fit this sentence context naturally (e.g. "this time" for 今度 instead of "next time").',
        mistranslated_or_wrong_meaning: 'The word was translated as an incorrect concept or completely wrong definition.',
        not_applicable_if_omitted: 'The word was not translated or omitted.'
      };

      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        questions['word_' + i + '_omitted'] = {
          type: 'noul',
          instructions: `Evaluate whether the core semantic concept or grammatical role of "${w}" in \`japanese_sentence\` is completely missing or unrepresented in \`user_translation\`. (If "${w}" contains a particle like は, is a sentence-ending particle like けど, or is part of an embedded clause that was naturally nominalized or paraphrased such as 何を意味するのか translated as "the meaning of...", do NOT mark as omitted if its associated concept is represented in English).`
        };
        questions['word_' + i + '_sense'] = {
          type: 'choice',
          instructions: `Evaluate the meaning, idiomatic equivalence, and nuance of "${w}" in \`user_translation\` compared to \`japanese_sentence\` and \`reference_translation\`. (Note: Set phrases like もう知らない translated as "I'm done with you", and obvious English homophones like 'their' for 'there', count as natural_correct_sense. However, confusing 何か 'something' with 'what' is mistranslated_or_wrong_meaning).`,
          options: ['natural_correct_sense', 'awkward_or_literal_misfit', 'mistranslated_or_wrong_meaning', 'not_applicable_if_omitted'],
          criteria: senseCriteria
        };
        questions['word_' + i + '_grammar'] = {
          type: 'choice',
          instructions: `Evaluate the grammatical tense, aspect, voice, mood, or benefactive direction of "${w}" in \`user_translation\`. (Note: English past-tense softening like "wanted to ask" or "I'd like to ask" for 〜てみたい / 〜たい, and imperative commands like "do it" for やりなさい, accurately convey intent).`,
          options: ['correct_grammar_or_not_applicable', 'recipient_or_beneficiary_error', 'tense_or_aspect_error', 'voice_passive_active_error', 'modality_or_mood_error'],
          criteria: grammarCriteria
        };
      }

      const body = {
        model: model,
        state: state,
        questions: questions
      };

      const res = await gmPost(url, headers, body, 15000);
      if (res.status >= 200 && res.status < 300) {
        const data = JSON.parse(res.responseText);
        if (data && data.answers) {
          const metrics = parseJevScores(data.answers, words, cleanTarget, targetText, info.sentenceEN);
          return {
            cardHtml: renderJevCard(metrics, model),
            metrics,
            elapsedMs: Date.now() - t0,
          };
        }
      } else {
        console.warn('[JPDB AI] Jev call failed with status ' + res.status + ':', res.responseText);
      }
    } catch (err) {
      console.warn('[JPDB AI] Jev call failed:', err);
    }
    return { cardHtml: '', metrics: null, elapsedMs: Date.now() - t0 };
  }

  // ---------- Vocab Explanation Fast-Path (Jev-1.13 System One) ----------

  function buildVocabExplanationQuestions(info, cleanTarget, words) {
    const meanings = (info.meanings || []).slice(0, 8);

    const meaningOptions = [];
    const meaningCriteria = {};
    meanings.forEach((m, idx) => {
      const optKey = `sense_${idx}`;
      meaningOptions.push(optKey);
      meaningCriteria[optKey] = { what: m, index: idx };
    });
    if (meaningOptions.length === 0) {
      meaningOptions.push('sense_0');
      meaningCriteria['sense_0'] = { what: 'primary dictionary meaning', index: 0 };
    }

    const questions = {
      applied_meaning: {
        type: 'choice',
        instructions: {
          question: `Which of the dictionary meanings for "${cleanTarget}" is being used in \`japanese_sentence\`?`,
          field: 'dictionary_sense'
        },
        options: meaningOptions,
        criteria: meaningCriteria
      },
      grammatical_role: {
        type: 'choice',
        instructions: `What is the primary syntactic role of "${cleanTarget}" in \`japanese_sentence\`?`,
        options: [
          'direct_object',
          'grammatical_subject',
          'topic_marker',
          'indirect_object_or_destination',
          'location_or_means',
          'noun_modifying_relative_clause',
          'main_predicate_verb',
          'connective_te_form',
          'subordinate_clause_verb',
          'adverbial_modifier',
          'particle_or_sentence_ender'
        ],
        criteria: {
          direct_object: 'The noun directly receiving the action (marked by を or topicalized).',
          grammatical_subject: 'The noun performing the action or being described (marked by が).',
          topic_marker: 'The topic or conversational framing noun (marked by は).',
          indirect_object_or_destination: 'Target, recipient, or destination of motion/action (marked by に or へ).',
          location_or_means: 'Location of action, instrument, or means (marked by で).',
          noun_modifying_relative_clause: 'Verb, adjective, or clause directly modifying a following noun (e.g. 読んだ本, 走る犬, 静かな部屋).',
          main_predicate_verb: 'The primary verb or adjective at the end of the sentence or main clause.',
          connective_te_form: 'Verb in te-form (〜て) linking sequential actions or connecting to auxiliary verbs.',
          subordinate_clause_verb: 'Verb inside an embedded clause, conditional (〜たら, 〜ば), reason (〜ので), or concession (〜のに).',
          adverbial_modifier: 'An adverb, time expression, or modifier altering the verb/adjective (e.g. ゆっくり, とても).',
          particle_or_sentence_ender: 'Colloquial particle, conversational softener, or sentence-ending expression (e.g. ね, よ, けど).'
        }
      },
      attachment_and_particles: {
        type: 'choice',
        instructions: `How does "${cleanTarget}" attach to adjacent words in \`japanese_sentence\`?`,
        options: [
          'particle_wo_object',
          'particle_ga_subject',
          'particle_wa_topic',
          'particle_ni_target',
          'particle_de_location_means',
          'particle_to_quotation_or_companion',
          'particle_no_genitive',
          'direct_noun_modification',
          'te_form_connection',
          'sentence_final'
        ],
        criteria: {
          particle_wo_object: 'Followed by object particle を.',
          particle_ga_subject: 'Followed by subject particle が.',
          particle_wa_topic: 'Followed by topic particle は.',
          particle_ni_target: 'Followed by particle に (target/location/beneficiary/time).',
          particle_de_location_means: 'Followed by particle で (location of action / means).',
          particle_to_quotation_or_companion: 'Followed by quotative or companion particle と.',
          particle_no_genitive: 'Followed by possessive/genitive particle の.',
          direct_noun_modification: 'Directly modifies a noun (attributive / 連体修飾).',
          te_form_connection: 'Connects in te-form (〜て) to an auxiliary verb.',
          sentence_final: 'Occurs at the end of the sentence or clause.'
        }
      },
      inflection_form: {
        type: 'choice',
        instructions: `What grammatical conjugation or inflection form is "${cleanTarget}" in?`,
        options: [
          'uninflected_noun_or_particle',
          'plain_present_dictionary',
          'past_ta_form',
          'te_form',
          'passive_voice',
          'potential_form',
          'causative_or_causative_passive',
          'conditional_form',
          'polite_masu_desu',
          'adverbial_form'
        ],
        criteria: {
          uninflected_noun_or_particle: 'Noun, pronoun, or invariable word.',
          plain_present_dictionary: 'Plain non-past dictionary form (e.g. 食べる, 行く, 静かだ).',
          past_ta_form: 'Plain past tense (e.g. た, だ).',
          te_form: 'Te-form (e.g. て, で).',
          passive_voice: 'Passive form (e.g. られる, れる).',
          potential_form: 'Potential form ("can do", e.g. 買える, できる).',
          causative_or_causative_passive: 'Causative (〜せる/〜させる) or Causative-Passive (〜させられる).',
          conditional_form: 'Conditional form (〜たら, 〜ば, 〜なら).',
          polite_masu_desu: 'Polite speech (〜ます, 〜です).',
          adverbial_form: 'Adverbial inflection (e.g. 〜く, 〜に).'
        }
      },
      pedagogical_tip_type: {
        type: 'choice',
        instructions: 'Which pedagogical tip or common pitfall is most relevant for a Japanese learner encountering this word in this context?',
        options: [
          'give_receive_direction',
          'passive_adversative_nuance',
          'potential_vs_intent',
          'polite_softener_not_literal_contrast',
          'colloquial_contraction',
          'idiomatic_set_phrase',
          'transitive_vs_intransitive_pair',
          'case_particle_governance',
          'standard_usage'
        ],
        criteria: {
          give_receive_direction: 'Direction of favors (~てやる vs ~てくれる vs ~てもらう).',
          passive_adversative_nuance: 'The Japanese passive often carries an adversative/troubled nuance ("suffering passive").',
          potential_vs_intent: 'Distinguishing ability ("can do"), not just future intention.',
          polite_softener_not_literal_contrast: 'Sentence-ending softeners like 〜けど or 〜んだけど soften the tone and avoid abruptness; they rarely mean a harsh "but".',
          colloquial_contraction: 'Slang or conversational contractions (e.g. 〜ちゃった, 〜じゃん).',
          idiomatic_set_phrase: 'Fixed idiomatic expression whose meaning is greater than individual parts.',
          transitive_vs_intransitive_pair: 'Pair confusion (e.g. 開ける vs 開く, 落とす vs 落ちる).',
          case_particle_governance: 'Pay attention to which particle marks this argument (を, が, に, で).',
          standard_usage: 'Standard straightforward vocabulary usage.'
        }
      }
    };

    const candidateWords = (words || [])
      .filter((w) => w && w !== cleanTarget && !cleanTarget.includes(w) && !['は', 'が', 'を', 'に', 'で', 'と', 'の'].includes(w))
      .slice(0, 6);
    if (candidateWords.length > 0) {
      const toCriteria = (arr) => Object.fromEntries(arr.map((k) => [k, null]));
      questions.connected_target_word = {
        type: 'choice',
        instructions: `Which adjacent word or predicate in \`japanese_sentence\` does "${cleanTarget}" directly modify, connect to, or govern?`,
        options: ['none_or_independent', ...candidateWords],
        criteria: toCriteria(['none_or_independent', ...candidateWords])
      };
    }

    return questions;
  }

  function generateVocabExplanation(answers, cardInfo, cleanTarget) {
    const { applied_meaning, grammatical_role, attachment_and_particles, inflection_form, pedagogical_tip_type, connected_target_word } = answers || {};

    const meanings = cardInfo.meanings || [];
    let chosenSense = meanings[0] || 'target definition';
    if (applied_meaning && applied_meaning.choice) {
      const match = applied_meaning.choice.match(/sense_(\d+)/);
      if (match && meanings[parseInt(match[1], 10)]) {
        chosenSense = meanings[parseInt(match[1], 10)];
      }
    }

    const role = grammatical_role?.choice;
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
      roleExplanation = targetWord
        ? `functioning as the direct object (marked by **を**) in the clause with **${targetWord}**`
        : `functioning as the direct object receiving the action of the verb, marked by **を**`;
    } else if (role === 'grammatical_subject') {
      roleExplanation = targetWord
        ? `functioning as the grammatical subject (marked by **が**) associated with **${targetWord}**`
        : `functioning as the grammatical subject performing or undergoing the action, marked by the identifier particle **が**`;
    } else if (role === 'topic_marker') {
      roleExplanation = `functioning as the conversational topic and contextual anchor of the sentence, framed by the topic particle **は**`;
    } else if (role === 'indirect_object_or_destination') {
      roleExplanation = targetWord
        ? `indicating the destination, target, or recipient for **${targetWord}**, marked by **に** / **へ**`
        : `indicating the target, recipient, or direction of the action, marked by **に** / **へ**`;
    } else if (role === 'location_or_means') {
      roleExplanation = targetWord
        ? `specifying the location, means, or instrument where **${targetWord}** takes place, marked by **で**`
        : `specifying the location of the action or the means used, marked by **で**`;
    } else if (role === 'noun_modifying_relative_clause') {
      roleExplanation = targetWord
        ? `functioning as an attributive modifier directly describing the noun **${targetWord}**`
        : `functioning as an attributive / relative clause directly modifying the following noun`;
    } else if (role === 'adverbial_modifier') {
      roleExplanation = targetWord
        ? `functioning as an adverbial modifier modifying the predicate **${targetWord}**`
        : `functioning as an adverbial modifier describing manner, degree, or time`;
    } else if (role === 'connective_te_form') {
      roleExplanation = targetWord
        ? `is in the connective 〜て form, chaining this action into **${targetWord}**`
        : `is in the connective 〜て form, linking sequential actions or attaching to an auxiliary verb`;
    } else if (role === 'subordinate_clause_verb') {
      roleExplanation = `functioning as the verb within an embedded, conditional, or subordinate clause`;
    } else if (role === 'particle_or_sentence_ender') {
      roleExplanation = `functions as a conversational particle or sentence-ending expression providing pragmatic nuance`;
    } else {
      roleExplanation = `serving as the main predicate verb of the sentence${inflectionText}`;
    }

    const tipsMap = {
      give_receive_direction: 'Pay attention to favor direction: 〜てやる is done for someone younger, a pet, or third party; 〜てくれる is done for the speaker ("for me"); 〜てもらう is receiving a favor.',
      passive_adversative_nuance: 'In Japanese, the passive voice often expresses that the subject was negatively affected or troubled by someone else\'s action (the "adversative" or suffering passive).',
      potential_vs_intent: 'Potential forms express capability or opportunity ("can do"), not just future intention.',
      polite_softener_not_literal_contrast: 'Sentence-ending softeners like 〜けど or 〜んだけど soften the tone and avoid abruptness; they rarely mean a harsh "but".',
      colloquial_contraction: 'Note the conversational contraction used here in casual speech.',
      idiomatic_set_phrase: 'This is part of a common Japanese idiomatic set phrase.',
      transitive_vs_intransitive_pair: 'Watch the transitive/intransitive pair: pay close attention to whether the subject performs the action or undergoes it.',
      case_particle_governance: 'Pay close attention to which particle marks this word (を for direct object, が for subject, に for target, で for location/means).',
      standard_usage: 'Focus on how the attached particle or inflection connects this word to the main predicate.'
    };

    const nuanceTip = tipsMap[tip] || 'Focus on how the attached particle or inflection connects this word to the main predicate.';

    let cleanSense = chosenSense.replace(/^\d+[\.\)]\s*/, '').trim();
    const semiParts = cleanSense.split(';');
    if (semiParts.length > 1) {
      cleanSense = semiParts.slice(0, 2).join(';').trim();
    }

    const lines = [
      `### Role of **${cleanTarget}** in this Sentence\n`,
      `In this sentence, **${cleanTarget}** means **"${cleanSense}"**, ${roleExplanation}.\n`,
      `💡 **Key Nuance:** ${nuanceTip}`
    ];

    return {
      markdown: lines.join('\n'),
      role: role || 'main_predicate_verb',
      chosenSense: cleanSense,
      targetWord
    };
  }

  function renderJevVocabCard(vocabResult, modelName, words, cleanTarget) {
    if (!vocabResult) return '';
    const tag = modelName || CFG.jevModel || DEFAULT_JEV_MODEL;
    const roleLabel = (vocabResult.role || 'vocab role').replace(/_/g, ' ');

    return `
      <details class="jpdb-ai-jev-card" open>
        <summary class="jpdb-ai-jev-head" title="Click to collapse/expand breakdown">
          <span class="jpdb-ai-jev-title">⚡ Instant Vocab Explainer <span class="jpdb-ai-jev-tag">${escapeHtml(tag)}</span></span>
          <span class="jpdb-ai-jev-score ok" style="background:#2b2250;color:#c4b5fd;border:1px solid #6366f1;text-transform:capitalize;">${escapeHtml(roleLabel)}</span>
        </summary>
        <div class="jpdb-ai-jev-body">
          <div style="font-size:12px;margin-bottom:4px;">
            <strong>Applied Sense:</strong> "${escapeHtml(vocabResult.chosenSense)}"
          </div>
          ${vocabResult.targetWord ? `
            <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">
              <strong>Connected With:</strong> ${escapeHtml(vocabResult.targetWord)}
            </div>
          ` : ''}
          ${words && words.length > 0 ? `
            <div class="jpdb-ai-jev-tokens">
              ${words.map((w) => {
                const isTarget = w === cleanTarget || w.includes(cleanTarget) || cleanTarget.includes(w);
                const isConn = vocabResult.targetWord && (w === vocabResult.targetWord || w.includes(vocabResult.targetWord));
                const cls = isTarget ? 'err' : (isConn ? 'advisory' : 'ok');
                return `<span class="jpdb-ai-jev-token ${cls}">${escapeHtml(w)}</span>`;
              }).join(' ')}
            </div>
          ` : ''}
        </div>
      </details>
    `.trim();
  }

  async function callJevVocabExplanation(info) {
    const t0 = Date.now();
    try {
      const conn = getJevConnection();
      const cleanJp = (info.sentenceJP || '').replace(/\([^)]*\)/g, '').trim();
      const cleanTarget = (info.vocab || '').replace(/\([^)]*\)/g, '').trim();
      const words = getJapaneseSentenceWords(info.sentenceJP, info.vocab);

      const state = {
        japanese_sentence: cleanJp || info.sentenceJP || '',
        target_vocabulary: cleanTarget || info.vocab || '',
        target_meanings: (info.meanings || []).slice(0, 8),
        reference_translation: info.sentenceEN || '',
        words: words
      };

      const questions = buildVocabExplanationQuestions(info, cleanTarget, words);
      const body = {
        model: conn.model,
        state: state,
        questions: questions
      };

      const res = await gmPost(conn.url, conn.headers, body, 15000);
      if (res.status >= 200 && res.status < 300) {
        const data = JSON.parse(res.responseText);
        if (data && data.answers) {
          const gen = generateVocabExplanation(data.answers, info, cleanTarget);
          const roleConf = data.answers.grammatical_role?.confidence ?? 0.8;
          const senseConf = data.answers.applied_meaning?.confidence ?? 0.8;
          const isFastPath = roleConf >= 0.40 && senseConf >= 0.40 && !!gen.role;
          return {
            cardHtml: renderJevVocabCard(gen, conn.model, words, cleanTarget),
            markdown: gen.markdown,
            role: gen.role,
            isFastPath,
            elapsedMs: Date.now() - t0,
            answers: data.answers
          };
        }
      } else {
        console.warn('[JPDB AI] Jev vocab explanation call failed with status ' + res.status + ':', res.responseText);
      }
    } catch (err) {
      console.warn('[JPDB AI] Jev vocab explanation call failed:', err);
    }
    return { cardHtml: '', markdown: '', role: null, isFastPath: false, elapsedMs: Date.now() - t0 };
  }

  // ---------- Translation Rating Diagnostics & Divergence Tracking ----------
  function extractLlmScore(text) {
    if (!text) return null;
    const m1 = text.match(/(?:Score|Rating):\s*\*\*(\d+(?:\.\d+)?)\s*\/\s*10\*\*/i);
    if (m1) return parseFloat(m1[1]);
    const m2 = text.match(/\*\*(?:Score|Rating):\s*(\d+(?:\.\d+)?)\s*\/\s*10\*\*/i);
    if (m2) return parseFloat(m2[1]);
    const m3 = text.match(/\b(\d+(?:\.\d+)?)\s*\/\s*10\b/);
    if (m3) return parseFloat(m3[1]);
    return null;
  }

  const DIAG_STORAGE_KEY = 'jpdb_ai_diagnostics_log';
  let diagFilterDivergent = false;

  function getDiagnosticsLog() {
    try {
      const raw = GM_getValue(DIAG_STORAGE_KEY, '[]');
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveDiagnosticsLog(list) {
    try {
      GM_setValue(DIAG_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('[JPDB AI] Failed to save diagnostics log:', e);
    }
  }

  function updateDiagFooterLink() {
    const link = document.getElementById('jpdb-ai-diag-link');
    if (!link) return;
    const list = getDiagnosticsLog();
    const isFull = list.length >= 200;
    if (isFull) {
      link.innerHTML = `Diag (${list.length} <span style="color:#d97706;font-weight:700" title="Buffer full (200/200). Oldest entries will roll over.">⚠️</span>)`;
      link.title = `200 translation evaluations recorded (buffer full; oldest entries will roll over). Click to inspect.`;
    } else {
      link.textContent = `Diag (${list.length})`;
      link.title = `${list.length} translation evaluations recorded. Click to inspect.`;
    }
  }

  function toggleDiagView(forceOpen) {
    const diagView = document.getElementById('jpdb-ai-diag-view');
    const settingsView = document.getElementById('jpdb-ai-settings-view');
    const msgsBox = document.getElementById('jpdb-ai-msgs');
    const btnsBox = document.getElementById('jpdb-ai-btns');
    const rowBox = document.getElementById('jpdb-ai-row');
    if (!diagView || !msgsBox) return;

    const shouldShow = forceOpen !== undefined ? forceOpen : (diagView.style.display !== 'flex');
    if (shouldShow) {
      if (settingsView) settingsView.style.display = 'none';
      diagView.style.display = 'flex';
      msgsBox.style.display = 'none';
      if (btnsBox) btnsBox.style.display = 'none';
      if (rowBox) rowBox.style.display = 'none';
      renderDiagList();
    } else {
      diagView.style.display = 'none';
      if (!settingsView || settingsView.style.display !== 'flex') {
        msgsBox.style.display = 'flex';
        if (btnsBox) btnsBox.style.display = 'flex';
        if (rowBox) rowBox.style.display = 'flex';
        msgsBox.scrollTop = msgsBox.scrollHeight;
      }
    }
  }

  function loadSettingsToUI() {
    const baseEl = document.getElementById('jpdb-ai-cfg-llm-base');
    const modelEl = document.getElementById('jpdb-ai-cfg-llm-model');
    const keyEl = document.getElementById('jpdb-ai-cfg-llm-key');
    const jevEndpointEl = document.getElementById('jpdb-ai-cfg-jev-endpoint');
    const jevModelEl = document.getElementById('jpdb-ai-cfg-jev-model');
    const jevKeyEl = document.getElementById('jpdb-ai-cfg-jev-key');
    const invertEl = document.getElementById('jpdb-ai-cfg-invert-enter');

    if (baseEl) baseEl.value = CFG.base;
    if (modelEl) modelEl.value = CFG.model;
    if (keyEl) keyEl.value = CFG.key;
    if (jevEndpointEl) jevEndpointEl.value = CFG.jevEndpoint;
    if (jevModelEl) jevModelEl.value = CFG.jevModel;
    if (jevKeyEl) jevKeyEl.value = CFG.jevKey;
    if (invertEl) invertEl.checked = CFG.invertEnter;
  }

  function toggleSettingsView(forceOpen) {
    const settingsView = document.getElementById('jpdb-ai-settings-view');
    const diagView = document.getElementById('jpdb-ai-diag-view');
    const msgsBox = document.getElementById('jpdb-ai-msgs');
    const btnsBox = document.getElementById('jpdb-ai-btns');
    const rowBox = document.getElementById('jpdb-ai-row');
    if (!settingsView || !msgsBox) return;

    const shouldShow = forceOpen !== undefined ? forceOpen : (settingsView.style.display !== 'flex');
    if (shouldShow) {
      if (diagView) diagView.style.display = 'none';
      settingsView.style.display = 'flex';
      msgsBox.style.display = 'none';
      if (btnsBox) btnsBox.style.display = 'none';
      if (rowBox) rowBox.style.display = 'none';
      loadSettingsToUI();
    } else {
      settingsView.style.display = 'none';
      if (!diagView || diagView.style.display !== 'flex') {
        msgsBox.style.display = 'flex';
        if (btnsBox) btnsBox.style.display = 'flex';
        if (rowBox) rowBox.style.display = 'flex';
        msgsBox.scrollTop = msgsBox.scrollHeight;
      }
    }
  }

  function renderDiagList() {
    const listEl = document.getElementById('jpdb-ai-diag-list');
    const statEl = document.getElementById('jpdb-ai-diag-stat');
    const filterBtn = document.getElementById('jpdb-ai-diag-filter');
    if (!listEl) return;

    const list = getDiagnosticsLog();
    const divCount = list.filter((e) => e.divergence?.diverged).length;
    const isFull = list.length >= 200;
    if (statEl) {
      statEl.innerHTML = isFull
        ? `${list.length}/200 (<span style="color:#d97706;font-weight:700">full ⚠️</span>), ${divCount} divergent`
        : `${list.length} total, ${divCount} divergent`;
    }
    if (filterBtn) {
      filterBtn.textContent = diagFilterDivergent ? 'Filter: Divergent' : 'Filter: All';
    }

    const displayed = diagFilterDivergent ? list.filter((e) => e.divergence?.diverged) : list;
    if (displayed.length === 0) {
      listEl.innerHTML = `<div style="text-align:center;padding:24px 10px;opacity:.6;font-size:12px">No ${diagFilterDivergent ? 'divergent ' : ''}diagnostics recorded yet. Rate translations to collect data!</div>`;
      return;
    }

    listEl.innerHTML = displayed.map((item) => {
      const isDiv = !!item.divergence?.diverged;
      const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      const jevScore = typeof item.jev?.overall === 'number' ? `${item.jev.overall}/10` : (item.jev?.badge || '?');
      const jevBadgeClass = item.jev?.overall === 10 ? 'high' : (item.jev?.overall >= 7 ? 'med' : 'low');
      const llmScoreVal = item.llm?.elapsedMs === 0 ? '10/10 (⚡ skipped)' : (typeof item.llm?.score === 'number' ? `${item.llm.score}/10` : '?');
      const divTag = isDiv ? `<span class="jpdb-ai-diag-badge-div" title="${escapeHtml(item.divergence?.reason || '')}">Δ ${item.divergence?.scoreDiff ?? '?'} pts</span>` : '';

      const mistakesList = (function() {
        const issues = (item.jev?.mistakes && item.jev.mistakes.length > 0)
          ? `<div style="margin-top:4px;font-size:11px"><strong>Issues:</strong> ${item.jev.mistakes.map((m) => `<span style="background:rgba(239,68,68,.1);color:#b91c1c;padding:1px 5px;border-radius:3px;margin-right:4px">${escapeHtml(m.word)} (${escapeHtml((m.type || '').replace(/_/g, ' '))})</span>`).join('')}</div>`
          : '';
        const advisories = (item.jev?.advisories && item.jev.advisories.length > 0)
          ? `<div style="margin-top:4px;font-size:11px"><strong>Nuance:</strong> ${item.jev.advisories.map((a) => `<span style="background:rgba(217,119,6,.1);color:#b45309;padding:1px 5px;border-radius:3px;margin-right:4px">${escapeHtml(a.word)} (${escapeHtml((a.type || '').replace(/_/g, ' '))})</span>`).join('')}</div>`
          : '';
        if (issues || advisories) return issues + advisories;
        return item.jev ? `<div style="margin-top:4px;font-size:11px;color:#15803d;font-weight:600">✓ Flawless (no issues detected)</div>` : '';
      })();

      const itemId = item.id || ('diag_' + (item.timestamp || ''));
      return `
        <div class="jpdb-ai-diag-item ${isDiv ? 'diverged' : ''}" data-id="${escapeHtml(itemId)}">
          <div class="jpdb-ai-diag-item-top">
            <span style="font-weight:700;color:#2563eb">${escapeHtml(item.card?.vocab || 'Card')}</span>
            <div style="display:flex;align-items:center;gap:4px">
              ${divTag}
              <span class="jpdb-ai-diag-time">${escapeHtml(timeStr)}</span>
              <button type="button" class="jpdb-ai-diag-btn-action jpdb-ai-diag-btn-copy" data-id="${escapeHtml(itemId)}" title="Copy diagnostic JSON to clipboard">📋 Copy</button>
              <button type="button" class="jpdb-ai-diag-btn-action jpdb-ai-diag-btn-dl" data-id="${escapeHtml(itemId)}" title="Download diagnostic JSON file">💾 JSON</button>
            </div>
          </div>
          <div style="margin-bottom:3px"><strong>JP:</strong> ${escapeHtml(item.card?.sentenceJP || '(none)')}</div>
          <div style="margin-bottom:6px"><strong>Input:</strong> "${escapeHtml(item.input?.targetEvaluated || '')}"</div>
          
          <div class="jpdb-ai-diag-scores">
            <span title="Jev latency: ${item.jev?.elapsedMs || 0}ms">⚡ Jev: <b class="jpdb-ai-jev-score ${jevBadgeClass}" style="display:inline-block;padding:1px 7px;font-size:10.5px">${jevScore}</b></span>
            <span>·</span>
            <span title="LLM latency: ${item.llm?.elapsedMs || 0}ms">🤖 LLM: <b>${llmScoreVal}</b></span>
          </div>

          ${mistakesList}

          <details class="jpdb-ai-diag-details">
            <summary>${item.llm?.elapsedMs === 0 ? 'View Assessment Details (⚡ Fast-Pass)' : 'View LLM Reasoning & Critique'}</summary>
            <div class="jpdb-ai-diag-critique">${escapeHtml(item.llm?.text || '(no text)')}</div>
          </details>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.jpdb-ai-diag-btn-copy').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const entry = getDiagnosticsLog().find((x) => (x.id || ('diag_' + (x.timestamp || ''))) === id);
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
        const entry = getDiagnosticsLog().find((x) => (x.id || ('diag_' + (x.timestamp || ''))) === id);
        if (!entry) return;
        downloadSpecificDiagnostic(entry);
        const orig = btn.textContent;
        btn.textContent = '✓ Saved!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    });
  }

  function recordDiagnosticEntry(info, userDraft, jevMetrics, jevElapsedMs, llmReply, llmScore, llmElapsedMs) {
    try {
      const list = getDiagnosticsLog();
      const entryId = 'diag_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

      let scoreDiff = null;
      let diverged = false;
      let divergenceReason = '';

      if (jevMetrics && typeof llmScore === 'number' && typeof jevMetrics.overall === 'number') {
        scoreDiff = Number(Math.abs(jevMetrics.overall - llmScore).toFixed(1));
        const jevTier = jevMetrics.overall >= 7 ? 'Good' : (jevMetrics.overall >= 5 ? 'Borderline' : 'Needs Work');
        const llmTier = llmScore >= 7.0 ? 'Good' : (llmScore >= 4.0 ? 'Borderline' : 'Needs Work');

        if (scoreDiff >= 2.0) {
          diverged = true;
          divergenceReason = `Score gap of ${scoreDiff} pts (Jev: ${jevMetrics.overall}/10 vs LLM: ${llmScore}/10)`;
        } else if (jevTier !== llmTier && ((jevTier === 'Good' && llmScore <= 4.0) || (jevTier === 'Needs Work' && llmScore >= 7.0))) {
          diverged = true;
          divergenceReason = `Tier mismatch: Jev rated "${jevTier}" (${jevMetrics.overall}/10) while LLM scored ${llmScore}/10 ("${llmTier}")`;
        }
      }

      const entry = {
        id: entryId,
        timestamp: new Date().toISOString(),
        card: {
          token: getCardToken(),
          vocab: info.vocab || '',
          meanings: (info.meanings || []).slice(0, 3),
          sentenceJP: info.sentenceJP || '',
          sentenceEN: info.sentenceEN || '',
        },
        input: {
          userDraft: userDraft || '',
          isUserTranslation: !!userDraft,
          targetEvaluated: userDraft || info.sentenceEN || '',
        },
        jev: jevMetrics ? {
          model: CFG.jevModel || DEFAULT_JEV_MODEL,
          elapsedMs: jevElapsedMs,
          overall: jevMetrics.overall,
          badge: jevMetrics.scoreLabel,
          mistakes: jevMetrics.mistakes || [],
          advisories: jevMetrics.advisories || [],
          bracket: jevMetrics.bracket,
          severityScore: jevMetrics.severityScore,
          isFlawlessProb: jevMetrics.isFlawlessProb,
          words: jevMetrics.words,
          answers: jevMetrics.rawAnswers,
        } : null,
        llm: {
          model: CFG.model,
          elapsedMs: llmElapsedMs,
          score: llmScore,
          text: llmReply,
        },
        divergence: {
          diverged,
          scoreDiff,
          reason: divergenceReason,
          higher: jevMetrics && typeof llmScore === 'number' ? (jevMetrics.overall > llmScore ? 'jev' : (llmScore > jevMetrics.overall ? 'llm' : 'equal')) : null,
        }
      };

      list.unshift(entry);
      if (list.length > 200) list.length = 200;
      saveDiagnosticsLog(list);
      updateDiagFooterLink();
      const diagView = document.getElementById('jpdb-ai-diag-view');
      if (diagView && diagView.style.display === 'flex') {
        renderDiagList();
      }
      return entry;
    } catch (err) {
      console.warn('[JPDB AI] Failed to record diagnostic entry:', err);
      return null;
    }
  }

  function downloadSpecificDiagnostic(entry) {
    if (!entry) return;
    const json = JSON.stringify(entry, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const dlAnchor = document.createElement('a');
    dlAnchor.href = url;
    const vocabSafe = (entry.card?.vocab || 'item').replace(/[^a-zA-Z0-9_\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g, '_');
    const timeSafe = (entry.timestamp || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19);
    dlAnchor.download = `jpdb_diag_${vocabSafe}_${timeSafe}.json`;
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportDiagnosticsJson() {
    const list = getDiagnosticsLog();
    const json = JSON.stringify(list, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const dlAnchor = document.createElement('a');
    dlAnchor.href = url;
    dlAnchor.download = `jpdb_ai_translation_diagnostics_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSettingsJson() {
    const baseInput = document.getElementById('jpdb-ai-cfg-llm-base');
    const modelInput = document.getElementById('jpdb-ai-cfg-llm-model');
    const keyInput = document.getElementById('jpdb-ai-cfg-llm-key');
    const jevEndpointInput = document.getElementById('jpdb-ai-cfg-jev-endpoint');
    const jevModelInput = document.getElementById('jpdb-ai-cfg-jev-model');
    const jevKeyInput = document.getElementById('jpdb-ai-cfg-jev-key');
    const invertInput = document.getElementById('jpdb-ai-cfg-invert-enter');

    const settings = {
      base: baseInput ? baseInput.value : CFG.base,
      model: modelInput ? modelInput.value : CFG.model,
      key: keyInput ? keyInput.value : CFG.key,
      jevEndpoint: jevEndpointInput ? jevEndpointInput.value : CFG.jevEndpoint,
      jevModel: jevModelInput ? jevModelInput.value : CFG.jevModel,
      jevKey: jevKeyInput ? jevKeyInput.value : CFG.jevKey,
      invertEnter: invertInput ? invertInput.checked : CFG.invertEnter,
      exportedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(settings, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const dlAnchor = document.createElement('a');
    dlAnchor.href = url;
    dlAnchor.download = `jpdb_ai_settings_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function triggerImportSettings() {
    const fileInput = document.getElementById('jpdb-ai-settings-file');
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  }

  function handleSettingsFileSelect(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result;
        const obj = JSON.parse(text);
        applyImportedSettings(obj);
      } catch (err) {
        alert('Failed to parse settings JSON: ' + (err.message || err));
      }
    };
    reader.readAsText(file);
  }

  function applyImportedSettings(obj) {
    if (!obj || typeof obj !== 'object') {
      alert('Invalid JSON file format.');
      return;
    }
    const baseVal = obj.base ?? obj.jpdb_ai_base ?? obj.llmBase ?? obj.endpoint;
    const modelVal = obj.model ?? obj.jpdb_ai_model ?? obj.llmModel;
    const keyVal = obj.key ?? obj.jpdb_ai_key ?? obj.llmKey ?? obj.apiKey;

    const jevEndpointVal = obj.jevEndpoint ?? obj.jpdb_ai_jev_endpoint;
    const jevModelVal = obj.jevModel ?? obj.jpdb_ai_jev_model;
    const jevKeyVal = obj.jevKey ?? obj.jpdb_ai_jev_key;

    const invertVal = obj.invertEnter ?? obj.jpdb_ai_invert_enter;

    if (baseVal !== undefined) CFG.base = baseVal;
    if (modelVal !== undefined) CFG.model = modelVal;
    if (keyVal !== undefined) CFG.key = keyVal;
    if (jevEndpointVal !== undefined) CFG.jevEndpoint = jevEndpointVal;
    if (jevModelVal !== undefined) CFG.jevModel = jevModelVal;
    if (jevKeyVal !== undefined) CFG.jevKey = jevKeyVal;
    if (invertVal !== undefined) CFG.invertEnter = !!invertVal;

    loadSettingsToUI();
    updateFoot();
    updateShortcutsUI();

    const statusEl = document.getElementById('jpdb-ai-settings-status');
    if (statusEl) {
      statusEl.textContent = 'Settings imported & saved!';
      statusEl.style.display = 'inline';
      setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 2500);
    }
  }



  // Expose diagnostic tools to unsafeWindow / DevTools
  try {
    const targetWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    targetWin.__jpdbAiDiagnostics = {
      get: getDiagnosticsLog,
      getDivergent: () => getDiagnosticsLog().filter((e) => e.divergence?.diverged),
      export: exportDiagnosticsJson,
      clear: () => {
        saveDiagnosticsLog([]);
        updateDiagFooterLink();
        renderDiagList();
      },
      downloadOne: downloadSpecificDiagnostic,
      parseJevScores: parseJevScores,
      extractPhraseChunks: extractPhraseChunks,
      renderJevCard: renderJevCard
    };
    targetWin.__jpdbAiExportSettings = exportSettingsJson;
    targetWin.__jpdbAiImportSettings = applyImportedSettings;
  } catch {}

  function buildRateTranslationPrompt(info, userDraft) {
    const lines = [];
    lines.push(`Japanese sentence: ${info.sentenceJP || '(no sentence)'}`);
    if (info.vocab) lines.push(`Key vocab: ${info.vocab}${info.meanings && info.meanings.length ? ' (' + info.meanings.slice(0, 3).join('; ') + ')' : ''}`);
    if (info.sentenceEN) lines.push(`Card's English translation: ${info.sentenceEN}`);

    if (userDraft) {
      lines.push(`\nStudent's proposed translation: "${userDraft}"`);
      lines.push(`\nPlease evaluate the student's translation:`);
      lines.push(`1. Score/rating out of 10 based strictly on Japanese comprehension (meaning, tense, particles, nuance, and intent).`);
      lines.push(`SCORING SCALE & ANCHORS:`);
      lines.push(`- 10/10 (Flawless): Accurate meaning, correct tense/aspect, faithful nuance. (Ignore punctuation, apostrophes like cant vs can't, or capitalization). CRITICAL RULES FOR 10/10:
  * If there are no actual semantic errors, omissions, or mistranslations, you MUST award 10/10.
  * Do NOT penalize or deduct points for valid alternative interpretations, natural conversational phrasing, or stylistic synonyms (e.g. 〜たら can validly mean "if" or "when"; あなたに話す can validly mean "speak to you" or "tell you"; sentence-ending softeners like 〜んだけど need not be translated as a literal "but"; idiomatic phrases like もう知らない translated as "I'm done with you" are 10/10).
  * Do NOT withhold 10/10 merely because you prefer a different synonym or slightly more idiomatic alternative in your own preferred translation.`);
      lines.push(`- 7-9 (Pass/Good): Core meaning correct, but has an actual semantic error, missed clause/modifier, noticeable tone mismatch, or secondary detail dropped.`);
      lines.push(`- 4-6 (Borderline/Partial): Partially understood, but missed a key clause, translated the wrong sense of a core word, or omitted a major element.`);
      lines.push(`- 0-3 (Fail/Critical Error): Fatal comprehension failure. A translation that inverts negation/polarity (e.g. translating negative conditional "don't want to" as positive "want to"), reverses the subject/agent (who did what to whom), or conveys the opposite/unrelated meaning MUST receive 0-3/10.`);
      lines.push(`FEEDBACK ORDER & STRUCTURE:`);
      lines.push(`- For any score other than 10/10, you MUST lead with the criticism first: immediately state what was wrong, missing, or why points were deducted BEFORE mentioning what was done right. If there is nothing to criticize, the score MUST be 10/10.`);
      lines.push(`- Point out any subtle Japanese grammar nuances, omitted elements, or tone/formality differences.`);
      lines.push(`- Provide the best natural English translation and/or literal translation.`);
    } else {
      lines.push(`\nPlease evaluate the card's English translation against the Japanese sentence:`);
      lines.push(`1. Score/rating (out of 10) for accuracy and naturalness.`);
      lines.push(`2. How accurately does it capture the sentence's grammatical nuances, colloquial tone, and implied context?`);
      lines.push(`3. Point out any compromises, omitted elements, or overly free translations.`);
      lines.push(`4. Provide a refined or alternative translation if applicable.`);
    }
    lines.push(`Keep the feedback concise, clear, and informative.`);
    return lines.join('\n');
  }

  // ---------- UI Style ----------
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
.jpdb-ai-jev-nuance-note{font-size:12px;font-weight:600;color:#d97706;display:flex;align-items:center;gap:6px;margin:2px 0 6px}
html.dark-mode .jpdb-ai-jev-nuance-note{color:#fbbf24}
.jpdb-ai-jev-check{font-size:13px;font-weight:800}
.jpdb-ai-jev-info-icon{font-size:13px}
.jpdb-ai-jev-advisories{font-size:12px}
.jpdb-ai-jev-advisories-title{font-size:11px;font-weight:700;color:#d97706;margin-bottom:4px;text-transform:uppercase;letter-spacing:.03em}
html.dark-mode .jpdb-ai-jev-advisories-title{color:#fbbf24}
.jpdb-ai-jev-advisories-list{margin:0;padding-left:18px;list-style-type:disc}
.jpdb-ai-jev-advisories-list li{margin:3px 0;font-size:12px;line-height:1.4}
.jpdb-ai-jev-word.advisory{font-weight:700;color:#b45309;background:rgba(217,119,6,.12);padding:1px 6px;border-radius:4px}
html.dark-mode .jpdb-ai-jev-word.advisory{color:#fde68a;background:rgba(217,119,6,.25)}
.jpdb-ai-jev-token.advisory{background:rgba(217,119,6,.12);color:#b45309;font-weight:600}
html.dark-mode .jpdb-ai-jev-token.advisory{background:rgba(217,119,6,.25);color:#fde68a}
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
.jpdb-ai-jev-waiting{margin-top:10px;font-size:11.5px;opacity:.75;font-style:italic;display:flex;align-items:center;gap:5px}
.jpdb-ai-jev-excerpt{display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 10px;background:rgba(0,0,0,.03);border-radius:6px;border:1px solid rgba(0,0,0,.06);font-size:12px;flex-wrap:wrap}
html.dark-mode .jpdb-ai-jev-excerpt{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.1)}
.jpdb-ai-jev-pill{display:inline-block;padding:2px 8px;border-radius:6px;font-weight:600;font-size:11.5px;line-height:1.4}
.jpdb-ai-jev-pill.err{background:rgba(239,68,68,.15);color:#b91c1c;border:1px solid rgba(239,68,68,.3)}
html.dark-mode .jpdb-ai-jev-pill.err{background:rgba(239,68,68,.25);color:#fca5a5;border-color:rgba(239,68,68,.4)}
.jpdb-ai-jev-pill.ok{background:rgba(22,163,74,.15);color:#15803d;border:1px solid rgba(22,163,74,.3)}
html.dark-mode .jpdb-ai-jev-pill.ok{background:rgba(22,163,74,.25);color:#86efac;border-color:rgba(22,163,74,.4)}
.jpdb-ai-jev-arrow{color:#6b7280;font-weight:700;font-size:12px}
html.dark-mode .jpdb-ai-jev-arrow{color:#9ca3af}

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
  #jpdb-ai-model{max-width:48%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block}
  .jpdb-ai-foot-links{flex-shrink:0;gap:4px}
  .jpdb-ai-jev-card{padding:8px 10px;font-size:12px}
  .jpdb-ai-diag-head{flex-direction:column;align-items:flex-start;gap:6px}
  .jpdb-ai-diag-actions{width:100%;justify-content:flex-end}
}

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
.jpdb-ai-diag-item.diverged{border-color:rgba(37,99,235,.25);background:rgba(37,99,235,.03)}
html.dark-mode .jpdb-ai-diag-item.diverged{border-color:rgba(147,197,253,.25);background:rgba(37,99,235,.07)}
.jpdb-ai-diag-item-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.jpdb-ai-diag-time{opacity:.6;font-size:10.5px}
.jpdb-ai-diag-btn-action{padding:1px 6px;font-size:10px;font-weight:600;border-radius:4px;border:1px solid #d1d5db;background:#fff;color:#374151!important;cursor:pointer;line-height:1.2;transition:all .15s}
.jpdb-ai-diag-btn-action:hover{background:#eff6ff;color:#1d4ed8!important;border-color:#3b82f6}
html.dark-mode .jpdb-ai-diag-btn-action{background:#2a2a2a;color:#d1d5db!important;border-color:#555}
html.dark-mode .jpdb-ai-diag-btn-action:hover{background:#1e3a5f;color:#93c5fd!important;border-color:#60a5fa}
.jpdb-ai-diag-badge-div{font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px;background:rgba(37,99,235,.1);color:#1d4ed8;border:1px solid rgba(37,99,235,.25)}
html.dark-mode .jpdb-ai-diag-badge-div{background:rgba(59,130,246,.15);color:#93c5fd;border-color:rgba(59,130,246,.3)}
.jpdb-ai-diag-scores{display:flex;align-items:center;gap:8px;margin:5px 0;font-weight:600;font-size:12px}
.jpdb-ai-diag-subscores{display:flex;flex-wrap:wrap;gap:4px 6px;font-size:10.5px;opacity:.85;margin-bottom:6px}
.jpdb-ai-diag-subscores span{background:rgba(0,0,0,.05);padding:1px 5px;border-radius:3px}
html.dark-mode .jpdb-ai-diag-subscores span{background:rgba(255,255,255,.1)}
.jpdb-ai-diag-details{margin-top:6px;font-size:11.5px}
.jpdb-ai-diag-details summary{cursor:pointer;font-weight:600;opacity:.85;user-select:none;color:#2563eb}
html.dark-mode .jpdb-ai-diag-details summary{color:#93c5fd}
.jpdb-ai-diag-critique{margin-top:4px;padding:7px;background:rgba(0,0,0,.04);border-radius:5px;max-height:160px;overflow:auto;white-space:pre-wrap;font-size:11px;line-height:1.4}
html.dark-mode .jpdb-ai-diag-critique{background:rgba(0,0,0,.35)}

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
`;

  function injectStyle() {
    if (document.getElementById('jpdb-ai-style')) return;
    const s = document.createElement('style');
    s.id = 'jpdb-ai-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // ---------- Session Persistence (retains chat + typed draft across Show Answer) ----------
  const SESSION_KEY = 'jpdb_ai_chat_session';
  let history = []; // [{role, content}] LLM context
  let msgLog = []; // [{role, text, isErr}] displayed messages
  let panelOpen = false;
  let currentSessionToken = '';
  let draftInput = '';
  let busy = false;

  function saveSession() {
    try {
      const token = getCardToken();
      if (!token) return;
      const inputEl = document.getElementById('jpdb-ai-input');
      const data = {
        token,
        history,
        msgLog,
        panelOpen: isPanelOpen(),
        draftInput: inputEl ? inputEl.value : draftInput,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[JPDB AI] Failed to save session:', e);
    }
  }

  function initSession() {
    const token = getCardToken();
    currentSessionToken = token;
    let saved = null;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {}

    if (saved && saved.token === token) {
      // Same review item! (e.g. Question -> Show Answer transition, or page reload on same card)
      history = Array.isArray(saved.history) ? saved.history : [];
      msgLog = Array.isArray(saved.msgLog) ? saved.msgLog : [];
      panelOpen = !!saved.panelOpen;
      draftInput = typeof saved.draftInput === 'string' ? saved.draftInput : '';
    } else {
      // Moved to next word / new card!
      history = [];
      msgLog = [];
      draftInput = '';
      panelOpen = false; // automatically close chat on new word so front of card is visible
      const panel = document.getElementById('jpdb-ai-panel');
      if (panel) panel.style.display = 'none';
      const inputEl = document.getElementById('jpdb-ai-input');
      if (inputEl) inputEl.value = '';
      syncFab();
      saveSession();
    }
  }

  // ---------- Minimal markdown renderer (no external deps, XSS-safe) ----------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderInline(s) {
    s = s.replace(/\$\\rightarrow\$/g, '→').replace(/\\rightarrow/g, '→');
    return s
      .replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/(^|\W)_([^_\n]+)_(\W|$)/g, '$1<em>$2</em>$3')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  }

  function renderMarkdown(src) {
    const text = String(src || '').replace(/\r\n/g, '\n');
    const codeBlocks = [];
    const inlineCodes = [];

    let s = text.replace(/```(\w*)\n([\s\S]*?)(```|$)/g, (m, lang, code) => {
      codeBlocks.push('<pre><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>');
      return '\x00B' + (codeBlocks.length - 1) + '\x00';
    });

    s = s.replace(/`([^`\n]+)`/g, (m, code) => {
      inlineCodes.push('<code>' + escapeHtml(code) + '</code>');
      return '\x00C' + (inlineCodes.length - 1) + '\x00';
    });

    s = escapeHtml(s);

    const lines = s.split('\n');
    let out = [];
    let inList = null;
    let inTable = false;

    function closeList() {
      if (inList) {
        out.push(inList === 'ol' ? '</ol>' : '</ul>');
        inList = null;
      }
    }
    function closeTable() {
      if (inTable) {
        out.push('</tbody></table>');
        inTable = false;
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();

      if (!line) {
        closeList();
        closeTable();
        continue;
      }

      let m;
      m = line.match(/^(\#{1,4})\s+(.*)$/);
      if (m) {
        closeList();
        closeTable();
        const lvl = m[1].length;
        out.push(`<h${lvl}>${renderInline(m[2])}</h${lvl}>`);
        continue;
      }

      m = line.match(/^(\*|-)\s+(.*)$/);
      if (m) {
        closeTable();
        if (inList !== 'ul') { closeList(); inList = 'ul'; out.push('<ul>'); }
        out.push(`<li>${renderInline(m[2])}</li>`);
        continue;
      }

      m = line.match(/^(\d+)\.\s+(.*)$/);
      if (m) {
        closeTable();
        if (inList !== 'ol') { closeList(); inList = 'ol'; out.push('<ol>'); }
        out.push(`<li>${renderInline(m[2])}</li>`);
        continue;
      }

      m = raw.match(/^\s*&gt;\s?(.*)$/);
      if (m || /^\s*>\s?/.test(raw)) {
        closeList();
        closeTable();
        const q = (m ? m[1] : raw.replace(/^\s*>\s?/, ''));
        out.push(`<blockquote>${renderInline(q)}</blockquote>`);
        continue;
      }

      if (line.includes('|') && line.startsWith('|') && line.endsWith('|')) {
        closeList();
        if (i + 1 < lines.length && /^\s*\|?\s*[-:]+[-| :]*\|\s*$/.test(lines[i + 1].trim())) {
          closeTable();
          inTable = true;
          const cells = line.split('|').slice(1, -1).map((c) => `<th>${renderInline(c.trim())}</th>`);
          out.push('<table><thead><tr>' + cells.join('') + '</tr></thead><tbody>');
          i++;
          continue;
        } else if (inTable) {
          const cells = line.split('|').slice(1, -1).map((c) => `<td>${renderInline(c.trim())}</td>`);
          out.push('<tr>' + cells.join('') + '</tr>');
          continue;
        }
      }

      if (/^\x00B\d+\x00$/.test(line)) {
        closeList();
        closeTable();
        out.push(line);
        continue;
      }

      closeList();
      closeTable();
      out.push(`<p>${renderInline(line)}</p>`);
    }

    closeList();
    closeTable();

    let html = out.join('');
    html = html.replace(/\x00B(\d+)\x00/g, (mm, n) => codeBlocks[parseInt(n, 10)] || '');
    html = html.replace(/\x00C(\d+)\x00/g, (mm, n) => inlineCodes[parseInt(n, 10)] || '');
    return html || '<p></p>';
  }

  function setMsgMarkdown(el, mdText, jevHtml) {
    if (!el) return;
    el.dataset.raw = String(mdText || '');
    el.innerHTML = (jevHtml || '') + renderMarkdown(mdText);
  }

  function msgNode(entry) {
    const d = document.createElement('div');
    d.className = 'jpdb-ai-msg ' + (entry.role === 'user' ? 'jpdb-ai-user' : 'jpdb-ai-ai md') + (entry.isErr ? ' jpdb-ai-err' : '');
    if (entry.role === 'user' || entry.isErr) {
      d.textContent = entry.text;
    } else {
      setMsgMarkdown(d, entry.text, entry.jevHtml);
    }
    return d;
  }

  function renderLog() {
    const box = document.getElementById('jpdb-ai-msgs');
    if (!box) return;
    box.innerHTML = '';
    msgLog.forEach((entry) => box.appendChild(msgNode(entry)));
    box.scrollTop = box.scrollHeight;
  }

  function addMsg(role, text, isErr, transient) {
    const entry = { role, text: String(text), isErr: !!isErr };
    if (!transient) {
      msgLog.push(entry);
      saveSession();
    }
    const box = document.getElementById('jpdb-ai-msgs');
    if (!box) return null;
    const d = msgNode(entry);
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    return d;
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
        // Answer is hidden on the review page -> prevent spoiling on the chat titlebar!
        ctx.textContent = `Card: [Answer hidden] | ${info.sentenceJP || 'Review question'} (question)`;
      } else {
        ctx.textContent = `Card: ${info.vocab || '?'} | ${info.sentenceJP || 'no sentence'}${info.sentenceEN ? ' — ' + info.sentenceEN : ''} (answer shown)`;
      }
    }
    return info;
  }

  async function runExplain(kind) {
    if (busy) return;
    await ensureCardData();
    const info = refreshCtx();
    const userPrompt = kind === 'breakdown' ? buildBreakdownPrompt(info) : buildExplainPrompt(info);
    addMsg('user', kind === 'breakdown' ? 'Break down this sentence please.' : `What does "${info.vocab || 'this word'}" do in this sentence?`);
    const thinking = addMsg('assistant', kind === 'explain' ? 'Analyzing vocab role…' : 'Thinking…', false, true);
    busy = true;
    setBusy(true);

    // Fast-path: Instant System One Vocab Explainer (<250ms)
    if (kind === 'explain') {
      try {
        const jevPromise = callJevVocabExplanation(info);
        const jevTimeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 1500));
        const jevRes = await Promise.race([jevPromise, jevTimeoutPromise]);

        if (jevRes && jevRes.isFastPath && jevRes.markdown) {
          setMsgMarkdown(thinking, jevRes.markdown, jevRes.cardHtml);
          msgLog.push({ role: 'assistant', text: jevRes.markdown, jevHtml: jevRes.cardHtml, isErr: false });
          history.push({ role: 'user', content: userPrompt });
          history.push({ role: 'assistant', content: jevRes.markdown });
          saveSession();
          busy = false;
          setBusy(false);
          return;
        }

        if (thinking && jevRes && jevRes.cardHtml) {
          thinking.innerHTML = jevRes.cardHtml + '<div class="jpdb-ai-jev-waiting">Thinking… generating detailed analysis…</div>';
        }
      } catch (err) {
        console.warn('[JPDB AI] Fast-path vocab explanation fallback to LLM:', err);
      }
    }

    try {
      // Ratings and explanations are fresh, independent evaluations and do not include prior chat history
      const msgs = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }];
      const reply = await callLLM(msgs);
      setMsgMarkdown(thinking, reply);
      msgLog.push({ role: 'assistant', text: reply, isErr: false });
      history.push({ role: 'user', content: userPrompt });
      history.push({ role: 'assistant', content: reply });
      saveSession();
    } catch (e) {
      msgLog.push({ role: 'assistant', text: 'Error: ' + (e.message || e), isErr: true });
      thinking.textContent = 'Error: ' + (e.message || e);
      thinking.classList.add('jpdb-ai-err');
      saveSession();
    } finally {
      busy = false;
      setBusy(false);
    }
  }

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

    const t0 = Date.now();
    try {
      // Step 1: Launch fast System One evaluation (Jev-1.13)
      const jevPromise = callJevEvaluation(info, userDraft);
      const jevTimeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 1500));
      const jevRes = await Promise.race([jevPromise, jevTimeoutPromise]);
      const jevElapsed = jevRes?.elapsedMs || (Date.now() - t0);
      const jevMetrics = jevRes?.metrics || null;
      let jevCardHtml = jevRes?.cardHtml || '';

      // Step 2: Fast-pass! If Jev confirms 10/10 (flawless), skip the LLM call entirely!
      if (jevMetrics && jevMetrics.overall === 10) {
        const flawlessReply = '**Score: 10/10 (Flawless)**\n\nYour translation accurately conveys the sentence meaning, tone, and grammatical intent with no errors.';
        setMsgMarkdown(thinking, flawlessReply, jevCardHtml);
        const logEntry = { role: 'assistant', text: flawlessReply, jevHtml: jevCardHtml, isErr: false };
        msgLog.push(logEntry);
        history.push({ role: 'user', content: userPrompt });
        history.push({ role: 'assistant', content: flawlessReply });
        saveSession();
        recordDiagnosticEntry(info, userDraft, jevMetrics, jevElapsed, flawlessReply, 10, 0);
        return;
      }

      // Step 2b: Safe fast-pass expansion:
      // 1. High-confidence English typo detection with sound Japanese comprehension
      // 2. High-confidence decision-level structural error detection with dynamic critique
      // 3. Fallback high global confidence (minConf >= 0.80 or avgConf >= 0.88)
      const isTypoFastPath = jevMetrics && jevMetrics.isTypo && (jevMetrics.typoConfidence >= 0.80);
      const isStructuralDecisionFastPath = jevMetrics && jevMetrics.isDecisionConfident && (jevMetrics.bracketConfidence >= 0.65) && jevMetrics.dynamicCritique;
      const isGlobalConfidentFastPath = jevMetrics && jevMetrics.dynamicCritique && (jevMetrics.minConfidence >= 0.80 || jevMetrics.avgConfidence >= 0.88);

      if (isTypoFastPath || isStructuralDecisionFastPath || isGlobalConfidentFastPath) {
        const scoreBracket = jevMetrics.bracketLabel || `${jevMetrics.overall}/10`;
        const fastReply = `**Score: ${jevMetrics.overall}/10 (${scoreBracket})**\n\n${jevMetrics.dynamicCritique}` +
          (info.sentenceEN ? `\n\n**Reference Translation:**\n"${info.sentenceEN}"` : '');
        setMsgMarkdown(thinking, fastReply, jevCardHtml);
        const logEntry = { role: 'assistant', text: fastReply, jevHtml: jevCardHtml, isErr: false };
        msgLog.push(logEntry);
        history.push({ role: 'user', content: userPrompt });
        history.push({ role: 'assistant', content: fastReply });
        saveSession();
        recordDiagnosticEntry(info, userDraft, jevMetrics, jevElapsed, fastReply, jevMetrics.overall, 0);
        return;
      }

      // Step 3: If Jev detected mistakes/advisories (< 10/10) or timed out, display instant assessment and call LLM
      if (thinking && jevCardHtml) {
        thinking.innerHTML = jevCardHtml + '<div class="jpdb-ai-jev-waiting">Thinking… generating detailed analysis…</div>';
      }

      const t0_llm = Date.now();
      const msgs = [{ role: 'system', content: SYSTEM_PROMPT }, ...history, { role: 'user', content: userPrompt }];
      const reply = await callLLM(msgs);
      const llmElapsed = Date.now() - t0_llm;
      const llmScore = extractLlmScore(reply);

      // In case Jev was slow (>1500ms) but finished while LLM was thinking
      if (!jevCardHtml) {
        try {
          const lateRes = await Promise.race([jevPromise, Promise.resolve(null)]);
          if (lateRes && lateRes.cardHtml) {
            jevCardHtml = lateRes.cardHtml;
          }
        } catch {}
      }

      setMsgMarkdown(thinking, reply, jevCardHtml);
      const logEntry = { role: 'assistant', text: reply, jevHtml: jevCardHtml, isErr: false };
      msgLog.push(logEntry);
      history.push({ role: 'user', content: userPrompt });
      history.push({ role: 'assistant', content: reply });
      saveSession();

      recordDiagnosticEntry(info, userDraft, jevMetrics, jevElapsed, reply, llmScore, llmElapsed);
    } catch (e) {
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
    try {
      const msgs = [{ role: 'system', content: SYSTEM_PROMPT }, ...history, { role: 'user', content: prompt }];
      const reply = await callLLM(msgs);
      setMsgMarkdown(thinking, reply);
      msgLog.push({ role: 'assistant', text: reply, isErr: false });
      history.push({ role: 'user', content: prompt });
      history.push({ role: 'assistant', content: reply });
      saveSession();
    } catch (e) {
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
    document.querySelectorAll('#jpdb-ai-btns button, #jpdb-ai-send, #jpdb-ai-rate').forEach((x) => { x.disabled = b; });
  }

  function isPanelOpen() {
    const p = document.getElementById('jpdb-ai-panel');
    return !!p && p.style.display !== 'none';
  }

  const FAB_ICON_CHAT = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';
  const FAB_ICON_CLOSE = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  function syncFab() {
    const fab = document.getElementById('jpdb-ai-fab');
    if (!fab) return;
    const open = isPanelOpen();
    fab.style.display = 'flex';
    fab.classList.toggle('jpdb-ai-fab-active', open);
    fab.innerHTML = open ? FAB_ICON_CLOSE : FAB_ICON_CHAT;
    fab.title = open ? 'Close AI chat (click, Esc, or D)' : 'Open AI chat (D) · Explain (A) · Breakdown (S)';
  }

  function toggle(show) {
    let p = document.getElementById('jpdb-ai-panel');
    if (!p) {
      ensureUI();
      p = document.getElementById('jpdb-ai-panel');
      if (!p) return;
    }
    const willShow = show !== undefined ? show : p.style.display === 'none';
    p.style.display = willShow ? 'flex' : 'none';
    panelOpen = willShow;
    saveSession();
    syncFab();
    if (willShow) refreshCtx();
  }

  function ensureFab() {
    if (document.getElementById('jpdb-ai-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'jpdb-ai-fab';
    fab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
    fab.setAttribute('aria-label', 'Ask AI about this vocab');
    fab.title = 'Open AI chat (D) · Explain (A) · Breakdown (S)';
    fab.addEventListener('click', () => toggle());
    document.body.appendChild(fab);
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
            <button type="button" id="jpdb-ai-settings-close" title="Back to review chat">✕</button>
          </div>
        </div>
        <form id="jpdb-ai-settings-form" style="display:flex;flex-direction:column;gap:10px">
          <div class="jpdb-ai-settings-group">
            <div class="jpdb-ai-settings-group-title">💬 LLM (Chat & Explainer)</div>
            <label class="jpdb-ai-settings-label">
              API Endpoint / Base URL
              <input type="text" id="jpdb-ai-cfg-llm-base" class="jpdb-ai-settings-input" placeholder="e.g. https://generativelanguage.googleapis.com/v1beta" />
            </label>
            <label class="jpdb-ai-settings-label">
              Model
              <input type="text" id="jpdb-ai-cfg-llm-model" class="jpdb-ai-settings-input" placeholder="e.g. gemini-3.5-flash-lite" />
            </label>
            <label class="jpdb-ai-settings-label">
              API Key
              <div style="display:flex;gap:6px">
                <input type="password" id="jpdb-ai-cfg-llm-key" class="jpdb-ai-settings-input" placeholder="LLM API key" style="flex:1" />
                <button type="button" class="jpdb-ai-settings-btn-toggle" data-target="jpdb-ai-cfg-llm-key" title="Toggle visibility">👁️</button>
              </div>
            </label>
          </div>

          <div class="jpdb-ai-settings-group">
            <div class="jpdb-ai-settings-group-title">⚡ JEV (Instant Vocab & Assessment)</div>
            <label class="jpdb-ai-settings-label">
              JEV Endpoint URL
              <input type="text" id="jpdb-ai-cfg-jev-endpoint" class="jpdb-ai-settings-input" placeholder="e.g. https://openrouter.ai/api/alpha/decisions" />
            </label>
            <label class="jpdb-ai-settings-label">
              JEV Model
              <input type="text" id="jpdb-ai-cfg-jev-model" class="jpdb-ai-settings-input" placeholder="e.g. typesafe/jev-1.13" />
            </label>
            <label class="jpdb-ai-settings-label">
              JEV API Key
              <div style="display:flex;gap:6px">
                <input type="password" id="jpdb-ai-cfg-jev-key" class="jpdb-ai-settings-input" placeholder="OpenRouter API key" style="flex:1" />
                <button type="button" class="jpdb-ai-settings-btn-toggle" data-target="jpdb-ai-cfg-jev-key" title="Toggle visibility">👁️</button>
              </div>
            </label>
          </div>

          <div class="jpdb-ai-settings-group">
            <div class="jpdb-ai-settings-group-title">⌨️ Keyboard Shortcuts</div>
            <label class="jpdb-ai-settings-checkbox-label">
              <input type="checkbox" id="jpdb-ai-cfg-invert-enter" />
              <span>Invert Enter / Ctrl+Enter (Enter = Rate, Ctrl+Enter = Send)</span>
            </label>
          </div>

          <div style="display:flex;align-items:center;gap:8px;margin-top:2px;flex-wrap:wrap">
            <button type="submit" id="jpdb-ai-settings-save" class="jpdb-ai-settings-btn-primary">Save Settings</button>
            <button type="button" id="jpdb-ai-settings-import" class="jpdb-ai-settings-btn-secondary" title="Import settings from JSON file">Import JSON</button>
            <button type="button" id="jpdb-ai-settings-export" class="jpdb-ai-settings-btn-secondary" title="Export settings as JSON file">Export JSON</button>
            <button type="button" id="jpdb-ai-settings-reset" class="jpdb-ai-settings-btn-secondary">Reset Defaults</button>
            <span id="jpdb-ai-settings-status" style="font-size:11px;font-weight:600;color:#10b981;display:none">Saved!</span>
          </div>
        </form>
      </div>
      <div id="jpdb-ai-diag-view">
        <div class="jpdb-ai-diag-head">
          <span>Diagnostics (<span id="jpdb-ai-diag-stat">0</span>)</span>
          <div class="jpdb-ai-diag-actions">
            <button id="jpdb-ai-diag-filter" title="Toggle divergent-only filter">Filter: All</button>
            <button id="jpdb-ai-diag-export" title="Export as JSON file">Export JSON</button>
            <button id="jpdb-ai-diag-clear" title="Clear recorded diagnostics">Clear</button>
            <button id="jpdb-ai-diag-close" title="Back to review chat">✕</button>
          </div>
        </div>
        <div id="jpdb-ai-diag-list"></div>
      </div>
      <div id="jpdb-ai-msgs"></div>
      <div id="jpdb-ai-row">
        <input id="jpdb-ai-input" placeholder="Ask follow-up (Enter) · Rate translation (Ctrl+Enter or Insert)…" />
        <button id="jpdb-ai-send" title="Send message (Enter)">Send</button>
        <button id="jpdb-ai-rate" title="Rate sentence translation (Insert, Ctrl+Enter, T)"><span class="jpdb-ai-btn-long">Rate translation</span><span class="jpdb-ai-btn-short">Rate</span></button>
      </div>
      <div id="jpdb-ai-foot">
        <span id="jpdb-ai-model"></span>
        <span class="jpdb-ai-foot-links">
          <a href="#" id="jpdb-ai-diag-link" title="Translation rating diagnostics">Diag (0)</a>
          <span>·</span>
          <a href="#" id="jpdb-ai-invert-toggle" title="Click to invert Enter / Ctrl+Enter mapping"></a>
          <span>·</span>
          <a href="#" id="jpdb-ai-cfg">settings</a>
        </span>
      </div>
    `;
    document.body.appendChild(panel);

    ['keydown', 'keypress', 'keyup'].forEach((eventName) => {
      panel.addEventListener(eventName, (e) => e.stopPropagation());
    });

    panel.querySelector('#jpdb-ai-x').addEventListener('click', () => toggle(false));

    const wideBtn = panel.querySelector('#jpdb-ai-wide');
    function setWide(w) {
      panel.classList.toggle('jpdb-ai-wide', !!w);
      if (!w) { panel.style.width = ''; panel.style.height = ''; }
      wideBtn.textContent = w ? '⤡' : '⤢';
      wideBtn.title = w ? 'Back to compact view' : 'Expand to wide view';
      try { GM_setValue('jpdb_ai_wide', !!w); } catch {}
    }
    let wideInit = false;
    try { wideInit = GM_getValue('jpdb_ai_wide', false); } catch {}
    setWide(!!wideInit);
    wideBtn.addEventListener('click', () => setWide(!panel.classList.contains('jpdb-ai-wide')));

    panel.querySelector('#jpdb-ai-head').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      panel.classList.toggle('jpdb-ai-collapsed');
    });

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
        if (input) input.placeholder = isNarrow ? "Rate (Enter) · Send (Ctrl+Enter)…" : "Rate translation (Enter or Insert) · Send (Ctrl+Enter)…";
        if (sendBtn) sendBtn.title = "Send follow-up message (Ctrl+Enter)";
        if (rateBtn) rateBtn.title = "Rate translation (Enter, Insert, or T)";
        if (toggleLink) toggleLink.textContent = "Enter: Rate";
      } else {
        if (input) input.placeholder = isNarrow ? "Ask AI (Enter) · Rate (Ctrl+Enter)…" : "Ask follow-up (Enter) · Rate translation (Ctrl+Enter or Insert)…";
        if (sendBtn) sendBtn.title = "Send message (Enter)";
        if (rateBtn) rateBtn.title = "Rate sentence translation (Insert, Ctrl+Enter, or T)";
        if (toggleLink) toggleLink.textContent = "Enter: Send";
      }
    }

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
        const jevEndpointVal = panel.querySelector('#jpdb-ai-cfg-jev-endpoint')?.value || '';
        const jevModelVal = panel.querySelector('#jpdb-ai-cfg-jev-model')?.value || '';
        const jevKeyVal = panel.querySelector('#jpdb-ai-cfg-jev-key')?.value || '';
        const invertVal = panel.querySelector('#jpdb-ai-cfg-invert-enter')?.checked || false;

        if (modelVal.toLowerCase().includes('gemini') && modelVal.includes(' ')) {
          modelVal = modelVal.trim().toLowerCase().replace(/\s+/g, '-');
        }

        CFG.base = baseVal;
        CFG.model = modelVal;
        CFG.key = keyVal;
        CFG.jevEndpoint = jevEndpointVal;
        CFG.jevModel = jevModelVal;
        CFG.jevKey = jevKeyVal;
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
        if (confirm('Reset settings to defaults? (Your API keys will be cleared)')) {
          panel.querySelector('#jpdb-ai-cfg-llm-base').value = DEFAULT_API_BASE;
          panel.querySelector('#jpdb-ai-cfg-llm-model').value = DEFAULT_MODEL;
          panel.querySelector('#jpdb-ai-cfg-llm-key').value = '';
          panel.querySelector('#jpdb-ai-cfg-jev-endpoint').value = DEFAULT_JEV_ENDPOINT;
          panel.querySelector('#jpdb-ai-cfg-jev-model').value = DEFAULT_JEV_MODEL;
          panel.querySelector('#jpdb-ai-cfg-jev-key').value = '';
          panel.querySelector('#jpdb-ai-cfg-invert-enter').checked = false;
        }
      });
    }

    updateFoot = function () {
      const el = document.getElementById('jpdb-ai-model');
      if (el) {
        const shortModel = CFG.model.replace(/^models\//, '');
        const shortJev = CFG.jevModel ? (CFG.jevModel.split('/').pop() || CFG.jevModel) : '';
        el.textContent = shortJev ? `${shortModel} + ${shortJev}` : shortModel;
        el.title = `LLM: ${CFG.model} (${CFG.base})\nJEV: ${CFG.jevModel} (${CFG.jevEndpoint})`;
      }
    }
    updateFoot();
    updateShortcutsUI();

    panel.querySelector('#jpdb-ai-diag-link').addEventListener('click', (e) => {
      e.preventDefault();
      toggleDiagView();
    });
    panel.querySelector('#jpdb-ai-diag-close').addEventListener('click', () => toggleDiagView(false));
    panel.querySelector('#jpdb-ai-diag-filter').addEventListener('click', () => {
      diagFilterDivergent = !diagFilterDivergent;
      renderDiagList();
    });
    panel.querySelector('#jpdb-ai-diag-export').addEventListener('click', () => exportDiagnosticsJson());
    panel.querySelector('#jpdb-ai-diag-clear').addEventListener('click', () => {
      if (confirm('Clear all recorded diagnostics?')) {
        saveDiagnosticsLog([]);
        updateDiagFooterLink();
        renderDiagList();
      }
    });

    updateDiagFooterLink();

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
    if (!document.body) return;
    ensureFab();
    ensurePanel();
    syncFab();
  }

  function openAndFocusInput() {
    toggle(true);
    setTimeout(() => {
      const inputEl = document.getElementById('jpdb-ai-input');
      if (inputEl) {
        inputEl.focus();
        const len = inputEl.value.length;
        inputEl.setSelectionRange(len, len);
      }
    }, 50);
  }

  function bindGlobalKeys() {
    if (window.__jpdbAiKeybound) return;
    window.__jpdbAiKeybound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isPanelOpen()) {
        e.preventDefault();
        toggle(false);
        return;
      }
      if (e.key === 'Insert') {
        e.preventDefault();
        toggle(true);
        runRateTranslation();
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      const target = e.target;
      const isTextInput = target && (
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        (target.tagName === 'INPUT' && ['text', 'search', 'password', 'email', 'url', 'tel', 'number'].includes((target.type || 'text').toLowerCase()))
      );

      if (!isTextInput && !e.altKey) {
        if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          toggle(true);
          runExplain('explain');
          return;
        } else if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          toggle(true);
          runExplain('breakdown');
          return;
        } else if (e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          openAndFocusInput();
          return;
        } else if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          toggle(true);
          runRateTranslation();
          return;
        }
      }

      if (e.altKey) {
        if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          toggle(true);
          runExplain('explain');
        } else if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          toggle(true);
          runExplain('breakdown');
        } else if (e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          openAndFocusInput();
        } else if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          toggle(true);
          runRateTranslation();
        }
      }
    });
  }

  function startWatch() {
    if (window.__jpdbAiWatch) return;
    window.__jpdbAiWatch = true;
    let t = null;
    const kick = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const token = getCardToken();
        if (token && token !== currentSessionToken) {
          refreshCtx();
          prefetchIfQuestion();
        }
        const sBtn = document.getElementById('show-answer');
        if (sBtn && sBtn.type === 'submit') sBtn.type = 'button';
        if (!document.getElementById('jpdb-ai-fab') || !document.getElementById('jpdb-ai-panel')) {
          ensureUI();
        } else if (isPanelOpen()) {
          refreshCtx();
        }
      }, 300);
    };
    try {
      new MutationObserver(kick).observe(document.documentElement, { childList: true, subtree: true });
    } catch {}
    window.addEventListener('hashchange', () => {
      refreshCtx();
    });
    let lastHref = location.href;
    setInterval(() => {
      const token = getCardToken();
      if (token && token !== currentSessionToken) {
        refreshCtx();
        prefetchIfQuestion();
      }
      if (!document.getElementById('jpdb-ai-fab') || !document.getElementById('jpdb-ai-panel')) {
        ensureUI();
      } else if (location.href !== lastHref) {
        lastHref = location.href;
        if (isPanelOpen()) refreshCtx();
      }
    }, 1000);
  }

  // ---------- Seamless In-Place Answer Reveal ----------
  // Prevents the browser from destroying the JavaScript context and severing in-flight
  // LLM generation or Jev requests when the user flips from question to answer.
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

        // Restore browser focus to the Pass button (or autofocus element) when chat is closed
        // so spacebar/enter immediately submits Pass as JPDB natively does
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
