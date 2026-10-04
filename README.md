# JPDB AI Vocab Explainer (Gemini Edition)

A power-user Tampermonkey userscript for [jpdb.io](https://jpdb.io) reviews powered by a single Gemini call (e.g. `gemini-3.5-flash-lite` or `ag/gemini-3.8-flash-low`).

## Overview
This streamlined version eliminates dual-model routing, complex hand-coded decision tree schemas, and fragile verification heuristics. A single Gemini call evaluates translations and vocabulary in JSON mode, producing rich visual cards with token segmentation chips, followed by clean conversational chat.

## Features
- **Single-Call Gemini Architecture:** Only 1 API call per action (Translation Rating or Vocab Explanation).
- **Rich Visual Cards:**
  - **Translation Assessment:** Color-coded score pill (`10/10 (Flawless)`, `Minor Nuance`, `Moderate Error`, `Major Error`), flawless confirmation banner, structured mistake explanations, and sentence token chips (`.ok`, `.err`, `.advisory`).
  - **Vocab Explainer:** Grammatical role pill (e.g., `Direct Object`), applied sense, connected predicate attachment, and color-coded token chips (`.target` in purple, `.connected` in amber).
- **Clean Conversational History:** For follow-up questions, the LLM response outside of the pill is preserved as clean markdown in the chat context, ensuring high-quality multi-turn tutoring.
- **In-Place Card Progression:** Seamlessly advances reviews (`#show-answer`) without page reloads, preserving ongoing LLM streaming, chat history, and browser autofocus on `#grade-p` (Pass).
- **Persistent Review Session:** Retains chat history, input drafts, and active context across card flips and browser reloads via `sessionStorage`.
- **Responsive UX:** Floating Action Button (FAB), desktop side panel, wide mode, and mobile bottom sheet.

## Default Configuration
Accessible via the `settings` link on the chat panel footer:
- **API Base:** `https://generativelanguage.googleapis.com/v1beta`
- **Model:** `gemini-3.5-flash-lite`
- **API Key:** Google AI Studio Gemini API Key (saved in browser `GM_setValue`)

## Shortcuts
- <kbd>Alt</kbd> + <kbd>A</kbd> or <kbd>A</kbd> (when not in input): Explain tested vocabulary role in sentence
- <kbd>Alt</kbd> + <kbd>S</kbd> or <kbd>S</kbd> (when not in input): Structural sentence breakdown
- <kbd>Alt</kbd> + <kbd>T</kbd> / <kbd>Insert</kbd> / <kbd>T</kbd>: Focus translation input / rate translation
- <kbd>Enter</kbd> (default): Rate translation (configurable in settings to Send chat)
- <kbd>Escape</kbd>: Close / minimize AI panel
