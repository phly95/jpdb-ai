# Progress Tracking: Jev Grading Cleanup & Benchmarking

| Step ID | Status | Evidence File / Command |
|---|---|---|
| S1.1 Recon | DONE | `git rev-parse HEAD` (`6ae92ae`), `node --check jpdb-ai.user.js` (pass), `node prototype/run_hardened_test.js` (78/78 pass) |
| S1.2 Dataset | DONE | `prototype/bench/cases.json` (106 cases, 53 dev / 53 test, 64 errors / 42 valid, SHA-256 in `test.sha256`) |
| S1.3 Harness | DONE | `prototype/run_comprehensive_benchmark.js` (4 option orders + 3 repeats = 6 conditions per case) |
| S1.4 Baseline | DONE | `prototype/bench/baseline_run1.json`, `prototype/bench/baseline_run2.json` (636 calls each) |
| S1.5 Metrics report | DONE | Analyzed via `prototype/bench/analyze_benchmark.js` |
| GATE 1 | DONE | Approved by user with amendments A9-A14 (status updated from WAITING to DONE) |
| A1 Case-only bounds | DONE | Calls-based claim withdrawn; case false-flawless across any of 6 conditions (0/32 dev, 0/32 test, 0/26 hard) |
| A2 Decision-level flip analysis & probe | DONE | Decision flips, repeat noise, directional test, determinism probe (x10 on 5 cases, max prob diff 17.0%, 0 score flips) |
| A3 Hard split dataset | DONE | `prototype/bench/hard_cases.json` (44 cases: agent-constructed, 1 real divergence), SHA-256 in `hard.sha256` |
| A4 Leak check | DONE | `prototype/bench/leak_check.js` (0 leaks across 97 test + hard sentences in `jpdb-ai.user.js` and `git log -S`) |
| A5 Adoption rule amendment | DONE | Formalized in benchmark evaluation spec (test + hard evaluation, user-perceived latency, 3pt fast-path coverage margin, 1-case false deduction margin) |
| A6 False deductions logging | DONE | `BACKLOG.md` created with root causes for `test_flawless_14` & `dev_flawless_15`; frozen until post-Phase 3 |
| A7 Dead contrast test plan | DONE | Identified dead contrast assertions in `run_hardened_test.js` for Phase 2 removal under EXPECTATION CHANGES |
| A8 Run provenance tracking | DONE | Metadata recording endpoint, model, timestamp, payloadHash added to benchmark runner |
| C1 Commit state audit | DONE | `git merge-base --is-ancestor 1f211d7 6ae92ae` (exit=0); `1f211d7` predates baseline; 0 edits to userscript |
| C2 Leak check positive controls | DONE | Positive controls verified on `jpdb-ai.user.js` and committed file; 0 leaks across 97 sentences outside `prototype/bench/` |
| C3 Redact BACKLOG.md test sentence | DONE | Redacted Japanese sentence and draft for `test_flawless_14` from `BACKLOG.md` |
| C4 Directional test redone | DONE | Question-level directional analysis (flips to first vs last, binomial sign test $p=0.081$/$0.038$, repeat noise 1.17%) |
| C5 Hard split provenance & breakdown | DONE | Breakdown: 26 error / 18 valid; provenance documented; baseline metrics reported |
| C6 Determinism probe cut | DONE | 300 repeat cases analyzed: share within 0.17 of confidence floors & repeat pass/fail flip rate |
| C7 Precise A5 criteria & sensitivity | DONE | Restated adoption rules 1-7; sensitivity table for $L = 500, 1000, 2000\text{ ms}$ |
| C8 Revised A7 test plan & S4.2 | DONE | Tests 1-2 removal, Test 3 clause removal only (keeping assertion); S4.2 row added |
| A9 Hash verification | DONE | `prototype/bench/verify_hashes.js`: both test.sha256 and hard.sha256 recomputed and matched 100%; count reconciled |
| A10 Endpoint verification | DONE | Live Tampermonkey storage read via CDP: endpoint `https://openrouter.ai/api/alpha/decisions`, model `typesafe/jev-1.13` (matches benchmark) |
| A11 Directional classification & noise | DONE | Classification by option type; p-values withdrawn; see P3 |
| A12 Hard split provenance correction | DONE | Created `prototype/bench/HARD_PROVENANCE.md` (1 real from diagnostics log, 43 agent-constructed; historical commit citations verified) |
| A13 Adoption rule noise fix | SUPERSEDED | Superseded by G4/P2 (Phase 2 reference table in BENCH_SPEC.md) |
| A14 Dead contrast scope & BACKLOG candidate | DONE | Unreachable contrast logic removed; `flawed_student_excerpt` candidate added to `BACKLOG.md` Item 3 |
| S2.1 Prompt hygiene (reference_translation) | DONE | Removed dead `reference_translation` from prompt instructions; commit `de028ba` |
| S2.2 Unit test for backticked state keys | DONE | `run_hardened_test.js` updated; verified failing on baseline `6ae92ae`, passing on `HEAD`; commit `f40cd31` |
| S2.3 Remove dead contrast logic | DONE | Search proof documented; dead `rel`/`excerptUsable`/`excerptComparison` removed; commit `28ab1c3` |
| S2.4 Header & config cleanup | DONE | Removed redundant `@connect` directives; updated comment from "minimal" to "low"; commit `ca17571` |
| S2.5 Empty draft guard | DONE | `callJevEvaluation` exits immediately if draft is empty unless `probeReference: true`; commit `835d899` |
| S2.6 Golden outputs comparison | DONE | Output comparison and live Phase 2 runs complete |
| G1 Missing evidence at HEAD | DONE | `git status -sb`, `git log`, `node --check`, `run_hardened_test.js` (81/81 pass, arithmetic documented) |
| G2 Dead identifier safety check | DONE | `grep -n -w` confirms 0 free references; remaining `excerptComparison` and CSS references cataloged |
| G3 Live Phase 2 benchmark runs | DONE | Executed 4 runs: `phase2_run1.json`, `phase2_run2.json`, `phase2_hard_run1.json`, `phase2_hard_run2.json` with HEAD and userscript hash |
| G4 Phase 2 reference table | DONE | Recomputed worse-of-two reference table with full C4 flip definition, C7.6 top-bucket accuracy, and typo case scores |
| G5 Cochran-Armitage position trend test | WITHDRAWN | Withdrawn, replaced by P3 |
| G6 Invariant test & deviation list | DONE | Added live `critique_undersells_error` assertion (81/81 pass); full deviations listed |
| G7 Restore untrimmed userDraft in callJev | DONE | Fixed in `jpdb-ai.user.js`, 100% payload equality verified across 106 cases; commit `5c7d0d4` |
| GATE 2 | DONE | Approved by user with prerequisites P1-P4 (status updated from WAITING to DONE) |
| P1 Payload diff (6ae92ae to HEAD) | DONE | `prototype/bench/compare_payloads_p1.js`: all 150 cases compared; only target_vocab_handling & word_${i}_sense instructions differ |
| P2 Evaluation spec & runner | DONE | Created `prototype/bench/BENCH_SPEC.md` and `prototype/bench/evaluate_variant.js`; self-checks (P2 vs P2 and P1 vs P2) pass 100% |
| P3 Paired McNemar position analysis | DONE | `prototype/bench/run_mcnemar_analysis.py`: paired 2x2 tables, exact two-sided p-values, stratified by draft correctness |
| P4 Housekeeping | DONE | Updated `PROGRESS.md`, `BACKLOG.md` Item 3; verified sha256 & ISO timestamps for 5 result files |
| Part A.1 BENCH_SPEC.md coverage typo fix | DONE | Corrected Run 2 repeat coverage in `BENCH_SPEC.md` to 64.15% (34/53) and 34.09% (15/44) |
| Part A.2 Critique-Type Agreement criterion | DONE | Added criterion 7, `CRITIQUE_TYPE_MAP` to `BENCH_SPEC.md` and `evaluate_variant.js`; Phase 2 baseline disagreement: Test 1, Hard 2 |
| Part A.3 Interleaved Latency A/B runner | DONE | Implemented `--latency-ab` in `run_comprehensive_benchmark.js`; baseline vs baseline verified ($\Delta p95 = -18.87\%$) |
| Part A.4 Stratum wording & pre-registered prediction | DONE | Fixed stratum wording in `run_mcnemar_analysis.py`; added Section 6 pre-registered prediction to `BENCH_SPEC.md` |
| Part A.5 PROGRESS.md markers | DONE | Rows A11 and G5 marked with explicit pointers per instructions |
| B0 E1 Branch & commit freeze | DONE | Created `exp/e1-split-predicate`; committed frozen hash `e6a545cdcb14597ed4d78bd163dee157d83d8805` |
| B1 Userscript E1 predicate split | DONE | Replaced `predicate_mood_and_voice` with 4 single-judgment questions; accurate option first; fail-closed guards updated |
| B2 E1 Hardened test suite | DONE | 96/96 passed (81 baseline + 15 added); syntax checked |
| B3 E1 Payload diff check | DONE | `prototype/bench/compare_payloads_e1.js`: 150 cases verified; 0 unexpected diffs; 4 added, 1 removed; +1020 B mean |
| B4 Latency A/B test (E1 vs Phase 2) | DONE | 100 pairs / 200 calls: baseline p95=293.4ms, variant p95=291.0ms ($\Delta = -0.82\%$, PASS) |
| B5 E1 Live benchmark runs | BLOCKED | OpenRouter HTTP 402: Insufficient credits on account `user_2sJIEVBska9VKsvNdjPiQbV6Im2`; awaiting credit top-up / guidance |
| E1 Evaluation & adoption decision | WAITING | Blocked on B5 completion |
| E2 Applicability gating (complex conjugation) | TODO | Experiment report & adoption decision |
| E3 Option order | TODO | Experiment report & adoption decision |
| E4 Derived flawless | TODO | Experiment report & adoption decision |
| GATE 3 | TODO | Gate 3 summary report & STOP |
| S4.1 Deploy | TODO | Deploy after APPROVE DEPLOY |
| S4.2 In-situ port 9223 latency verification | TODO | Re-measure latency inside userscript on port 9223 before deploy |
| S5.1 Generalization proposal | TODO | Written design proposal |
