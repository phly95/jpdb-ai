# Instructions for Agents Working on JPDB AI

This repository contains the source code for the **JPDB AI Vocab Explainer** Tampermonkey userscript for [jpdb.io](https://jpdb.io).

## Development Guidelines
- The main userscript source file is `jpdb-ai.user.js`.
- Always validate JavaScript syntax before deploying: `node --check jpdb-ai.user.js`.
- Follow the versioning scheme in `// @version <semver>` at the top of `jpdb-ai.user.js`.

## How to Test & Deploy Changes to Tampermonkey
A Python skill is globally installed at `/home/philip/.agents/skills/tampermonkey/tampermonkey_sync.py`.

Whenever you make changes to `jpdb-ai.user.js`, run:
```python
import sys
sys.path.append("/home/philip/.agents/skills/tampermonkey")
import tampermonkey_sync

# Automatically syncs to Tampermonkey (dast + chrome.storage), reloads the browser review tab, and commits
tampermonkey_sync.sync_and_commit(
    commit_message="describe your change here",
    push=False, # set to True when pushing to GitHub
    version="1.0.71"
)
```

## Browser Debugging Environment
- Browser (Thorium / Chromium) runs with remote debugging enabled on port `9223`.
- Active JPDB review tab is at `https://jpdb.io/review`.
- Primary AI backend is Google Gemini Native (`https://generativelanguage.googleapis.com/v1beta`) with `gemini-3.5-flash-lite`.
