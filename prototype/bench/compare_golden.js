// Compare golden baseline outputs against current parseJevScores on baseline run 1 answers
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden_baseline.json'), 'utf8'));
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
const r1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline_run1.json'), 'utf8')).results;

const userscriptPath = path.join(__dirname, '../../jpdb-ai.user.js');
const src = fs.readFileSync(userscriptPath, 'utf8');
const code = src.replace(/\}\)\(\);\s*$/, `
  globalThis.__X__={parseJevScores: typeof parseJevScores!=='undefined'?parseJevScores:undefined, getJapaneseSentenceWords: typeof getJapaneseSentenceWords!=='undefined'?getJapaneseSentenceWords:undefined};
})();`);
const sb = { location: { pathname: '/review' }, document: { readyState: 'loading', addEventListener() {} }, GM_getValue: () => '', GM_setValue() {}, GM_registerMenuCommand() {}, console, Intl, __X__: null };
sb.window = sb; sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(code, sb);
const { parseJevScores, getJapaneseSentenceWords } = sb.__X__;

const changes = [];
for (const c of cases) {
  const trial = r1.find(r => r.caseId === c.id && r.orderMode === 'original_r1');
  const allWords = getJapaneseSentenceWords(c.japanese, c.target);
  const contentWords = (allWords || []).filter((w) => w && w.length > 1 && !['から', 'まで', 'より', 'けど', 'ので', 'のに', 'んだ'].includes(w));
  const words = contentWords.length > 0 ? contentWords : allWords;
  const cleanTarget = (c.target || '').replace(/\([^)]*\)/g, '').trim();

  const metrics = parseJevScores(trial.answers, words, cleanTarget, c.draft, c.reference, c.japanese);

  let route = 'fallback';
  if (metrics.overall === 10 && metrics.isStrict10Consensus) {
    route = 'flawless_fast_path';
  } else if (metrics.typoFastPathOk) {
    route = 'typo_fast_path';
  } else if (metrics.critiqueFastPathOk && metrics.triggeringConfidence >= 0.75 && metrics.bracketConfidence >= 0.65) {
    route = 'critique_fast_path';
  }

  const g = golden[c.id];
  const diffs = {};
  if (g.overall !== metrics.overall) diffs.overall = { before: g.overall, after: metrics.overall };
  if (g.route !== route) diffs.route = { before: g.route, after: route };
  if (g.dynamicCritique !== metrics.dynamicCritique) diffs.dynamicCritique = { before: g.dynamicCritique, after: metrics.dynamicCritique };
  if (g.critiqueSource !== metrics.critiqueSource) diffs.critiqueSource = { before: g.critiqueSource, after: metrics.critiqueSource };

  if (Object.keys(diffs).length > 0) {
    changes.push({ caseId: c.id, split: c.split, diffs });
  }
}

console.log('Total cases compared:', Object.keys(golden).length);
console.log('Changed cases count:', changes.length);
if (changes.length > 0) {
  console.log('Changes detail:', JSON.stringify(changes, null, 2));
  process.exit(1);
} else {
  console.log('ALL 106 GOLDEN OUTPUTS ARE 100% IDENTICAL!');
}
