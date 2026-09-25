// Which frontend specs a backend change can break: the Java record against relations.
//
// Phase 0 harness. The shop in `journey/shop` is a Java service and the Playwright
// specs that drive it through a browser. Nothing in the specs imports the service,
// so relations (`variance reach`) have no path from a Java file to a spec. The
// service runs under the presence agent, the specs set a journey cookie per test,
// and the service's filter opens that journey around each request, so its record
// says which spec entered which method.
//
// For each seeded change the truth is the specs that fail against the changed
// service and pass against the baseline, the same truth score-mutants.mjs uses.
//   record  — sense's selector over the baseline's coverage.va and the change's diff
//   reach   — `variance reach --since <baseline>`, the specs among the paths it prints
//
// Usage: node journey.mjs <work dir> <presence bin dir> <variance bin>
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [work, bin, varianceBin] = process.argv.slice(2).map((p) => resolve(p));
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(varianceBin, '..', '..', '..', '..');
const { narrowByExecution } = await import(
  pathToFileURL(join(repoRoot, 'packages', 'sense', 'dist', 'test-selection', 'index.js')).href
);
const shop = join(work, 'shop');
const out = join(shop, '.va');
const port = 8123;
const image = 'maven:3.9-eclipse-temurin-21';
const sources = 'backend/src/main/java';

const changes = [
  { name: 'discount threshold', file: 'Prices.java', from: 'subtotal >= 10000', to: 'subtotal > 10500' },
  { name: 'price format', file: 'Prices.java', from: '"%d.%02d"', to: '"%d,%02d"' },
  { name: 'search case', file: 'Search.java', from: 'product.name().toLowerCase(Locale.ROOT)', to: 'product.name()' },
  { name: 'tin price', file: 'Catalog.java', from: '"Loose leaf tin", 900', to: '"Loose leaf tin", 950' },
  { name: 'unknown sku message', file: 'Catalog.java', from: '"no product "', to: '"unknown product "' },
  { name: 'page content type', file: 'Server.java', from: '"text/html"', to: '"text/html; x=1".split(";")[0]' },
];

function git(...args) {
  return execFileSync('git', ['-C', shop, ...args], { encoding: 'utf8' }).trim();
}

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Builds and starts the service under the agent, runs every spec, stops it; the specs that failed. */
async function run(label) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const name = `va-shop-${process.pid}`;
  docker(
    'run', '-d', '--name', name, '-p', `${port}:${port}`, '-e', `PORT=${port}`,
    '-v', `${shop}:/repo`, '-v', `${bin}:/va:ro`, '-w', '/repo', image, 'sh', '-euc',
    `javac -d /tmp/c -cp /va/va-presence-rt.jar $(find ${sources} -name '*.java')
     exec java -javaagent:/va/va-presence.jar=includes=shop.*,sources=${sources} -Dva.out=/repo/.va \
       -cp /tmp/c:/va/va-presence-rt.jar shop.Server`,
  );
  try {
    for (let i = 0; ; i++) {
      try {
        await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) });
        break;
      } catch {
        if (i > 120) throw new Error(`${label}: the shop never answered\n${docker('logs', name)}`);
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    // Only the specs' traffic: the readiness probe above is unattributed like any request that carries no journey.
    const results = join(out, 'results.json');
    spawnSync('node', [join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js'), 'test'], {
      cwd: shop,
      env: { ...process.env, PORT: String(port), VA_JOURNEYS: join(out, 'journeys.tsv'), VA_RESULTS: results },
      stdio: 'ignore',
    });
    const report = JSON.parse(readFileSync(results, 'utf8'));
    const failed = new Set();
    const walk = (suite) => {
      for (const spec of suite.specs ?? []) if (!spec.ok) failed.add(`e2e/${spec.file}`);
      for (const child of suite.suites ?? []) walk(child);
    };
    for (const suite of report.suites) walk(suite);
    const total = report.stats.expected + report.stats.unexpected + report.stats.flaky;
    return { failed, total };
  } finally {
    docker('stop', '-t', '5', name);
    docker('rm', name);
  }
}

// A checkout of the shop with its own history, so a change has a diff and reach has a baseline.
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
cpSync(join(here, 'journey', 'shop'), shop, { recursive: true });
writeFileSync(join(shop, '.gitignore'), '.va/\nnode_modules\ntest-results/\n');
symlinkSync(join(repoRoot, 'node_modules'), join(shop, 'node_modules'));
git('init', '-q');
git('add', '-A');
git('-c', 'user.name=va', '-c', 'user.email=va@localhost', 'commit', '-q', '-m', 'shop');
const base = git('rev-parse', 'HEAD');

const baseline = await run('baseline');
if (baseline.failed.size > 0) throw new Error(`the baseline fails: ${[...baseline.failed].join(', ')}`);
execFileSync('docker', [
  'run', '--rm', '-v', `${shop}:/repo`, '-v', `${bin}:/va:ro`, '-w', '/repo', image,
  'java', '-cp', '/va/va-presence.jar', 'va.presence.Coverage',
  '.va/record.jsonl', '.va/coverage.va', base, sources, '.va/journeys.tsv',
], { stdio: 'inherit' });
const coverage = join(work, 'coverage.va');
cpSync(join(out, 'coverage.va'), coverage);
cpSync(join(out, 'record.jsonl'), join(work, 'record.jsonl'));
cpSync(join(out, 'journeys.tsv'), join(work, 'journeys.tsv'));
const subjects = [...new Set(readFileSync(join(work, 'journeys.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t')[1]))].sort();

const rows = [];
for (const change of changes) {
  const path = join(shop, sources, 'shop', change.file);
  const text = readFileSync(path, 'utf8');
  if (!text.includes(change.from)) throw new Error(`${change.name}: ${change.from} is not in ${change.file}`);
  writeFileSync(path, text.replace(change.from, change.to));
  git('-c', 'user.name=va', '-c', 'user.email=va@localhost', 'commit', '-q', '-am', change.name);
  const diff = git('diff', base, 'HEAD') + '\n';

  const n = await narrowByExecution(coverage, diff);
  const whole = new Set(n.whole);
  const record = new Set(n.entered);
  for (const s of subjects) if (!whole.has(s)) record.add(s);

  let reach;
  try {
    const printed = execFileSync('node', [varianceBin, 'reach', '--since', base], { cwd: shop, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    reach = new Set(printed.split('\n').filter((p) => subjects.includes(p)));
  } catch (e) {
    reach = `refused ${e.status}: ${String(e.stderr).trim().split('\n').pop()}`;
  }

  const truth = await run(change.name);
  const killers = [...truth.failed].sort();
  const missed = (sel) => (typeof sel === 'string' ? null : killers.filter((k) => !sel.has(k)));
  rows.push({ change: change.name, file: change.file, killers, record: [...record].sort(), reach: typeof reach === 'string' ? reach : [...reach].sort(), missed: { record: missed(record), reach: missed(reach) } });
  git('reset', '-q', '--hard', base);
}
writeFileSync(join(work, 'journey.json'), JSON.stringify({ subjects, rows }, null, 2));

const short = (list) => (typeof list === 'string' ? list : list.length === 0 ? '-' : list.map((s) => s.replace(/^e2e\/|\.spec\.mjs$/g, '')).join(' '));
console.log(`${subjects.length} specs: ${short(subjects)}\n`);
console.log('change                 file          fails         | record selects  missed | reach selects   missed');
for (const r of rows) {
  const cell = (g) => `${short(r[g]).padEnd(15)} ${r.missed[g] === null ? '-' : r.missed[g].length}`;
  console.log(`${r.change.padEnd(22)} ${r.file.padEnd(13)} ${short(r.killers).padEnd(13)} | ${cell('record').padEnd(22)} | ${cell('reach')}`);
}
const killing = rows.filter((r) => r.killers.length > 0);
for (const g of ['record', 'reach']) {
  const scored = killing.filter((r) => r.missed[g] !== null);
  const escaped = scored.filter((r) => !r.killers.some((k) => (Array.isArray(r[g]) ? r[g] : []).includes(k))).length;
  const selected = rows.reduce((sum, r) => sum + (Array.isArray(r[g]) ? r[g].length : subjects.length), 0);
  console.log(`${g.padEnd(6)} changes escaped ${escaped}/${scored.length}, specs selected ${selected}/${rows.length * subjects.length}`);
}
