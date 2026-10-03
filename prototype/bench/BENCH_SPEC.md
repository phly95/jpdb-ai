# JPDB AI Translation Grading Benchmark Specification (BENCH_SPEC.md)

## 1. Overview and Purpose
This document defines the formal adoption criteria, evaluation metrics, and protocol for all prompt, instruction, and routing variants evaluated on Jev-1.13 in `jpdb-ai.user.js`.
Every experimental variant (E1–E4) is tested against these strict acceptance criteria using `prototype/bench/evaluate_variant.js`.

---

## 2. Dataset Splits and Ground Truth
The evaluation uses two frozen benchmark splits:
1. **Standard Test Split (`test`)**: 53 cases in `prototype/bench/cases.json` (SHA-256: `6ebe4cdfc55e9ea8d88fa7b26e0eb24f2b1860d5b40cf347e335fbafae4a22ad`).
   - 6 `flawless`
   - 12 `valid_paraphrase`
   - 3 `typo_only`
   - 12 `critical_error:voice_agent_recipient`
   - 10 `critical_error:tense_aspect_polarity`
   - 10 `moderate_error`
2. **Hard Split (`hard`)**: 44 cases in `prototype/bench/hard_cases.json` (SHA-256: `4d67a85335d85a7a1809bfb93604e1252f69b085001c5a37700935e7a8feddf7`).
   - 4 `flawless`
   - 8 `valid_paraphrase`
   - 0 `typo_only`
   - 14 `subtle_error:particle_scope_aspect`
   - 18 `divergence_jev_vs_llm:modal_pragmatic`

---

## 3. Evaluation Conditions
Each case is evaluated across 6 conditions (a total of 318 calls on test, 264 calls on hard, per live run):
1. `original_r1`: Original question option order (Repeat 1)
2. `original_r2`: Original question option order (Repeat 2)
3. `original_r3`: Original question option order (Repeat 3)
4. `reversed`: Exact reversal of all choice options
5. `shuffle_s1`: Seeded pseudo-random shuffle (PRNG seed 1337)
6. `shuffle_s2`: Seeded pseudo-random shuffle (PRNG seed 424242)

Each variant evaluation requires **two independent live runs** (Run 1 and Run 2) on both splits.

---

## 4. Formal Metric Definitions and Adoption Rules

### 4.1 Decision Flip Rate (Case-Level)
- **Definition**: A case is flipped if ANY of `isFastPath` (boolean), `overall` (1-10 score), or `critiqueSource` (string) differs across the 4 distinct order conditions (`original_r1`, `reversed`, `shuffle_s1`, `shuffle_s2`).
- **Calculation**: $\text{Flip Rate} = \frac{\text{Number of flipped cases}}{\text{Total cases in split}} \times 100\%$
- **Adoption Ceiling**: $\text{Flip Rate}_{\text{variant}} \le \max(\text{Flip Rate}_{\text{base\_r1}}, \text{Flip Rate}_{\text{base\_r2}}) + 5.0\%$.
- **Rule**: Must PASS on both Run 1 and Run 2 for both splits.

### 4.2 Fast-Path Coverage (Case-Level Majority)
- **Definition**: A case is counted as covered if the majority ($\ge 2$ of 3) of original-order repeats (`original_r1`, `original_r2`, `original_r3`) route to a fast path (`isFastPath === true`, i.e., `flawless_fast_path`, `typo_fast_path`, or `critique_fast_path`).
- **Calculation**: $\text{Coverage}_{\text{maj}} = \frac{\text{Cases with } \ge 2\text{ fast-path repeats}}{\text{Total cases in split}} \times 100\%$.
- **Adoption Floor**: $\text{Coverage}_{\text{maj, variant}} \ge \min(\text{Coverage}_{\text{maj, base\_r1}}, \text{Coverage}_{\text{maj, base\_r2}}) - 3.0\%$.
- **Informational**: First-repeat coverage (`original_r1` fast-path rate) is also recorded and printed.

### 4.3 False Deductions (Case-Level Majority on Valid Translations)
- **Definition**: Evaluated on valid translations only (`label` $\in \{\text{'flawless'}, \text{'valid\_paraphrase'}\}$, excluding `typo_only`). A valid case is a false deduction if its majority `overall` score across the 3 original-order repeats is $< 9$.
- **Calculation**: Number of valid cases failing majority score threshold ($\text{score} < 9$).
- **Adoption Margin**: $\text{Count}_{\text{variant}} \le \max(\text{Count}_{\text{base\_r1}}, \text{Count}_{\text{base\_r2}}) + 1$ extra failing case.

### 4.4 Typo-Only Handling
- **Definition**: Evaluated on `typo_only` cases (3 cases in standard test split).
- **Adoption Criterion**: All typo cases must maintain majority score $\ge 8$ and route to a typo critique source (`typo_fast_path` / `english_typo_check`). Performance must be not worse than baseline (3/3 pass).

### 4.5 False-Flawless (Zero-Tolerance Hard Ceiling)
- **Definition**: Evaluated on error cases (all cases where `label` $\notin \{\text{'flawless'}, \text{'valid\_paraphrase'}, \text{'typo\_only'}\}$).
- **Failure Trigger**: An error case is classified as false-flawless if in **ANY** of the 6 evaluated conditions (`original_r1`, `original_r2`, `original_r3`, `reversed`, `shuffle_s1`, `shuffle_s2`) it achieves:
  1. `overall === 10`, OR
  2. `isStrict10Consensus === true`, OR
  3. `route === 'flawless_fast_path'`.
- **Adoption Hard Ceiling**: Number of false-flawless cases must not exceed baseline ($0$). Any newly false-flawless case is an **AUTOMATIC FAIL**; the script immediately flags it and prints its case ID.

### 4.6 Top-Bucket Accuracy (Confidence $\in [0.90, 1.00]$, Fast-Path Calls)
- **Definition of Wrong Call**: A fast-path call is wrong if its routed fast-path decision contradicts the case's ground-truth label category (i.e., flawless path on an error case, critique path on a valid draft, or typo path on non-typo).
- **Target Calls**: All individual calls routed to fast path (`isFastPath === true`) with confidence $\ge 0.90$ (measured by `triggeringConfidence` for critique fast path, or `bracketConfidence` for flawless fast path).
- **Adoption Rule**: The number of wrong calls must not exceed baseline ($0$). With a 100.00% baseline, any wrong call in this bucket ($> 0$ wrong calls) is an **AUTOMATIC FAIL**.
- **Reporting**: Report wrong calls count, total top-bucket calls, and percentage accuracy.

### 4.7 Latency and Perceived Latency
- **Jev Latency**: p95 Jev request latency must be $\le 400\text{ ms}$ AND at most $15\%$ above baseline p95 over at least 100 interleaved calls.
- **User-Perceived Latency (Informational)**: Reported using the formula:
  $$T_{\text{user}} = \text{coverage} \cdot T_{\text{fast}} + (1 - \text{coverage}) \cdot (T_{\text{fast}} + L)$$
  where $T_{\text{fast}}$ is mean Jev latency, $\text{coverage}$ is fraction of cases covered by fast path, and $L \in \{500\text{ ms}, 1000\text{ ms}, 2000\text{ ms}\}$ models fallback LLM response time.

### 4.8 One-Shot Rule
A candidate variant receives exactly **ONE** live evaluation on the test and hard splits (consisting of two live runs each). All debugging and iteration must occur on the `dev` split only. If a variant is changed after inspecting test or hard split results, it constitutes a new variant, must be counted as such, and requires explicit user authorization before execution.

### 4.9 Critique-Type Agreement (Critical Error Cases)
- **Mapping from Critique Code / critiqueSource to Ground-Truth Critical Label Types**:
  1. `passive_reversal`: `predicate_mood_and_voice` with `passive_vs_active_error` OR `sentence_critique_summary` with `passive_voice_reversed` / `agent_or_passive_reversed` (critique code: `passive_voice_reversed` / `agent_or_passive_reversed`).
  2. `polarity_inversion`: `polarity_check` with `polarity_inverted` (critique code: `polarity_inverted`).
  3. `benefactive_reversal`: `benefactive_direction` with `recipient_reversed_self_vs_other` OR `sentence_critique_summary` with `wrong_benefactive_or_recipient` (critique code: `wrong_benefactive_or_recipient`).
  4. `indefinite_vs_wh`: `question_type_and_scope` with `confused_indefinite_with_wh_word` OR `sentence_critique_summary` with `interrogative_or_question_error` (critique code: `confused_indefinite_with_wh_word`).
  5. `causative_passive_inversion`: `predicate_complex_conjugation` with `causative_passive_inverted` (critique code: `causative_passive_inverted`).
  6. `numeral_mismatch`: `numeral_mismatch` critique source or code (`numeral_or_counter_mismatch`).
- **Metric**: Among `critical_error:<type>` cases whose majority-of-3 original-order route is a fast path, count those whose critique does not map to the labeled type ("type-disagreeing cases").
- **Adoption Criterion**: The number of type-disagreeing cases must not exceed the baseline's worse-of-two count. Any newly type-disagreeing case must be reported by ID. Moderate-error cases carry no type label and are excluded.

### 4.10 Interleaved Latency A/B Measurement
- Evaluated via `--latency-ab` mode in the benchmark harness: concurrency 1, alternating baseline-code payload and variant-code payload sequentially across identical cases for at least 100 pairs (200 calls total).
- Criterion: Jev p95 latency on the variant arm must be $\le 400\text{ ms}$ AND at most $15\%$ above the baseline arm p95.

---

## 5. Phase 2 Baseline Reference Values

| Split | Metric | Phase 2 Run 1 | Phase 2 Run 2 | Worse Baseline Reference | Adoption Requirement / Margin |
|---|---|---|---|---|---|
| **Test** | **Decision Flip Rate** | 11.32% (6/53) | 13.21% (7/53) | **13.21%** | **$\le 18.21\%$** (Max +5.0%) |
| **Test** | **Fast-Path Coverage (Maj)** | 64.15% (34/53) | 64.15% (34/53) | **64.15%** | **$\ge 61.15\%$** (Floor -3.0%) |
| *Test* | *Fast-Path Coverage (r1)* | 67.92% (36/53) | 64.15% (34/53) | 64.15% | Informational |
| **Test** | **False Deductions** | 1/18 (test_flawless_14) | 1/18 (test_flawless_14) | **1/18** | **$\le 2/18$** (At most +1 case) |
| **Test** | **Typo-Only Pass Rate** | 3/3 (100.0%) | 3/3 (100.0%) | **3/3** | **$\ge 3/3$** (Not worse than baseline) |
| **Test** | **False-Flawless Cases** | 0/32 | 0/32 | **0/32** | **$\le 0/32$** (Hard ceiling: 0) |
| **Test** | **Top-Bucket Accuracy** | 0 wrong (180/180, 100%) | 0 wrong (185/185, 100%) | **0 wrong** | **0 wrong** (Any wrong is FAIL) |
| **Test** | **Critique-Type Disagreement** | 1/5 FP (test_crit_benefactive_01) | 1/5 FP (test_crit_benefactive_01) | **1 case** | **$\le 1$ case** (Not worse than baseline) |
| **Hard** | **Decision Flip Rate** | 31.82% (14/44) | 27.27% (12/44) | **31.82%** | **$\le 36.82\%$** (Max +5.0%) |
| **Hard** | **Fast-Path Coverage (Maj)** | 34.09% (15/44) | 36.36% (16/44) | **34.09%** | **$\ge 31.09\%$** (Floor -3.0%) |
| *Hard* | *Fast-Path Coverage (r1)* | 34.09% (15/44) | 34.09% (15/44) | 34.09% | Informational |
| **Hard** | **False Deductions** | 2/18 (hard_div_07, subtle_17) | 2/18 (hard_div_07, subtle_17) | **2/18** | **$\le 3/18$** (At most +1 case) |
| **Hard** | **Typo-Only Pass Rate** | N/A (0 cases) | N/A (0 cases) | **N/A** | N/A |
| **Hard** | **False-Flawless Cases** | 0/26 | 0/26 | **0/26** | **$\le 0/26$** (Hard ceiling: 0) |
| **Hard** | **Top-Bucket Accuracy** | 0 wrong (74/74, 100%) | 0 wrong (76/76, 100%) | **0 wrong** | **0 wrong** (Any wrong is FAIL) |
| **Hard** | **Critique-Type Disagreement** | 2/3 FP (subtle_04, subtle_20) | 2/3 FP (subtle_04, subtle_20) | **2 cases** | **$\le 2$ cases** (Not worse than baseline) |

---

## 6. Pre-Registered Prediction (Pre-E3)
Across the 8 run/split combinations, $n_{01} > n_{10}$ in all 8, with $p < 0.05$ in 6 of 8 runs (these runs share identical test cases, so observations are not independent). This pattern demonstrates that choices systematically shift toward whichever option is listed last.
**Pre-Registered Prediction**: Moving the accurate option to the last position (the error-options-first arm of E3) will increase the rate at which the accurate option is chosen, thereby raising the operational risk of missed translation errors (false flawless / under-deductions).

