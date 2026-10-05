# JPDB AI Vocab Explainer

A power-user Tampermonkey userscript for [jpdb.io](https://jpdb.io) reviews powered by Gemini (default: `gemini-3.5-flash-lite`).

## Overview
JPDB AI integrates directly into your JPDB review workflow to provide instant, in-context Japanese tutoring. Using single-call Gemini structured outputs, it evaluates your translation attempts and explains vocabulary grammar with color-coded visual cards and token segmentation chips, followed by multi-turn conversational chat.

## Features
- **Single-Call Gemini Architecture:** Fast, cost-effective evaluation with only 1 API call per action (Translation Rating or Vocab Explanation).
- **Rich Visual Cards:**
  - **Translation Assessment:** Color-coded score pill (`10/10 (Flawless)`, `Minor Nuance`, `Moderate Error`, `Major Error`), flawless confirmation banner, structured mistake explanations, and sentence token chips (`.ok`, `.err`, `.advisory`).
  - **Vocab Explainer:** Grammatical role pill (e.g., `Direct Object`), applied sense, connected predicate attachment, and color-coded token chips (`.target` in purple, `.connected` in amber).
- **Clean Conversational History:** Multi-turn tutoring preserves chat context without markdown pollution from card headers.
- **In-Place Card Progression:** Seamlessly advances reviews (`#show-answer`) without page reloads, preserving ongoing LLM streaming, chat history, and browser autofocus on `#grade-p` (Pass).
- **Persistent Review Session:** Retains chat history, input drafts, and active context across card flips and browser reloads via `sessionStorage`.
- **Responsive UX:** Floating Action Button (FAB), desktop side panel, wide mode, and mobile bottom sheet.
- **Exportable Diagnostics:** Built-in inspector menu to copy or download request payloads, responses, token usage, and latency.

## Default Configuration
Accessible via the `settings` link on the chat panel footer or Tampermonkey menu command:
- **API Base:** `https://generativelanguage.googleapis.com/v1beta` (or OpenAI-compatible `/chat/completions`)
- **Model:** `gemini-3.5-flash-lite`
- **API Key:** Google AI Studio Gemini API Key (stored locally in browser `GM_setValue`)

## Shortcuts
- <kbd>Alt</kbd> + <kbd>A</kbd> or <kbd>A</kbd> (when not in input): Explain tested vocabulary role in sentence
- <kbd>Alt</kbd> + <kbd>S</kbd> or <kbd>S</kbd> (when not in input): Structural sentence breakdown
- <kbd>Alt</kbd> + <kbd>D</kbd> / <kbd>D</kbd> / <kbd>Alt</kbd> + <kbd>T</kbd> / <kbd>T</kbd> / <kbd>Insert</kbd>: Focus translation input / open AI panel
- <kbd>Enter</kbd> (in input): Rate translation (configurable in settings to send chat instead)
- <kbd>Escape</kbd>: Close / minimize AI panel

## Testing
- Validate syntax: `node --check jpdb-ai.user.js`
- Run Gemini E2E flow test: `node test/test_gemini.js` (requires `GEMINI_API_KEY` in `.env` or environment)
- Run thinking benchmark: `node test/bench_thinking.js`
