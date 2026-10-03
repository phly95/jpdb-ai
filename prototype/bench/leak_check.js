// Comprehensive leak check script with positive controls
// Scope: All tracked files outside prototype/bench/ + all git history outside prototype/bench/

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 1. Determine tracked files outside prototype/bench/
const trackedFiles = execSync('git ls-files', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(f => f && !f.startsWith('prototype/bench/'));

console.log(`======================================================================`);
console.log(`🔍 LEAK CHECK SCRIPT (Scope: Tracked files outside prototype/bench/ & git log -S excluding prototype/bench/)`);
console.log(`Tracked files scanned: ${trackedFiles.length} files`);
console.log(`======================================================================\n`);

// Read all tracked file contents
const trackedFileContents = {};
for (const f of trackedFiles) {
  if (fs.existsSync(f)) {
    try {
      trackedFileContents[f] = fs.readFileSync(f, 'utf8');
    } catch (e) {}
  }
}

function checkSentence(s, id, split) {
  const leaks = [];

  // 1. Check in tracked files outside prototype/bench/
  for (const [file, content] of Object.entries(trackedFileContents)) {
    if (content.includes(s)) {
      leaks.push({ type: 'tracked_file', location: file });
    }
  }

  // 2. Check in git history outside prototype/bench/
  try {
    // Exact git log -S command with pathspec exclusion
    const cmd = `git log -S "${s}" --oneline -- ":(exclude)prototype/bench"`;
    const gitOut = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (gitOut.length > 0) {
      const commit = gitOut.split('\n')[0];
      leaks.push({ type: 'git_history', location: commit });
    }
  } catch (err) {}

  return leaks;
}

// -------------------------------------------------------------
// POSITIVE CONTROLS
// -------------------------------------------------------------
console.log(`--- Running Positive Controls ---`);
const positiveControls = [
  {
    id: "pos_control_userjs",
    split: "positive_control",
    jp: "病院で二時間も待たされた",
    expectedIn: "jpdb-ai.user.js"
  },
  {
    id: "pos_control_committed_file",
    split: "positive_control",
    jp: "公園で可愛い猫を見つけた",
    expectedIn: "prototype/test_cases.json"
  }
];

let positiveControlPassed = true;
for (const pc of positiveControls) {
  const hits = checkSentence(pc.jp, pc.id, pc.split);
  if (hits.length === 0) {
    console.error(`❌ POSITIVE CONTROL FAILED: "${pc.jp}" was NOT detected by the leak checker!`);
    positiveControlPassed = false;
  } else {
    console.log(`✅ Positive control verified: "${pc.jp}" detected in: ${hits.map(h => `${h.type}: ${h.location}`).join(', ')}`);
  }
}

if (!positiveControlPassed) {
  console.error(`Checker is broken. Aborting.`);
  process.exit(1);
}

// -------------------------------------------------------------
// AUDIT TEST AND HARD SPLIT SENTENCES (97 total)
// -------------------------------------------------------------
console.log(`\n--- Auditing Test and Hard Split Sentences ---`);
const cases = JSON.parse(fs.readFileSync('prototype/bench/cases.json', 'utf8'));
const hardCases = JSON.parse(fs.readFileSync('prototype/bench/hard_cases.json', 'utf8'));

const testSentences = cases.filter(c => c.split === 'test').map(c => ({ id: c.id, split: 'test', jp: c.japanese }));
const hardSentences = hardCases.map(c => ({ id: c.id, split: 'hard', jp: c.japanese }));
const allToCheck = [...testSentences, ...hardSentences];

let leaksFound = 0;
for (const item of allToCheck) {
  const hits = checkSentence(item.jp, item.id, item.split);
  if (hits.length > 0) {
    leaksFound++;
    console.error(`❌ [LEAK] Sentence leaked for ${item.id} (${item.split}): "${item.jp}" in: ${hits.map(h => `${h.type}: ${h.location}`).join(', ')}`);
  }
}

console.log(`\n======================================================================`);
if (leaksFound === 0) {
  console.log(`✅ LEAK CHECK PASSED: 0 leaks found across all ${allToCheck.length} sentences (${testSentences.length} test + ${hardSentences.length} hard).`);
} else {
  console.error(`❌ LEAK CHECK FAILED: ${leaksFound} leak(s) detected.`);
  process.exit(1);
}
console.log(`======================================================================`);
