#!/usr/bin/env node

/**
 * What a repository's path set costs before a file is opened.
 *
 * A cold scan of a large monorepo spent its first seconds in neither git nor the
 * parser: it spent them turning one large `ls-tree` string into JavaScript maps,
 * sorting four hundred thousand paths, filtering them, walking every segment of
 * every one of them, and — where no `tsconfig` bounded a bare specifier —
 * joining the whole listing into one string to hash. Five folds, none of them
 * the work, all of them the size of the repository.
 *
 * So this times exactly those folds, both ways, over a generated tree whose
 * shape is stated rather than found: `--files` files spread over a directory
 * fan-out, committed once, then dirtied, so the working-tree overlay is timed
 * with something to overlay. The generator is here rather than beside the
 * numbers because a measurement whose input cannot be rebuilt is an anecdote.
 *
 * ```sh
 * node scripts/tree-cost.mjs --files 50000
 * node scripts/tree-cost.mjs --root .        # this checkout, as it stands
 * ```
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gitDigests, treeOf } from '../dist/tree.js';
import { native } from '../dist/native.js';

const run = promisify(execFile);
const LAYOUT = ['package.json', 'jsconfig.json', 'yarn.lock'];
const HEADER = ['version 2', 'root /x', 'tsconfig auto', 'conditions source,import,require,default'];

const argued = new Map();
for (let at = 2; at < process.argv.length; at += 2) {
  argued.set(process.argv[at].replace(/^--/u, ''), process.argv[at + 1]);
}

const files = Number(argued.get('files') ?? 50_000);
const given = argued.get('root');
const addon = native();
if (addon === undefined) {
  console.error('no native scanner built — run `node native/build.mjs` first');
  process.exit(1);
}

const root = given === undefined ? await generate(files) : resolve(given);
console.log(`tree ${root}${given === undefined ? ` (${files} generated files)` : ''}\n`);

const jsDiscovery = await timed(() => gitDigests(root));
const nativeDiscovery = await timed(() => addon.gitTree(root));
const js = treeOf(jsDiscovery.value);
const held = nativeDiscovery.value;

console.log(`paths ${js.size} / ${held.size}\n`);
report('git discovery', jsDiscovery.ms, nativeDiscovery.ms);
report('paths, listed', (await timed(() => js.paths())).ms, (await timed(() => held.paths())).ms);
report('config files', (await timed(() => js.named(LAYOUT))).ms, (await timed(() => held.named(LAYOUT))).ms);
report('directories', (await timed(() => js.directories())).ms, (await timed(() => held.directories())).ms);
report(
  'config digest, bounded',
  (await timed(() => js.configDigest(HEADER, LAYOUT, false))).ms,
  (await timed(() => held.configDigest(HEADER, LAYOUT, false))).ms,
);
report(
  'config digest, unbounded',
  (await timed(() => js.configDigest(HEADER, LAYOUT, true))).ms,
  (await timed(() => held.configDigest(HEADER, LAYOUT, true))).ms,
);

if (given === undefined) await rm(root, { recursive: true, force: true });

async function timed(work) {
  const at = process.hrtime.bigint();
  const value = await work();

  return { value, ms: Number(process.hrtime.bigint() - at) / 1e6 };
}

function report(stage, before, after) {
  const gain = before / after;
  console.log(
    `${stage.padEnd(26)} ${before.toFixed(1).padStart(9)} ms  ${after.toFixed(1).padStart(9)} ms  ${gain.toFixed(1)}x`,
  );
}

/**
 * A deterministic tree: `files` modules over a fan-out of directories, with the
 * manifests and configurations a real repository carries, then dirtied.
 */
async function generate(count) {
  const at = await mkdtemp(join(tmpdir(), 'variance-tree-cost-'));
  const wide = Math.max(1, Math.round(Math.sqrt(count) / 4));

  await writeFile(join(at, 'package.json'), '{ "name": "generated", "private": true }\n');
  await writeFile(join(at, 'yarn.lock'), '# generated\n');
  await writeFile(join(at, 'tsconfig.json'), '{ "compilerOptions": { "baseUrl": "." } }\n');

  const written = [];
  for (let index = 0; index < count; index += 1) {
    const packaged = index % wide;
    const nested = Math.floor(index / wide) % wide;
    const path = `packages/p${packaged}/src/d${nested}/m${index}.ts`;
    written.push(path);
    const to = index === 0 ? './m0.js' : `./m${index - 1}.js`;
    await file(at, path, `import { value } from '${to}';\nexport const value = ${index};\n`);
  }
  for (let packaged = 0; packaged < wide; packaged += 1) {
    await file(at, `packages/p${packaged}/package.json`, `{ "name": "p${packaged}" }\n`);
    await file(at, `packages/p${packaged}/tsconfig.json`, '{ "extends": "../../tsconfig.json" }\n');
  }

  await git(at, ['init', '--quiet']);
  await git(at, ['add', '-A']);
  await git(at, ['commit', '--quiet', '-m', 'one']);

  // A working tree nobody has touched is the case that does not happen. One in a
  // thousand files is edited and one in a thousand is untracked, so the overlay
  // has a batch to hash and the status has lines to parse.
  for (let index = 0; index < count; index += 1000) {
    await file(at, written[index], `export const value = ${index}; // edited\n`);
    await file(at, `${written[index].slice(0, -3)}.new.ts`, 'export const fresh = 1;\n');
  }

  return at;
}

async function file(at, path, contents) {
  const full = join(at, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents, 'utf8');
}

async function git(at, args) {
  await run('git', ['-c', 'user.email=m@example.test', '-c', 'user.name=M', ...args], { cwd: at });
}
