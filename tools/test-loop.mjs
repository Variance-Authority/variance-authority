/**
 * `yarn test:loop`: the verification an agent runs after every edit, small
 * enough that a red names the edit that caused it.
 *
 * Two checks, in order, stopping at the first red: the compiler, then the
 * tests no more than one import from the edit. "The edit" is what moved since
 * the last green invocation, kept as a marker in the cache; the first
 * invocation, and the first after a commit, start from `HEAD`. With nothing
 * moved, there is nothing to check. `--reset` forgets the marker.
 *
 * The marker holds the git blob of every file that differed from `HEAD` when
 * the last green run finished. Blobs are written with `git hash-object -w`,
 * which touches the object store and never the index, so a primary checkout
 * other people commit in stays theirs.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheRootFor } from '@variance-authority/sense/cache-root';

/** Git's empty blob: the text of a file that was not there. */
const EMPTY = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';

/** A read of a git object that may be absent: `undefined` when it is. */
function git(cwd, args, options = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, ...options });
  if (result.status !== 0 && !options.soft) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.status === 0 ? result.stdout : undefined;
}

/** The files that differ from `HEAD`, untracked included, ignored excluded. */
function dirtyPaths(root) {
  const tracked = git(root, ['diff', '--name-only', '-z', 'HEAD']).split('\0');
  const untracked = git(root, ['ls-files', '-o', '--exclude-standard', '-z']).split('\0');
  return new Set([...tracked, ...untracked].filter((path) => path !== ''));
}

/** The blob `path` holds at `HEAD`, or `undefined` for a file `HEAD` does not have. */
function headBlob(root, path) {
  return git(root, ['rev-parse', '-q', '--verify', `HEAD:${path}`], { soft: true })?.trim();
}

/** The blob `path` holds on disk now, written to the object store; `EMPTY` for a deleted file. */
function currentBlob(root, path) {
  return existsSync(join(root, path)) ? git(root, ['hash-object', '-w', '--', path]).trim() : EMPTY;
}

/**
 * What the tree looks like now, to compare the next invocation against: `HEAD`,
 * and the blob of every file that differs from it.
 */
export function snapshotOf(root) {
  const files = {};
  for (const path of dirtyPaths(root)) files[path] = currentBlob(root, path);
  return { head: git(root, ['rev-parse', 'HEAD']).trim(), files };
}

/**
 * The edit since `marker`: the files whose text moved. A marker taken at another `HEAD` is not read, so the base
 * is `HEAD` and a commit starts the loop over.
 */
export function footprintOf(root, marker) {
  const kept = marker !== undefined && marker.head === git(root, ['rev-parse', 'HEAD']).trim() ? marker.files : {};
  const dirty = dirtyPaths(root);
  const files = new Set();
  for (const path of new Set([...dirty, ...Object.keys(kept)])) {
    const now = dirty.has(path) ? currentBlob(root, path) : (headBlob(root, path) ?? EMPTY);
    const before = kept[path] ?? headBlob(root, path) ?? EMPTY;
    if (now === before) continue;
    files.add(path);
  }
  return files;
}

function readMarker(file, root) {
  try {
    const marker = JSON.parse(readFileSync(file, 'utf8'));
    return marker.root === root ? marker : undefined;
  } catch {
    return undefined;
  }
}

/** The compiler, incremental: red on any error, which it prints as it gave it. */
function types(root) {
  const run = spawnSync(join(root, 'node_modules/.bin/tsc'), ['--build', '--pretty', 'false'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  return run.status === 0 ? { red: [] } : { red: [`types: red\n${run.stdout}${run.stderr}`.trimEnd()] };
}

/**
 * Tests no more than one import from the edit, measured from the text each
 * last ran over. A selection that was declined is red: the loop does not fall
 * back to the whole suite.
 */
function testsAt(root, logFile) {
  const env = { ...process.env, VARIANCE_AUTHORITY_SINCE: '', VARIANCE_AUTHORITY_GRAIN: 'file', VARIANCE_AUTHORITY_AT_DISTANCE: '0-1' };
  const index = spawnSync('yarn', ['variance', 'index'], { cwd: root, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (index.status !== 0) return { red: [`tests: variance index failed\n${index.stdout}${index.stderr}`] };
  const run = spawnSync('yarn', ['test'], { cwd: root, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  const output = `${run.stdout}${run.stderr}`;
  mkdirSync(dirname(logFile), { recursive: true });
  writeFileSync(logFile, output);
  const declined = /declined: .*/.exec(output);
  if (declined !== null) return { red: [`tests: ${declined[0]}; the loop does not widen to the suite, see ${logFile}`] };
  const failed = [...new Set([...output.matchAll(/^ (?:FAIL|×) +(\S+)/gm)].map((match) => match[1]))];
  if (run.status !== 0) {
    const block = output.split('\n');
    const first = Math.max(0, block.findIndex((line) => /FAIL/.test(line)));
    const others = failed.length > 1 ? `\n  also red: ${failed.slice(1).join(' ')}` : '';
    return { red: [`tests: red at distance 0-1\n${block.slice(first, first + 30).join('\n')}${others}\n  full log: ${logFile}`] };
  }
  const selected = [...output.matchAll(/selected (none|\d+) of (\d+)/g)];
  const of = selected.map((match) => `${match[1]} of ${match[2]}`).join(', ');
  return { red: [], ok: `tests: ${of === '' ? 'ran' : `selected ${of}`}, distance 0-1, ok` };
}

function main(argv) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const cache = cacheRootFor(root);
  const markerFile = join(cache, 'test-loop.json');
  if (argv.includes('--reset')) {
    rmSync(markerFile, { force: true });
    console.log('loop: forgot the last invocation; the next one starts from HEAD');
    return 0;
  }
  const marker = readMarker(markerFile, root);
  if (marker !== undefined && footprintOf(root, marker).size === 0) {
    console.log('loop: no edits since the last invocation');
    return 0;
  }
  const compiled = types(root);
  if (compiled.red.length > 0) {
    console.log(compiled.red.join('\n'));
    return 1;
  }
  const tests = testsAt(root, join(cache, 'test-loop.log'));
  if (tests.red.length > 0) {
    console.log(`types: ok\n${tests.red.join('\n')}`);
    return 1;
  }
  const next = { root, ...snapshotOf(root) };
  mkdirSync(cache, { recursive: true });
  writeFileSync(markerFile, JSON.stringify(next));
  console.log(`types: ok\n${tests.ok}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
