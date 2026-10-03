// Save golden outputs from baseline run 1 for all cases in cases.json

const fs = require('fs');
const path = require('path');

const cases = JSON.parse(fs.readFileSync('prototype/bench/cases.json', 'utf8'));
const r1 = JSON.parse(fs.readFileSync('prototype/bench/baseline_run1.json', 'utf8')).results;

const golden = {};
for (const c of cases) {
  const trial = r1.find(r => r.caseId === c.id && r.orderMode === 'original_r1');
  if (!trial) {
    throw new Error(`Missing baseline run for case ${c.id}`);
  }
  golden[c.id] = {
    caseId: c.id,
    split: c.split,
    label: c.label,
    overall: trial.overall,
    dynamicCritique: trial.dynamicCritique,
    critiqueSource: trial.critiqueSource,
    route: trial.route
  };
}

const outPath = path.join(__dirname, 'golden_baseline.json');
fs.writeFileSync(outPath, JSON.stringify(golden, null, 2), 'utf8');
console.log(`Saved golden baseline outputs for ${Object.keys(golden).length} cases to ${outPath}`);
