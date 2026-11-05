import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages.fixture.js';

/**
 * `variance ask` when the read an answer needs cannot be saved. The tools read
 * lines out of the source index on disk, so a read kept only in memory would
 * pair today's value with the index of the last read: it is dropped, and the
 * answer is the last generation's, saying what it did not compare.
 */

const HIDDEN = 'packages/kit/src/hidden.ts';

const HIDDEN_TEXT = 'export const shown = 1;\n/** Halves it. */\nfunction hiddenOf(amount: number): number {\n  return amount / 2;\n}\nexport const used = hiddenOf(shown);\n';

const OPTIONS = 'packages/kit/src/options.ts';

const OPTIONS_TEXT = 'export interface Options {\n  /** Whether CI. */\n  readonly ci: boolean;\n  /** The step. */\n  readonly step: string;\n}\n';

const NOT_COMPARED = /Snapshot \S+Z, not compared with the checkout \(it could not be read again: the source index could not be saved: /u;

/** The cache as a writer finds it when it cannot take the index's lock: a directory there refuses root too, as a mode would not. */
const unwritable = (): void => {
  const lock = `${sourceIndexPath(process.cwd())}.lock`;
  rmSync(lock, { force: true });
  mkdirSync(lock);
};

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-unsaved-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

describe('variance ask when what it read again cannot be saved', () => {
  it('says a moved file was not compared, and prints no text of it, for a name the file keeps to itself', async () => {
    const root = checkout({ [HIDDEN]: HIDDEN_TEXT });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    writeFileSync(join(root, HIDDEN), `// one\n// two\n${HIDDEN_TEXT}`);
    unwritable();

    const { code, out } = await run(['ask', 'symbol', '--name', 'hiddenOf']);

    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(NOT_COMPARED);
    expect(out).toContain(`declared, not exported, at ${HIDDEN}:3`);
    expect(out).not.toContain('Halves it');
    expect(out).not.toContain('// two');
  });

  it('keeps a member the file still holds, as the last read saw it', async () => {
    const root = checkout({ [OPTIONS]: OPTIONS_TEXT });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    writeFileSync(join(root, OPTIONS), `// one\n// two\n${OPTIONS_TEXT}`);
    unwritable();

    const { out } = await run(['ask', 'symbol', '--name', 'Options']);

    expect(out).toMatch(NOT_COMPARED);
    expect(out).toContain(`${OPTIONS}:3 — ci`);
    expect(out).toContain(`${OPTIONS}:5 — step`);
  });

  it('answers a renamed name from the last read, and refuses the new one without saying it was looked for', async () => {
    const root = checkout({ [HIDDEN]: HIDDEN_TEXT });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    writeFileSync(join(root, HIDDEN), HIDDEN_TEXT.replaceAll('hiddenOf', 'halfOf'));
    unwritable();

    expect((await run(['ask', 'symbol', '--name', 'hiddenOf'])).out).toMatch(NOT_COMPARED);
    const renamed = await run(['ask', 'symbol', '--name', 'halfOf']);
    expect(`${renamed.out}${renamed.err}`).toContain('could not be read again');
  });

  it('answers as ever when nothing an answer rests on moved', async () => {
    const root = checkout({ [HIDDEN]: HIDDEN_TEXT });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    writeFileSync(join(root, 'packages/kit/src/elsewhere.ts'), 'export const elsewhere = 1;\n');
    unwritable();

    const { out } = await run(['ask', 'symbol', '--name', 'hiddenOf']);

    expect(out).toContain(`declared, not exported, at ${HIDDEN}:3`);
    expect(out).toContain('Halves it');
    expect(out).not.toContain('not compared');
  });
});
