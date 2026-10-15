import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, paragraph, run } from './ask-packages-fixture.js';

/**
 * `variance ask` about a name a file declares at its top level and does not
 * export. The source index holds every top-level declaration of every file,
 * and `symbol` and `search` read only the exported ones, so a private function
 * `git grep` finds at once was answered with *the dependency lexicon is not
 * published* and *nothing in this repository is named* that.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-declared-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const RELAUNCH = {
  'packages/kit/src/money/restart.ts': [
    'export const restart = (argv: readonly string[]): number => relaunch(argv);',
    '',
    '/** Start the program again in a process of its own. */',
    'function relaunch(argv: readonly string[]): number {',
    '  return argv.length;',
    '}',
    '',
  ].join('\n'),
};

describe('variance ask about a name declared and not exported', () => {
  it('answers `symbol` with where it is declared, its signature and its documentation', async () => {
    checkout(RELAUNCH);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'symbol', '--name', 'relaunch']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    const block = paragraph(out, /^relaunch \[function\]\n/);
    expect(block).toContain('declared, not exported, at packages/kit/src/money/restart.ts:4 by @acme/kit');
    expect(block).toContain('function relaunch(argv: readonly string[]): number');
    expect(block).toContain('Start the program again in a process of its own.');
    expect(block).toContain('Nothing outside packages/kit/src/money/restart.ts can import it');
  });

  it('answers `search` with the declaration, under a heading that says it is not exported', async () => {
    checkout(RELAUNCH);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'search', '--query', 'launch']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).not.toContain('Nothing in this repository is named or documented with `launch`');
    expect(out).toMatch(/^1 more name is declared somewhere in the repository without being exported:$/m);
    expect(out).toMatch(/^relaunch \[function\] — @acme\/kit · packages\/kit\/src\/money\/restart\.ts:4$/m);
  });

  it('lists a declaration its file exports under its own name once, as the export', async () => {
    checkout(RELAUNCH);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'search', '--query', 'restart']);
    expect(out).toMatch(/^restart — @acme\/kit · packages\/kit\/src\/money\/restart\.ts:1$/m);
    expect(out).not.toContain('without being exported');
  });

  it('answers `search` from a start point only with the declarations in its reach', async () => {
    checkout(RELAUNCH);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const near = await run(['ask', 'search', '--query', 'launch', '--from', 'packages/kit/src/money/restart.ts']);
    expect(near.out).toMatch(/^relaunch \[function\] — @acme\/kit · packages\/kit\/src\/money\/restart\.ts:4$/m);

    const far = await run(['ask', 'search', '--query', 'launch', '--from', 'apps/app/src/hello.ts']);
    expect(far.out).not.toContain('relaunch');
  });
});
