/**
 * `yarn test:loop`: what an agent runs after every edit, small enough to run
 * after every one (ADR-0096).
 *
 * The compiler, beside the unit slice at distance `0-1`: the tests that
 * entered the change and those one import from it. The selection is read here,
 * once, by the function every seam asks (`selectSuite`), and the runner starts
 * only when it keeps a test, so an edit no test entered costs the compiler,
 * the index and one reading. Integration and browser tests are the waves'.
 */

import { execFileSync, spawn } from 'node:child_process';
import { inSlice } from './slices.mjs';

const ENV = {
  VARIANCE_AUTHORITY_SINCE: '',
  VARIANCE_AUTHORITY_GRAIN: 'file',
  VARIANCE_AUTHORITY_AT_DISTANCE: '0-1',
};

/**
 * Whether the runner has to start: the reading declined, it keeps a test the
 * record knows, or a unit test file is new since the record, which it never
 * saw. The seam drops what the reading skips from what the runner discovers;
 * the record knows every discovered file but the new ones.
 */
export function starts(selection, added) {
  if (selection.declined !== undefined || added.length > 0) return true;
  return [...selection.whole].some((file) => !selection.skip.has(file));
}

/** The paths among `paths` that `commit` does not hold. */
export function addedSince(root, commit, paths) {
  if (paths.length === 0) return [];
  const held = execFileSync('git', ['ls-tree', '--name-only', commit, '--', ...paths], { cwd: root, encoding: 'utf8' });
  const there = new Set(held.split('\n'));
  return paths.filter((path) => !there.has(path));
}

function run(command, args, options = {}) {
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: options.stdio ?? 'inherit', env: { ...process.env, ...options.env } });
    let out = '';
    child.stdout?.on('data', (chunk) => (out += chunk));
    child.stderr?.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => done({ code: code ?? 1, out }));
  });
}

async function main() {
  const root = process.cwd();
  const compiled = run('tsc', ['--build'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const indexed = await run('variance', ['index'], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (indexed.code !== 0) {
    process.stderr.write(indexed.out);
    return indexed.code;
  }
  const { selectSuite } = await import('@variance-authority/cli');
  const selection = await selectSuite({ root, suite: 'unit', atDistance: { from: 0, to: 1 } });
  const { commit, unread } = selection.reading;
  const added = (commit === undefined ? unread : addedSince(root, commit, unread)).filter((path) => inSlice('unit', path));
  const types = await compiled;
  if (types.code !== 0) {
    process.stdout.write(types.out);
    return types.code;
  }
  if (!starts(selection, added)) {
    process.stderr.write(`test:loop: types clean; no unit test entered the change (${selection.whole.size} recorded)\n`);
    return 0;
  }
  return (await run('vitest', ['run'], { env: ENV })).code;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main();
