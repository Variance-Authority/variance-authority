/**
 * `yarn test:loop`: what an agent runs after every edit, small enough to run
 * after every one (ADR-0096).
 *
 * The compiler, then the unit slice at distance `0-1`: the tests that entered
 * the change and those one import from it. The selection is read here, once,
 * by the function every seam asks (`selectSuite`), and the runner starts only
 * when the seam would keep a test (`kept`), so an edit that keeps no test costs
 * the compiler, the index and one reading. Both functions are loaded from `dist/`
 * after `tsc --build` has written it, so an edit to the selection is read by
 * the selection it makes. Integration and browser tests are the waves'.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inSlice } from './slices.mjs';

const ENV = {
  VARIANCE_AUTHORITY_SINCE: '',
  VARIANCE_AUTHORITY_GRAIN: 'file',
  VARIANCE_AUTHORITY_AT_DISTANCE: '0-1',
};

/** The unit test files in `root`'s working tree, tracked or new: what the runner discovers. */
export function discovered(root) {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  return listed
    .split('\n')
    .filter((path) => path !== '' && inSlice('unit', path) && existsSync(join(root, path)));
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

/**
 * What the loop says when the selection keeps no test: the lines the seam
 * prints before a run, then its verdict. A kept nothing is often a test that
 * entered the change and already ran over this text, so the loop says what the
 * selection read rather than that no test covers the change.
 */
export async function idle(value, files) {
  const { selectedLines } = await import('@variance-authority/sense/test-selection');
  return [...selectedLines(value, files), `test:loop: types clean; no unit test runs at 0-1 (${value.skip.size} skipped)`, ''].join('\n');
}

/** The index brought up to the working tree, then the unit slice's reading at `0-1` and the files it keeps, or what stopped it. */
async function read(root) {
  const indexed = await run('variance', ['index'], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (indexed.code !== 0) return { failed: indexed.out };
  try {
    const [{ selectSuite }, { kept }] = await Promise.all([
      import('@variance-authority/cli'),
      import('@variance-authority/sense/test-selection'),
    ]);
    const value = await selectSuite({ root, suite: 'unit', atDistance: { from: 0, to: 1 } });
    const files = discovered(root);
    return { value, files, runs: kept(value, files) };
  } catch (error) {
    return { failed: `test:loop: the unit selection could not be read: ${error?.stack ?? error}\n` };
  }
}

async function main() {
  const root = process.cwd();
  const types = await run('tsc', ['--build'], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (types.code !== 0) {
    process.stdout.write(types.out);
    return types.code;
  }
  const { failed, value, files, runs } = await read(root);
  if (failed !== undefined) {
    process.stderr.write(failed);
    return 1;
  }
  if (runs.length === 0) {
    process.stderr.write(await idle(value, files));
    return 0;
  }
  return (await run('vitest', ['run'], { env: ENV })).code;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
