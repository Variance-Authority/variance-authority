#!/usr/bin/env node

/**
 * What the probes cost, measured on a real subsystem rather than a loop.
 *
 * [Spec 0027](../../../docs/specs/0027-a-test-is-selected-by-what-it-executed.md)
 * pre-registers `o` — instrumented run ÷ uninstrumented run — at **≤ 1.35**, and a
 * kill criterion nobody can reproduce is not a kill criterion. The repository's own
 * suite answers `o` at the scale that matters and is the number to quote, but it is
 * dominated by browser I/O and one deliberate thirty-second timeout, so it cannot
 * tell 1.00 from 1.05. This can.
 *
 * The workload is this package's `scanRelations` over a generated tree, in two
 * arms that differ only in how much of the time is spent in *instrumented JavaScript*:
 *
 *   cold  — every file opened and parsed. Most of the clock is inside the native
 *           parser, which carries no probes. This is the diluted, realistic figure.
 *   warm  — a populated parse cache, so nothing is parsed at all and nearly every
 *           millisecond is this package's own instrumented code. This is close to
 *           the worst case a real suite can present.
 *
 * **Both arms run the same source.** `dist` is copied three times and one copy is
 * instrumented in place, so the comparison is one build against itself and not
 * against a differently-compiled sibling. The copies live inside the package
 * because a bare specifier — `oxc-parser` — only resolves from somewhere
 * `node_modules` is reachable.
 *
 * The third copy is the point. It is not instrumented, and it is measured exactly
 * as the probed one is, so every arm reports a **control** ratio alongside `o`: two
 * identical builds, timed the same way, differing only by the noise. An `o` inside
 * that band is a measurement of this machine and not of the probes, and this says
 * so rather than letting a reader mistake 1.01 for a cost.
 *
 * It also reports how many increments each arm actually recorded. A benchmark of
 * probes that never fired would report a very good ratio and mean nothing.
 *
 * Run:  variance-authority-sense-overhead
 *       variance-authority-sense-overhead 4000 7
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { instrument } from '../dist/instrument/index.js';

const COMPONENTS = Number(process.argv[2] ?? 2_000);
/** Repeats per arm. The estimator is the minimum, so this buys a floor, not a mean. */
const ROUNDS = Number(process.argv[3] ?? 5);
const FANOUT = 20;

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(HERE, '..');

const staging = mkdtempSync(join(PACKAGE, '.overhead-'));
const tree = mkdtempSync(join(tmpdir(), 'variance-overhead-'));

/** Counters keyed by module, installed for the probed arm only. */
const counters = new Map();
globalThis.__VA__ = (id, count) => {
  const held = counters.get(id) ?? new Uint32Array(count);
  counters.set(id, held);
  return held;
};

try {
  for (const copy of ['plain', 'control', 'probed']) {
    cpSync(join(PACKAGE, 'dist'), join(staging, copy), { recursive: true });
  }

  const { files, probes, refused } = probe(join(staging, 'probed'));
  console.log(`${files} modules instrumented, ${probes} probes, ${refused} refused\n`);

  generate(tree, COMPONENTS);
  git(tree, ['init', '--quiet']);
  git(tree, ['add', '-A']);
  git(tree, ['commit', '--quiet', '-m', 'one']);

  const plain = await load(join(staging, 'plain'));
  const control = await load(join(staging, 'control'));
  const probed = await load(join(staging, 'probed'));

  const arms = [
    ['cold  — every file parsed', (scan) => scan.cold()],
    ['warm  — nothing parsed', (scan) => scan.warm()],
  ];

  const bounds = [];

  console.log(`${COMPONENTS} components, best of ${ROUNDS}\n`);
  console.log(
    `  ${'arm'.padEnd(26)} ${'plain'.padStart(7)} ${'probed'.padStart(9)}      o  control  increments`,
  );

  for (const [name, run] of arms) {
    for (const held of counters.values()) held.fill(0);

    // Interleaved, not one arm and then the next, so a thermal drift over the run
    // lands on all three rather than on whichever went last.
    const best = { plain: Infinity, control: Infinity, probed: Infinity };
    for (let round = 0; round < ROUNDS; round += 1) {
      best.plain = Math.min(best.plain, await time(() => run(plain)));
      best.control = Math.min(best.control, await time(() => run(control)));
      best.probed = Math.min(best.probed, await time(() => run(probed)));
    }

    const hits = recorded();
    const o = best.probed / best.plain;
    const noise = best.control / best.plain;
    const verdict = Math.abs(o - 1) <= Math.abs(noise - 1) ? ' (within noise)' : '';

    console.log(
      `  ${name.padEnd(26)} ${best.plain.toFixed(0).padStart(5)} ms ${best.probed.toFixed(0).padStart(6)} ms  ` +
        `${o.toFixed(3)}    ${noise.toFixed(3)}  ${hits.toLocaleString().padStart(11)}${verdict}`,
    );

    // What the measurement can still exclude. A ratio inside the noise band does
    // not say a probe is free, it says the cost is under whatever the band hides —
    // and that bound, per increment, is the number worth carrying forward.
    const perRun = hits / ROUNDS;
    const band = Math.max(Math.abs(o - 1), Math.abs(noise - 1));
    bounds.push(
      `${name.split(' ')[0]}: ${Math.round(perRun).toLocaleString()} increments per run — ` +
        `under ${((band * best.plain * 1e6) / perRun).toFixed(1)} ns each at this noise floor`,
    );
  }

  console.log(`\n  control is a second uninstrumented copy, measured identically`);
  for (const bound of bounds) console.log(`  ${bound}`);
  if (recorded() === 0) {
    console.log('  no probe fired — the ratios above are measuring nothing');
    process.exitCode = 1;
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
  rmSync(tree, { recursive: true, force: true });
}

/** Every increment currently held, across every instrumented module. */
function recorded() {
  let total = 0;
  for (const held of counters.values()) for (const at of held) total += at;

  return total;
}

/** Instrument every module of a built package, in place. */
function probe(root) {
  let files = 0;
  let probes = 0;
  let refused = 0;

  for (const file of walk(root)) {
    if (!file.endsWith('.js')) continue;

    const source = readFileSync(file, 'utf8');
    const done = instrument(source, relative(root, file));

    // ADR-0008: a module this could not read is *not instrumented*, and saying so
    // is the difference between a benchmark and a benchmark with a hole in it.
    if (done === undefined) {
      refused += 1;
      continue;
    }

    writeFileSync(file, done.code);
    files += 1;
    probes += done.blocks.length;
  }

  return { files, probes, refused };
}

function* walk(at) {
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const path = join(at, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/**
 * One arm's workload, bound to its own copy of the package.
 *
 * The caches are built once per arm and reused, because the warm arm's whole point
 * is that the parser never runs — rebuilding them per round would put parsing back.
 */
async function load(root) {
  const at = async (file) => import(pathToFileURL(join(root, file)).href);

  const { scanRelations } = await at('scan.js');
  const { memoryParseCache } = await at('cache.js');

  const cache = memoryParseCache();
  await scanRelations({ root: tree, dirs: ['src'], cache });

  return {
    cold: () => scanRelations({ root: tree, dirs: ['src'], digests: false }),
    warm: () => scanRelations({ root: tree, dirs: ['src'], cache }),
  };
}

async function time(work) {
  const started = process.hrtime.bigint();
  await work();

  return Number(process.hrtime.bigint() - started) / 1e6;
}

/** The same tree `bench.mjs` builds: leaves, components, stylesheets, a barrel per directory. */
function generate(root, count) {
  writeFileSync(join(root, 'package.json'), '{ "name": "overhead", "type": "module" }');

  const dirs = Math.ceil(count / FANOUT);
  for (let dir = 0; dir < dirs; dir += 1) {
    const at = join(root, 'src', String(dir));
    mkdirSync(at, { recursive: true });

    const names = [];
    for (let n = 0; n < FANOUT && dir * FANOUT + n < count; n += 1) {
      writeFileSync(join(at, `leaf-${n}.ts`), `export const leaf${n} = ${n};\n`);
      writeFileSync(join(at, `style-${n}.css`), `.c${n} { color: red }\n`);
      writeFileSync(
        join(at, `Comp-${n}.tsx`),
        [
          `import { leaf${n} } from './leaf-${n}.js';`,
          `import './style-${n}.css';`,
          dir > 0 ? `import { Comp0 } from '../${dir - 1}/index.js';` : '',
          `export function Comp${n}() { return leaf${n}; }`,
          '',
        ].join('\n'),
      );
      names.push(n);
    }

    writeFileSync(
      join(at, 'index.ts'),
      names.map((n) => `export { Comp${n} } from './Comp-${n}.js';`).join('\n') + '\n',
    );
  }
}

function git(root, args) {
  execFileSync('git', ['-c', 'user.email=bench@example.test', '-c', 'user.name=Bench', ...args], {
    cwd: root,
    stdio: 'ignore',
  });
}
