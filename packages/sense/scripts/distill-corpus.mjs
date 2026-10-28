#!/usr/bin/env node
/**
 * A synthetic checkout and its merged record, at the shape `variance distill`
 * met in a large CI suite: journal entry 0075 measures on it.
 *
 *   node --max-old-space-size=16384 packages/sense/scripts/distill-corpus.mjs --out <dir> [--scale 1] [--seed 1] [--hub 0] [--hub-share 1] [--sense <checkout>/packages/sense]
 *
 * Writes <dir>/repo, a git checkout of source files whose imports form the
 * graph, and <dir>/record.bin, its coverage rows and set-spelled case index,
 * through the writers of the sense package it is run from, or of `--sense`.
 * Deterministic for a seed: the same corpus measures a base and a branch.
 * `--hub N` adds a chain of N modules that test files import at its head and
 * cases rarely enter; `--hub-share` is the share of test files that import it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, word, at, all) => (word.startsWith('--') ? [...pairs, [word.slice(2), all[at + 1]]] : pairs), []),
);
if (args.out === undefined) {
  process.stderr.write('usage: node distill-corpus.mjs --out <dir> [--scale 1] [--seed 1] [--hub 0] [--hub-share 1] [--sense <packages/sense>]\n');
  process.exit(2);
}
const sense = args.sense === undefined ? join(dirname(fileURLToPath(import.meta.url)), '..') : resolve(args.sense);
const selection = await import(pathToFileURL(join(sense, 'dist/test-selection/index.js')).href);
const SCALE = Number(args.scale ?? 1);
const PACKAGES = Math.max(2, Math.round(410 * SCALE));
const PER_PACKAGE = 230;
const PUBLIC = 40;
const TESTS = Math.round(30_000 * SCALE);
const SETUP = 20;
const COMMIT = 'a'.repeat(40);

let state = Number(args.seed ?? 1) >>> 0;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const geometric = (mean, cap) => Math.min(cap, Math.floor(Math.log(1 - random()) / Math.log(1 - 1 / (mean + 1))));
const KINDS = ['function', 'branch', 'branch', 'continuation', 'loop', 'case', 'handler', 'resume'];

// Modules: per package a barrel re-exporting its first PUBLIC modules, then
// PER_PACKAGE modules each importing about two later ones in the package, a
// few lazily. A tenth are constants files (top level only). Then setup files no
// import reaches (the runner loads them).
const modules = []; // { file, regions, imports: [id], lazy: [id], reexports: [id] }
const add = (file, regions) => modules.push({ file, regions, imports: [], lazy: [], reexports: [] }) - 1;
const regionsOf = (functions) => {
  const extra = functions ? 1 + geometric(4, 60) : 0;
  const regions = [{ kind: 'module', name: '', path: '', startLine: 1, endLine: 30 + extra * 9 }];
  for (let at = 1; at <= extra; at += 1) {
    const kind = at === 1 ? 'function' : KINDS[Math.floor(random() * KINDS.length)];
    regions.push({ kind, name: kind === 'function' ? `fn${at}` : '', path: at === 1 ? 'fn1' : `fn1/${kind}${at}`, startLine: 2 + at * 8, endLine: 8 + at * 8 });
  }
  return regions;
};
const barrels = [];
const packageModules = [];
for (let pkg = 0; pkg < PACKAGES; pkg += 1) {
  const barrel = add(`packages/pkg-${pkg}/src/index.ts`, regionsOf(false));
  barrels.push(barrel);
  const mine = [];
  for (let at = 0; at < PER_PACKAGE; at += 1) mine.push(add(`packages/pkg-${pkg}/src/area-${at % 9}/m-${at}.ts`, regionsOf(random() >= 0.1)));
  packageModules.push(mine);
  modules[barrel].reexports = mine.slice(0, PUBLIC);
  for (let at = 0; at < PER_PACKAGE; at += 1) {
    const edges = geometric(2, 6);
    for (let edge = 0; edge < edges; edge += 1) {
      const to = at + 1 + Math.floor(random() * 25);
      if (to >= PER_PACKAGE) continue;
      (random() < 0.05 ? modules[mine[at]].lazy : modules[mine[at]].imports).push(mine[to]);
    }
  }
}
const setups = Array.from({ length: SETUP }, (_, at) => add(`packages/setup/src/setup-${at}.ts`, regionsOf(true)));

// A hub: a chain of HUB modules, each importing the next, that a share of the
// test files import at its head (a test helper over a deep stack). Every one of
// them is loaded by each such test file, and cases enter it rarely.
const HUB = Number(args.hub ?? 0);
const HUB_SHARE = Number(args['hub-share'] ?? 1);
const hub = Array.from({ length: HUB }, (_, at) => add(`packages/hub/src/h-${at}.ts`, regionsOf(true)));
for (let at = 0; at + 1 < HUB; at += 1) modules[hub[at]].imports.push(hub[at + 1]);

// Test files: import the home module and, half the time, another package's barrel.
const tests = [];
for (let test = 0; test < TESTS; test += 1) {
  const pkg = test % PACKAGES;
  const home = packageModules[pkg][Math.floor(random() * PER_PACKAGE)];
  const file = `packages/pkg-${pkg}/test/case-${test}.test.ts`;
  const imports = [home];
  imports.push(barrels[Math.floor(random() * PACKAGES)]);
  if (random() < 0.5) imports.push(barrels[Math.floor(random() * PACKAGES)]);
  if (HUB > 0 && random() < HUB_SHARE) imports.push(hub[0]);
  const id = add(file, regionsOf(true));
  modules[id].imports = imports;
  tests.push({ id, file, home, cases: 1 + geometric(11, 200), withheld: random() });
}

// The checkout: one file a module, its imports spelled relative.
const out = resolve(args.out);
const repo = join(out, 'repo');
rmSync(repo, { recursive: true, force: true });
const relativeOf = (from, to) => {
  const a = dirname(from).split('/');
  const b = to.replace(/\.ts$/, '').split('/');
  let common = 0;
  while (common < a.length && common < b.length - 1 && a[common] === b[common]) common += 1;
  const up = a.length - common;
  return `${up === 0 ? './' : '../'.repeat(up)}${b.slice(common).join('/')}`;
};
for (const module of modules) {
  const lines = [
    ...module.imports.map((to, at) => `import * as i${at} from '${relativeOf(module.file, modules[to].file)}';`),
    ...module.reexports.map((to) => `export * from '${relativeOf(module.file, modules[to].file)}';`),
    ...module.lazy.map((to) => `export const load${to} = () => import('${relativeOf(module.file, modules[to].file)}');`),
    ...module.regions.filter(({ kind }) => kind === 'function').map(({ name }) => `export function ${name}() { return ${module.imports.length}; }`),
    `export const value = ${module.regions.length};`,
  ];
  const path = join(repo, module.file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join('\n')}\n`);
}
writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'corpus', private: true, type: 'module' }, null, 2)}\n`);
const git = (...words) => execFileSync('git', words, { cwd: repo, stdio: ['ignore', 'ignore', 'inherit'] });
git('init', '-q', '-b', 'main');
git('add', '-A');
git('-c', 'user.name=corpus', '-c', 'user.email=corpus@example.invalid', 'commit', '-q', '-m', 'corpus');

// What each test file loaded: the closure over its imports, a lazy import
// called half the time, a static one mocked away one time in two hundred, and
// three setup files. Cases enter its home closure's regions often, the rest rarely.
const caseRows = [];
const testRows = [];
const held = new Map(); // module id -> regions -> { files: [], cases: [] }
const stamp = new Uint32Array(modules.length);
for (const [order, test] of tests.entries()) {
  const first = caseRows.length;
  const empty = test.withheld < 0.005;
  const incomplete = test.withheld >= 0.005 && test.withheld < 0.015;
  const stopped = test.withheld >= 0.015 && test.withheld < 0.025;
  const cases = empty ? 0 : test.cases;
  for (let at = 0; at < cases; at += 1) {
    caseRows.push({ id: `${test.file} > case ${at}`, file: test.file, name: `case ${at}`, stopped: stopped && at === 0, duration: 10 });
  }
  testRows.push({ file: test.file, complete: !incomplete, preconditions: [], duration: 100 });
  const mark = order + 1;
  const near = new Set();
  const loaded = [test.id];
  stamp[test.id] = mark;
  const walk = (from, home) => {
    const stack = [[from, home]];
    while (stack.length > 0) {
      const [at, inHome] = stack.pop();
      const next = [
        ...modules[at].imports.filter(() => random() >= 0.005),
        ...modules[at].reexports,
        ...modules[at].lazy.filter(() => random() < 0.5),
      ];
      for (const to of next) {
        if (stamp[to] === mark) continue;
        stamp[to] = mark;
        loaded.push(to);
        if (inHome) near.add(to);
        stack.push([to, inHome]);
      }
    }
  };
  stamp[test.home] = mark;
  loaded.push(test.home);
  near.add(test.home);
  walk(test.home, true);
  walk(test.id, false);
  for (let at = 0; at < 3; at += 1) {
    const setup = setups[Math.floor(random() * SETUP)];
    if (stamp[setup] !== mark) {
      stamp[setup] = mark;
      loaded.push(setup);
    }
  }
  for (const module of loaded) {
    let regions = held.get(module);
    if (regions === undefined) held.set(module, (regions = modules[module].regions.map(() => ({ files: [], cases: [] }))));
    regions[0].files.push(test.file);
    if (cases === 0) continue;
    const often = module === test.id ? 0.9 : near.has(module) ? 0.5 : 0.04;
    for (let region = 1; region < regions.length; region += 1) {
      if (random() >= often) continue;
      regions[region].files.push(test.file);
      regions[region].cases.push(first + Math.floor(random() * cases));
      if (cases > 1 && random() < 0.5) regions[region].cases.push(first + Math.floor(random() * cases));
    }
  }
}

const order = [...held.keys()].sort((left, right) => (modules[left].file < modules[right].file ? -1 : 1));
const digest = (id) => id.toString(16).padStart(16, '0');
const coverage = {
  version: 3, instrumentation: 'synthetic-istanbul', commit: COMMIT, tests: testRows,
  modules: order.map((id) => ({
    file: modules[id].file, sourceDigest: digest(id).repeat(4), instrumented: true,
    blocks: modules[id].regions.map((region, at) => ({
      ordinal: at, ...(at === 0 ? {} : { owner: at === 1 ? 0 : 1 }), digest: digest(id * 97 + at), source: true, ...region,
      testFiles: at === 0 ? [] : held.get(id)[at].files,
      ...(at === 0 ? { loadedBy: held.get(id)[0].files } : {}),
    })),
  })),
};
const index = selection.encodeAsSetExecutionIndex({
  tests: caseRows,
  modules: order.map((id) => ({
    file: modules[id].file,
    blocks: modules[id].regions.map((region, at) => ({
      ...region,
      ...(at === 0 ? { loaded: true } : {}),
      crossings: at === 0 ? [] : [...new Set(held.get(id)[at].cases)].sort((left, right) => left - right).map((test) => ({ test, distance: 0 })),
    })),
  })),
});
const record = join(out, 'record.bin');
await selection.writeTestCoverage(record, coverage, { index });
const loads = [...held.values()].reduce((sum, regions) => sum + regions[0].files.length, 0);
process.stdout.write(`${JSON.stringify({ testFiles: TESTS, cases: caseRows.length, modules: order.length, files: modules.length, loads, record })}\n`);
