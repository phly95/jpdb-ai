/**
 * Dataset Content Hash Verifier (prototype/bench/verify_hashes.js)
 * 
 * Serialization Specification:
 * - Subset Selection:
 *   - Test split: Selected from cases.json where c.split === 'test', sorted deterministically by id ascending (a.id.localeCompare(b.id)).
 *   - Hard split: Selected from all entries in hard_cases.json, sorted deterministically by id ascending (a.id.localeCompare(b.id)).
 * - Included Fields: All case object fields as defined in the JSON file (id, split, japanese, target, meanings, reference, draft, label, label_status, notes).
 * - Key Order: Native JSON key order as parsed from the JSON file.
 * - Whitespace & Newlines: Compact JSON (JSON.stringify without indentation or extra whitespace, no trailing newline before hashing).
 * - Hash Function: crypto.createHash('sha256').update(serializedString, 'utf8').digest('hex')
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function computeHashForArray(arr) {
  const sorted = arr.slice().sort((a, b) => a.id.localeCompare(b.id));
  const serialized = JSON.stringify(sorted);
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

function verify() {
  const casesFile = path.join(__dirname, 'cases.json');
  const hardFile = path.join(__dirname, 'hard_cases.json');
  const testHashFile = path.join(__dirname, 'test.sha256');
  const hardHashFile = path.join(__dirname, 'hard.sha256');

  const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  const hardCases = JSON.parse(fs.readFileSync(hardFile, 'utf8'));

  const storedTestHash = fs.readFileSync(testHashFile, 'utf8').trim();
  const storedHardHash = fs.readFileSync(hardHashFile, 'utf8').trim();

  const testCases = cases.filter(c => c.split === 'test');
  const recomputedtestHash = computeHashForArray(testCases);
  const recomputedHardHash = computeHashForArray(hardCases);

  const EXPECTED_TEST = '6ebe4cd2a87599f93c37d49e10eb88bd2028aca8ab9ef524ae5697086eb2ef13';
  const EXPECTED_HARD = '4d67a85335d85a7a1809bfb93604e1252f69b085001c5a37700935e7a8feddf7';

  console.log(`======================================================================`);
  console.log(`🔒 DATASET CONTENT HASH VERIFICATION`);
  console.log(`======================================================================\n`);

  console.log(`TEST SPLIT (${testCases.length} cases from ${casesFile}):`);
  console.log(`  Stored in test.sha256:   ${storedTestHash}`);
  console.log(`  Recomputed content hash: ${recomputedtestHash}`);
  console.log(`  Expected benchmark hash: ${EXPECTED_TEST}`);
  const testMatch = (storedTestHash === recomputedtestHash) && (recomputedtestHash === EXPECTED_TEST);
  console.log(`  Verification result:     ${testMatch ? '✅ MATCH' : '❌ MISMATCH'}\n`);

  console.log(`HARD SPLIT (${hardCases.length} cases from ${hardFile}):`);
  console.log(`  Stored in hard.sha256:   ${storedHardHash}`);
  console.log(`  Recomputed content hash: ${recomputedHardHash}`);
  console.log(`  Expected benchmark hash: ${EXPECTED_HARD}`);
  const hardMatch = (storedHardHash === recomputedHardHash) && (recomputedHardHash === EXPECTED_HARD);
  console.log(`  Verification result:     ${hardMatch ? '✅ MATCH' : '❌ MISMATCH'}\n`);

  if (!testMatch || !hardMatch) {
    console.error('CRITICAL: Content hash mismatch detected! Dataset has been altered.');
    process.exit(1);
  } else {
    console.log(`======================================================================`);
    console.log(`✅ ALL DATASET CONTENT HASHES VERIFIED IDENTICAL`);
    console.log(`======================================================================`);
  }
}

verify();
