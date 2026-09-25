// A Jest case's journey, across an HTTP gap into a JVM, and back through the fold.
//
// Phase 0 harness. The shop in `journey/shop` is a Java service under the presence
// agent; its `jest/` cases call it with fetch and put their own journey on the
// request as a cookie. Jest and the JVM share nothing else: the harness hands the
// JVM a parts directory, the JVM converts its record into parts when it stops, and
// the Jest run's journey file is finalized after that, the way a CI job regroups
// once every shard and service has finished.
//
// Asserts that each method region is charged to the case whose request ran it, that
// the service's unattributed windows are charged to every case that crossed into it,
// that a case which never called the shop is not there, and that a change to a Java
// line selects the Jest file that reached it.
//
// Usage: node parts.mjs <work dir> <presence bin dir>
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [work, bin] = process.argv.slice(2).map((p) => resolve(p));
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const selection = join(repoRoot, 'packages', 'sense', 'dist', 'test-selection');
const { finalizeJestJourneys } = await import(pathToFileURL(join(selection, 'jest-journey-artifact.js')).href);
const { decodeExecutionIndex } = await import(pathToFileURL(join(selection, 'execution-format.js')).href);
const { selectJourneyFile } = await import(pathToFileURL(join(selection, 'journey-native.js')).href);
const shop = join(work, 'shop');
const parts = join(shop, '.va', 'parts');
const journeyFile = join(work, 'journeys.bin');
const port = 8124;
const image = 'maven:3.9-eclipse-temurin-21';
const sources = 'backend/src/main/java';

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
cpSync(join(here, 'journey', 'shop'), shop, { recursive: true });
writeFileSync(join(shop, '.gitignore'), '.va/\nnode_modules\n');
symlinkSync(join(repoRoot, 'node_modules'), join(shop, 'node_modules'));
execFileSync('git', ['-C', shop, 'init', '-q']);

// The service's half: the agent and one directory to leave its parts in.
const name = `va-parts-${process.pid}`;
docker(
  'run', '-d', '--name', name, '-p', `${port}:${port}`, '-e', `PORT=${port}`,
  '-e', 'VARIANCE_AUTHORITY_PARTS=/repo/.va/parts',
  '-v', `${shop}:/repo`, '-v', `${bin}:/va:ro`, '-w', '/repo', image, 'sh', '-euc',
  `javac -d /tmp/c -cp /va/va-presence-rt.jar $(find ${sources} -name '*.java')
   exec java -javaagent:/va/va-presence.jar=includes=shop.*,sources=${sources} \
     -cp /tmp/c:/va/va-presence-rt.jar shop.Server`,
);
let jest;
try {
  for (let i = 0; ; i++) {
    try {
      // A readiness probe carries no journey, like any request nobody minted one for.
      await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) });
      break;
    } catch {
      if (i > 120) throw new Error(`the shop never answered\n${docker('logs', name)}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  // In band: the agent's store is a window of time, and journeys open at once share
  // their windows. Two workers would widen the answer, which is correct and not
  // what this asserts.
  jest = spawnSync(process.execPath, [join(repoRoot, 'node_modules', 'jest', 'bin', 'jest.js'), '--runInBand', '--watchman=false'], {
    cwd: shop,
    encoding: 'utf8',
    env: {
      ...process.env,
      PORT: String(port),
      VARIANCE_AUTHORITY_JOURNEYS: journeyFile,
      VARIANCE_AUTHORITY_JEST_CACHE: join(work, 'cache'),
      VARIANCE_AUTHORITY_PARTS: parts,
      XDG_CACHE_HOME: work,
    },
  });
} finally {
  // SIGTERM: the JVM's shutdown hook writes the parts on the way out.
  docker('stop', '-t', '30', name);
  const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8' });
  docker('rm', name);
  if (/presence:/.test(logs.stderr)) console.error(logs.stderr);
}
assert.equal(jest.status, 0, `jest failed\n${jest.stdout}\n${jest.stderr}`);
const written = readdirSync(parts).sort();
assert.deepEqual(written.map((f) => f.replace(/^jvm-\d+-[0-9a-f-]+/, 'jvm')), ['jvm.rec', 'jvm.vac']);

// Regroup: the run finished, the service finished, now the fold.
await finalizeJestJourneys(journeyFile);
const index = decodeExecutionIndex(readFileSync(journeyFile));
const java = (file) => `${sources}/shop/${file}`;
const source = (file) => readFileSync(join(shop, java(file)), 'utf8');
const lineOf = (file, text) => {
  const at = source(file).indexOf(text);
  assert.ok(at >= 0, `${text} is not in ${file}`);
  return source(file).slice(0, at).split('\n').length;
};
const walking = (file, text) => {
  const module = index.modules.find((m) => m.file === java(file));
  assert.ok(module, `${java(file)} is not in the fold: ${index.modules.map((m) => m.file).join(', ')}`);
  const line = lineOf(file, text);
  const block = module.blocks
    .filter((b) => b.startLine <= line && line <= b.endLine)
    .sort((l, r) => r.startLine - l.startLine || l.endLine - r.endLine)[0];
  return block.crossings.map((c) => index.tests[c.test].id).sort();
};
const cart = 'jest/cart.case.ts > totals a cart';
const kettle = 'jest/search.case.ts > finds a kettle';

const checks = [
  ['a method only the cart request ran', () => assert.deepEqual(walking('Prices.java', 'subtotal >= 10000'), [cart])],
  ['a method only the cart request ran, one class over', () => assert.deepEqual(walking('Catalog.java', 'product.sku().equals(sku)'), [cart])],
  ['a method only the search request ran', () => assert.deepEqual(walking('Search.java', 'contains(needle)'), [kettle])],
  // The probe's request and the JVM's startup carried no journey: the service's own
  // work, charged to every case that crossed into it.
  ['an unattributed request charges every case that crossed', () => assert.deepEqual(walking('Server.java', 'index.html'), [cart, kettle])],
  ['a case that never crossed has nothing beyond the fence', () => assert.ok(!index.tests.some((t) => t.id === 'jest/search.case.ts > never calls the shop'))],
];
const change = (file, text) => new Map([[java(file), [{ start: lineOf(file, text), end: lineOf(file, text) }]]]);
const selects = async (file, text) => (await selectJourneyFile(journeyFile, change(file, text)))?.entered;
checks.push(
  ['a Java change selects the Jest file that reached it', async () => assert.deepEqual(await selects('Prices.java', 'subtotal >= 10000'), ['jest/cart.case.ts'])],
  ['and only that file', async () => assert.deepEqual(await selects('Search.java', 'contains(needle)'), ['jest/search.case.ts'])],
);

let failed = 0;
for (const [label, check] of checks) {
  try {
    await check();
    console.log(`ok   ${label}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${label}\n     ${String(error.message).split('\n').join('\n     ')}`);
  }
}
process.exitCode = failed === 0 ? 0 : 1;
