# Stratification: drafts labeled error vs drafts labeled correct
# Note: On a draft labeled as containing an error, most questions' correct answer is still the accurate option.
import json
import math

def binom_test(k, n, p=0.5):
    if n == 0:
        return 1.0
    obs = math.comb(n, k) * (p ** k) * ((1 - p) ** (n - k))
    p_val = 0.0
    for i in range(n + 1):
        prob = math.comb(n, i) * (p ** i) * ((1 - p) ** (n - i))
        if prob <= obs + 1e-12:
            p_val += prob
    return min(1.0, p_val)

ACCURATE_OPTIONS = {
    "is_flawless": None, # noul, not choice
    "english_typo_check": "no_typos_clean_english",
    "grade_bracket": "10_flawless",
    "severity": None, # score, not choice
    "sentence_critique_summary": "no_flaws_accurate",
    "benefactive_direction": "correct_benefactive_or_not_applicable",
    "target_vocab_handling": "natural_accurate_sense",
    "predicate_mood_and_voice": "correct_or_not_applicable",
    "predicate_complex_conjugation": "accurate_or_not_stacked",
    "interrogative_check": "correct_or_no_interrogative",
    "question_type_and_scope": "correct_question_type_and_pronoun",
    "polarity_check": "polarity_preserved",
    "suspected_typo_word": "none"
}

def get_accurate_opt(q_key):
    if q_key in ACCURATE_OPTIONS:
        return ACCURATE_OPTIONS[q_key]
    if q_key.startswith("word_") and q_key.endswith("_sense"):
        return "natural_correct_sense"
    if q_key.startswith("word_") and q_key.endswith("_grammar"):
        return "correct_grammar_or_not_applicable"
    return None

def analyze_paired_positions(run_file, cases_file, split_filter=None):
    with open(cases_file) as f:
        cases_list = json.load(f)
    if split_filter:
        cases_list = [c for c in cases_list if c.get("split") == split_filter]
    case_map = {c["id"]: c for c in cases_list}

    with open(run_file) as f:
        data = json.load(f)["results"]

    by_case = {}
    for r in data:
        if r["caseId"] in case_map:
            by_case.setdefault(r["caseId"], {})[r["orderMode"]] = r

    tables = {
        "all": {"n11": 0, "n10": 0, "n01": 0, "n00": 0},
        "correct_draft": {"n11": 0, "n10": 0, "n01": 0, "n00": 0},
        "error_draft": {"n11": 0, "n10": 0, "n01": 0, "n00": 0}
    }

    # Also per-question breakdown
    per_q = {}

    for cid, modes in by_case.items():
        tc = case_map[cid]
        is_correct_draft = tc["label"] in ["flawless", "valid_paraphrase"]
        cat = "correct_draft" if is_correct_draft else "error_draft"

        r1 = modes.get("original_r1")
        rev = modes.get("reversed")
        if not r1 or not rev or not r1.get("answers") or not rev.get("answers"):
            continue

        for q_key, r1_ans in r1["answers"].items():
            acc_opt = get_accurate_opt(q_key)
            if not acc_opt:
                continue
            rev_ans = rev["answers"].get(q_key)
            if not rev_ans:
                continue

            orig_chose_acc = (r1_ans.get("choice") == acc_opt)
            rev_chose_acc = (rev_ans.get("choice") == acc_opt)

            cell = "n11" if (orig_chose_acc and rev_chose_acc) else \
                   "n10" if (orig_chose_acc and not rev_chose_acc) else \
                   "n01" if (not orig_chose_acc and rev_chose_acc) else "n00"

            tables["all"][cell] += 1
            tables[cat][cell] += 1

            if q_key not in per_q:
                per_q[q_key] = {"n11": 0, "n10": 0, "n01": 0, "n00": 0}
            per_q[q_key][cell] += 1

    return tables, per_q

runs = [
    ("Phase 1 Run 1 Standard", "prototype/bench/baseline_run1.json", "prototype/bench/cases.json", None),
    ("Phase 1 Run 2 Standard", "prototype/bench/baseline_run2.json", "prototype/bench/cases.json", None),
    ("Phase 1 Run 1 Hard", "prototype/bench/baseline_hard_run1.json", "prototype/bench/hard_cases.json", None),
    ("Phase 1 Run 2 Hard", "prototype/bench/baseline_hard_run2.json", "prototype/bench/hard_cases.json", None),
    ("Phase 2 Run 1 Standard", "prototype/bench/phase2_run1.json", "prototype/bench/cases.json", None),
    ("Phase 2 Run 2 Standard", "prototype/bench/phase2_run2.json", "prototype/bench/cases.json", None),
    ("Phase 2 Run 1 Hard", "prototype/bench/phase2_hard_run1.json", "prototype/bench/hard_cases.json", None),
    ("Phase 2 Run 2 Hard", "prototype/bench/phase2_hard_run2.json", "prototype/bench/hard_cases.json", None),
]

for name, rf, cf, sp in runs:
    t, per_q = analyze_paired_positions(rf, cf, sp)
    print("=" * 60)
    print(name)
    print("=" * 60)
    for k in ["all", "correct_draft", "error_draft"]:
        tab = t[k]
        n11, n10, n01, n00 = tab["n11"], tab["n10"], tab["n01"], tab["n00"]
        n_disc = n10 + n01
        pval = binom_test(n10, n_disc, 0.5) if n_disc > 0 else 1.0
        n_tot = n11 + n10 + n01 + n00
        print(f"Group [{k}] (n={n_tot}):")
        print(f"  Contingency Table: [[{n11}, {n10}], [{n01}, {n00}]]")
        print(f"  n10 (orig=acc, rev!=acc): {n10}")
        print(f"  n01 (rev=acc, orig!=acc): {n01}")
        print(f"  Discordant pairs (n_disc): {n_disc}")
        print(f"  Exact McNemar p-value:    {pval:.4f}")
        print()
