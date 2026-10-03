# Hard Split Provenance Record

This document records the exact provenance of all 44 cases in `prototype/bench/hard_cases.json` (SHA-256: `4d67a85335d85a7a1809bfb93604e1252f69b085001c5a37700935e7a8feddf7`).

## 1. Provenance Breakdown

* **Real Live Diagnostics-Log Divergence (1 case):**
  * Case ID: `hard_div_01`
  * Provenance: Extracted directly from live Tampermonkey `jpdb_ai_diagnostics_log` in the running Chromium/Thorium browser session on port 9223.
  * Discrepancy observed: Jev gave an initial strict rating, while the shadow LLM critique evaluated it differently due to an idiomatic nuance.

* **Agent-Constructed Cases (43 cases):**
  * `hard_div_02` through `hard_div_22` (21 cases)
  * `hard_subtle_01` through `hard_subtle_22` (22 cases)
  * **Clarification / Correction:** The ID prefix `hard_div_*` is a misnomer for cases 02 through 22. These 21 cases were **not** mined from live browser diagnostics logs; they were constructed by the agent to model failure modes and boundary conditions observed across the project's commit history.
  * Relevant historical commits that informed case design:
    * `955fd2f` ("Add English typo detection measurement and safe fast-path expansion to userscript")
    * `f7a5509` ("Expand Jev grading questions to cover all 6 critical error types")
    * `f10c6ea` ("Add shadow evaluation pipeline and diagnostic logging for Jev grading")
    * `a460599` ("Fix numeral normalizer to prevent false-mismatch regressions on compound kanji")

## 2. Split Label Status
All 44 cases in `hard_cases.json` carry `label_status: "agent_draft"`. The file is frozen and hashed in `prototype/bench/hard.sha256`. Per brief rules, no test or hard cases may be modified or added.
