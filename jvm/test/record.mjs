// What a Maven build leaves in `va.out`, across forks, reruns and edits.
//
// The build in `modules` is two Maven modules with no `includes` and no
// per-fork directory. `calc` runs each test class in a JVM of its own, two at
// a time, and every one of them writes into the same `va.out`.
//
// Asserts that:
//   - names in coverage.va are relative to the checkout, whichever module ran,
//     so a diff at the checkout root selects by them;
//   - with no `includes`, the checkout's own classes are probed and nothing
//     else, so no row is incomplete;
//   - every fork's classes are in the record exactly once;
//   - a rerun replaces rows instead of adding them, and deletes the records it
//     superseded;
//   - `-Dtest=` keeps the rows of the classes it did not run;
//   - an edit to a file a record read retires that record.
//
// Usage: node record.mjs <work dir> <agent bin dir>
// Maven's repository is <agent bin dir>/../m2, where jvm/build.sh leaves it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [work, bin] = process.argv.slice(2).map((p) => resolve(p));
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const { narrowByExecution } = await import(
  pathToFileURL(join(repoRoot, 'packages', 'sense', 'dist', 'test-selection', 'index.js')).href
);
const modules = join(work, 'modules');
const m2 = resolve(bin, '..', 'm2');
const image = 'maven:3.9-eclipse-temurin-21';
const calc = 'calc/src/main/java/org/example/calc/Calc.java';
const words = 'words/src/main/java/org/example/words/Words.java';
const test = (module, name) => `${module}/src/test/java/org/example/${module}/${name}.java`;

function git(...args) {
  return execFileSync('git', ['-C', modules, ...args], { encoding: 'utf8' });
}

/** One `mvn test` in the checkout, with the agents at /va. */
function mvn(...args) {
  execFileSync('docker', [
    'run', '--rm', '-v', `${modules}:/repo`, '-v', `${bin}:/va:ro`, '-v', `${m2}:/root/.m2`, '-w', '/repo',
    image, 'mvn', '-q', '-B', 'test', ...args,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The owners of the merged record's class rows, in order, duplicates kept. */
function owners(module) {
  return readFileSync(join(modules, module, 'target', 'va', 'record.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => !row.owner.startsWith('between'))
    .map((row) => {
      assert.deepEqual(row.unknown ?? [], [], `${row.owner} probed a class that is not the checkout's`);
      return row.owner;
    })
    .sort();
}

function records(module) {
  return readdirSync(join(modules, module, 'target', 'va', 'records')).filter((name) => name.endsWith('.jsonl'));
}

/** What a one-line edit of `file` selects from `module`'s coverage.va, as a diff at the checkout root. */
async function selects(module, file, from, to) {
  const path = join(modules, file);
  const text = readFileSync(path, 'utf8');
  assert.ok(text.includes(from), `${file} has no ${from}`);
  writeFileSync(path, text.replace(from, to));
  try {
    return await narrowByExecution(join(modules, module, 'target', 'va', 'coverage.va'), git('diff'));
  } finally {
    writeFileSync(path, text);
  }
}

const calcClasses = ['org.example.calc.AddTest', 'org.example.calc.MulTest', 'org.example.calc.NegTest'];

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
cpSync(join(here, 'modules'), modules, { recursive: true });
writeFileSync(join(modules, '.gitignore'), 'target/\n');
git('init', '-q');
git('add', '.');
git('-c', 'user.name=va', '-c', 'user.email=va@example.org', 'commit', '-qm', 'baseline');

mvn();
// Three JVMs, two at a time, one va.out: each class once, each JVM its own file.
assert.deepEqual(owners('calc'), calcClasses);
assert.equal(records('calc').length, 3);
assert.deepEqual(owners('words'), ['org.example.words.ShoutTest']);
const add = await selects('calc', calc, 'return a + b;', 'return a - b;');
assert.deepEqual(add.entered, [test('calc', 'AddTest')]);
// Recorded whole: nothing outside the checkout left a class unknown.
assert.deepEqual(add.whole, ['AddTest', 'MulTest', 'NegTest'].map((name) => test('calc', name)));
const shout = await selects('words', words, '+ "!"', '+ "?"');
assert.deepEqual(shout.entered, [test('words', 'ShoutTest')]);
assert.deepEqual(shout.whole, [test('words', 'ShoutTest')]);
console.log('fresh: checkout-relative names, the checkout\'s classes only, every fork once');

mvn();
assert.deepEqual(owners('calc'), calcClasses);
assert.equal(records('calc').length, 3, 'the first run\'s records were superseded and deleted');
console.log('rerun: rows replaced, superseded records deleted');

mvn('-Dtest=AddTest', '-Dsurefire.failIfNoSpecifiedTests=false');
assert.deepEqual(owners('calc'), calcClasses);
console.log('-Dtest=AddTest: the other classes keep their rows');

// MulTest's record read MulTest.java; nothing else's did.
const mul = join(modules, test('calc', 'MulTest'));
writeFileSync(mul, readFileSync(mul, 'utf8').replace('assertEquals(6,', 'assertEquals(3 * 2,'));
mvn('-Dtest=AddTest', '-Dsurefire.failIfNoSpecifiedTests=false');
assert.deepEqual(owners('calc'), ['org.example.calc.AddTest', 'org.example.calc.NegTest']);
console.log('edit: the record that read the edited file is retired');
