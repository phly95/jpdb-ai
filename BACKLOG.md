# Backlog: Translation Grading & Numeral Issues

This file tracks known false deductions, edge cases, and nuances identified during benchmarking.
Per amendment A6, **NO instructions or code may be changed to fix these items before Phase 3 completes.**

---

### Item 1: `test_flawless_14`
* **Failure category:** benefactive direction false-positive on honorific verb
* frozen until after Phase 3

---

### Item 2: `dev_flawless_15` (12-Hour vs 24-Hour Time Format Matching)
* **Sentence (JP):** `午後三時に会いましょう。`
* **Reference (EN):** `Let's meet at 3 in the afternoon.`
* **Learner Draft:** `Let's meet at 3:00 PM.`
* **Observed Score:** `7/10` (Fallback)
* **Root Cause:**
  * Code-side deterministic numeral parser `assessNumeralStatus(sentenceJP, userDraft, referenceTranslation)` parsed `午後三時` from Japanese and `3:00 PM` from the draft.
  * The numeral normalization logic did not recognize `3:00` with `PM` as numerically identical to `午後三時` (or flagged status as unverified/mismatch).
  * `hasNumeralMismatch: true` forced `overall = 7` and blocked fast-path (`numeral_mismatch_unreported`).
* **Resolution Plan:** Address in Phase 5 during the numeral engine review (enhancing time format equivalences `X:00 PM` <-> `午後X時`).

---

### Item 3: Question IDs Sent to Jev but Unused (`flawed_student_excerpt`)
* **Status:** Experiment candidate (not an action; confirmed in P1.4).
* **Investigation (P1.4):** Exhaustive code analysis across all questions sent to Jev confirmed that `flawed_student_excerpt` is the *sole* question ID whose answer is never consumed by any reachable code (the previous consumer `contrast_relation` was removed in S2.3).
* **Reachable Consumers:** 0.
* **Experiment Candidate:** Evaluate pruning `flawed_student_excerpt` in a future controlled experiment against `BENCH_SPEC.md` adoption criteria to determine whether eliminating the unused question affects Jev latency, output tokens, or answer distribution on surrounding questions. No changes before formal experiment authorization.
