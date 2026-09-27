import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';

/**
 * `variance ask slowest-tests`, through the command a person types: the
 * durations are the ones a recording holds, and a checkout that never recorded
 * one is told where the question looked.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['XDG_CACHE_HOME'] = mkdtempSync(join(tmpdir(), 'va-slowest-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['XDG_CACHE_HOME'];
});

function checkout(): string {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-slowest-')));
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  process.chdir(root);
  return root;
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('variance ask slowest-tests', () => {
  it('lists the slowest recorded files up to the limit asked for', async () => {
    const root = checkout();
    const at = testCoverageFile(root);
    await writeTestCoverage(at, {
      version: 3,
      instrumentation: 'fixture-instrumentation',
      tests: [
        { file: 'test/fast.test.ts', complete: true, preconditions: [], duration: 12 },
        { file: 'test/slow.test.ts', complete: true, preconditions: [], duration: 2400 },
        { file: 'test/untimed.test.ts', complete: true, preconditions: [] },
      ],
      modules: [],
    });

    expect(await run(['ask', 'slowest-tests', '--limit', '1'])).toEqual({
      code: EXIT_CLEAN,
      err: '',
      out: [
        `Slowest recorded test files, as their runner reported them, from ${at}:`,
        '  2.4 s  test/slow.test.ts',
        '1 of 2 timed file(s) shown; 1 recorded file(s) have no duration.',
        '',
      ].join('\n'),
    });
  });

  it('says where it looked when this checkout has recorded nothing', async () => {
    const root = checkout();

    const answered = await run(['ask', 'slowest-tests']);

    expect(answered.code).toBe(EXIT_CLEAN);
    expect(answered.out).toBe(
      `Slowest recorded test files: none read from ${testCoverageFile(root)}, nothing is recorded there. ` +
        'A recorded test run writes it.\n',
    );
  });

  it('refuses a limit that is not a count of files', async () => {
    checkout();

    const refused = await run(['ask', 'slowest-tests', '--limit', 'many']);

    expect(refused.code).toBe(EXIT_OPERATOR);
    expect(refused.out).toBe('');
  });
});
