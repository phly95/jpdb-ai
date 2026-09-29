# JPDB AI Vocab Explainer

A power-user Tampermonkey script for [jpdb.io](https://jpdb.io) reviews that integrates a two-stage evaluation system:
1. **System 1 (Jev-1.13):** Sub-500ms deterministic decision model evaluating vocabulary sense, grammatical morphology, modality, benefactives, and question type.
2. **System 2 (LLM):** In-depth pedagogical feedback, conversational clarification, and full sentence breakdowns.

## Features
- **In-Place Card Progression:** Seamlessly advances reviews (`#show-answer`) without page reloads, preserving browser autofocus on `#grade-p` (Pass) so <kbd>Space</kbd> or <kbd>Enter</kbd> advances cards naturally.
- **Two-Stage Grading Battery:**
  - Independent sentence-level structural validation (interrogative scope, benefactive direction, passive/active voice, tense/aspect).
  - Fine-grained token segmentation via `Intl.Segmenter` with particle and auxiliary verb disambiguation.
  - Strict 10/10 invariant: Flawless translations receive 10/10 with no artificial deductions.
  - Separate categorization for **advisory notes** (amber) vs **scoring errors** (red).
- **Persistent Review Session:** Retains LLM context, chat log, and user translation drafts across card flips and browser reloads.
- **Diagnostics Buffer:** In-memory circular buffer recording latency, Jev diagnostics, and LLM score comparisons, exportable via Blob JSON.
- **Responsive Mobile UX:** Floating action button (FAB) toggle, collapsed view, and full-screen mobile panel support.

## Installation
Install via Tampermonkey or compatible userscript manager from `jpdb-ai.user.js`.

### Configuration
Accessible via the `settings` link on the chat panel footer:
- **API Base:** OpenAI-compatible API base URL (e.g. `http://<host>:20128/v1`)
- **Model:** Primary generative model (e.g. `ag/gemini-3.8-flash-low` or `claude-sonnet-4-6`)
- **API Key:** Bearer authorization credential

## Shortcuts
- <kbd>Alt</kbd> + <kbd>A</kbd>: Explain tested vocabulary role in sentence
- <kbd>Alt</kbd> + <kbd>S</kbd>: Structural sentence breakdown
- <kbd>Alt</kbd> + <kbd>T</kbd> / <kbd>Insert</kbd>: Rate proposed translation
- <kbd>Escape</kbd>: Close / minimize AI panel
