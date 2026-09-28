// A JVM suite records where a Node seam's would: the declared suite's directory
// in the checkout's cache layer, as sense's `testCoverageFile` names it.
//
// The build in `modules` is two Maven modules, run with `-Dva.suite=unit`
// instead of a `va.out`. The containers mount the work directory at its own
// path, because the layer is keyed by the checkout's absolute path.
//
// Asserts that:
//   - the agent's layer path is sense's, in the primary checkout, in a worktree
//     of it, and in a repository that declares no suites;
//   - a suite the configuration does not declare, no suite once suites are
//     declared, a suite named while none are, and `va.out` with `va.suite`, each
//     fail the JVM before a test runs;
//   - both modules' JVMs write one record, and an edit in either module selects
//     from it;
//   - a worktree's first run keeps the base's rows for the classes it did not run.
//
// Usage: node suite.mjs <work dir> <agent bin dir>
// Maven's repository is <agent bin dir>/../m2, where jvm/build.sh leaves it.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [work, bin] = process.argv.slice(2).map((p) => resolve(p));
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const { narrowByExecution, testCoverageFile } = await import(
  pathToFileURL(join(repoRoot, 'packages', 'sense', 'dist', 'test-selection', 'index.js')).href
);
const m2 = resolve(bin, '..', 'm2');
const image = 'maven:3.9-eclipse-temurin-21';
const primary = join(work, 'modules');
const worktree = join(work, 'worktree');
const bare = join(work, 'bare');
const xdg = join(work, 'xdg');
// The layer lives under the work directory on both sides of the comparison.
process.env['VARIANCE_AUTHORITY_CACHE'] = xdg;
const calc = 'calc/src/main/java/org/example/calc/Calc.java';
const words = 'words/src/main/java/org/example/words/Words.java';
const test = (module, name) => `${module}/src/test/java/org/example/${module}/${name}.java`;

function git(at, ...args) {
  return execFileSync('git', ['-C', at, ...args], { encoding: 'utf8' });
}

/** A container with the work directory at its own path, started in `at`. */
function docker(at, ...command) {
  return spawnSync('docker', [
    'run', '--rm', '-v', `${work}:${work}`, '-v', `${bin}:/va:ro`, '-v', `${m2}:/root/.m2`, '-w', at,
    '-e', `VARIANCE_AUTHORITY_CACHE=${xdg}`, image, ...command,
  ], { encoding: 'utf8' });
}

/** The record the agent would write from `at`, or its refusal. */
function agentRecord(at, ...properties) {
  const run = docker(at, 'java', ...properties, '-cp', '/va/variance-agent.jar', 'dev.varianceauthority.jvm.RecordLocation');
  return run.status === 0 ? run.stdout.trim() : { refused: run.stderr };
}

function mvn(at, ...args) {
  const run = docker(at, 'mvn', '-q', '-B', 'test', ...args);
  assert.equal(run.status, 0, run.stdout + run.stderr);
}

/** What a one-line edit of `file` in `at` selects from `record`. */
async function selects(at, record, file, from, to) {
  const path = join(at, file);
  const text = readFileSync(path, 'utf8');
  writeFileSync(path, text.replace(from, to));
  try {
    return (await narrowByExecution(record, git(at, 'diff'))).entered;
  } finally {
    writeFileSync(path, text);
  }
}

rmSync(work, { recursive: true, force: true });
mkdirSync(xdg, { recursive: true });
cpSync(join(here, 'modules'), primary, { recursive: true });
const pom = join(primary, 'pom.xml');
writeFileSync(pom, readFileSync(pom, 'utf8').replace('-Dva.out=${project.build.directory}/va', '-Dva.suite=unit'));
writeFileSync(join(primary, '.gitignore'), 'target/\n');
writeFileSync(join(primary, 'variance.config.json'), JSON.stringify({
  suites: { unit: { kind: 'unit' }, journeys: { kind: 'e2e' } },
}, null, 2));
git(primary, 'init', '-q');
git(primary, 'add', '.');
git(primary, '-c', 'user.name=va', '-c', 'user.email=va@example.org', 'commit', '-qm', 'baseline');
git(primary, 'worktree', 'add', '-q', worktree);
mkdirSync(bare);
git(bare, 'init', '-q');

// The same derivation on both sides.
const record = testCoverageFile(primary, { suite: 'unit' });
assert.equal(agentRecord(primary, '-Dva.suite=unit'), record);
assert.equal(agentRecord(join(primary, 'calc'), '-Dva.suite=unit'), record, 'a module records into its checkout\'s layer');
const worktreeRecord = testCoverageFile(worktree, { suite: 'unit' });
assert.match(worktreeRecord, /\/\.work\/[0-9a-f]{32}\/suites\/unit\/coverage\.bin$/);
assert.equal(agentRecord(worktree, '-Dva.suite=unit'), worktreeRecord);
assert.equal(agentRecord(bare), testCoverageFile(bare));
console.log('ok   the agent\'s layer path is sense\'s: primary, module, worktree, no suites');

assert.match(agentRecord(primary, '-Dva.suite=pictures').refused, /the suite "pictures" is not declared in .*"journeys", "unit"/);
assert.match(agentRecord(primary).refused, /declares the suites "journeys", "unit", and none is named/);
assert.match(agentRecord(bare, '-Dva.suite=unit').refused, /the suite "unit" is named, and .* declares no suites/);
const both = docker(primary, 'java', '-javaagent:/va/variance-agent.jar', `-Dva.out=${work}/out`, '-Dva.suite=unit', '-version');
assert.notEqual(both.status, 0);
assert.match(both.stderr, /both say where this run records; name one/);
console.log('ok   an undeclared suite, no suite, a suite with none declared, and va.out with va.suite are refused');

mvn(primary);
assert.ok(existsSync(record), `no record at ${record}`);
assert.deepEqual(await selects(primary, record, calc, 'return a + b;', 'return a - b;'), [test('calc', 'AddTest')]);
assert.deepEqual(await selects(primary, record, words, '+ "!"', '+ "?"'), [test('words', 'ShoutTest')]);
console.log('ok   both modules\' JVMs write one record, and an edit in either selects from it');

mvn(worktree, '-Dtest=AddTest', '-Dsurefire.failIfNoSpecifiedTests=false');
assert.ok(existsSync(worktreeRecord), `no record at ${worktreeRecord}`);
assert.deepEqual(await selects(worktree, worktreeRecord, words, '+ "!"', '+ "?"'), [test('words', 'ShoutTest')]);
assert.deepEqual(await selects(worktree, worktreeRecord, calc, 'return a * b;', 'return b * a;'), [test('calc', 'MulTest')]);
console.log('ok   a worktree\'s first run keeps the base\'s rows for the classes it did not run');
