// compass: variance-authority.reach
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { coveringTestsInFile, testPlaces } from '@variance-authority/sense/test-selection';
import { HOUR, PAY, iso, oneRun, recordFixture } from './covering-record.fixture.js';

/**
 * One `covering` question reads each asked file's ranges from the case index
 * once, and where its test files last ran once, whatever parts of the answer
 * need them. Counted through the seam the command imports them from; the
 * fixture's `ask` answers twice, in JSON and in text, so each pass is half the
 * count.
 */

vi.mock('@variance-authority/sense/test-selection', async (importOriginal) => {
  const original = await importOriginal<typeof import('@variance-authority/sense/test-selection')>();
  return { ...original, coveringTestsInFile: vi.fn(original.coveringTestsInFile), testPlaces: vi.fn(original.testPlaces) };
});

const { checkout, ask } = recordFixture();
const cwd = process.cwd();

/** A runs record in which `src/pay.test.ts` last ran an hour ago over the committed text. */
const committed = (_: string, recorded: string | undefined) => ({ commit: recorded, ...oneRun(iso(Date.now() - HOUR), ['src/pay.test.ts']) });
/** The text the record holds: the committed one with line 5 edited, so the record has no place for a line 5 the committed text holds. */
const RECORDED = PAY.replace('return amount;', 'return amount + 0;');

/** How many times each pass of `argv` folded a file's ranges and placed test files. */
async function perPass(at: string, ...argv: string[]): Promise<{ readonly folds: number; readonly placings: number }> {
  vi.mocked(coveringTestsInFile).mockClear();
  vi.mocked(testPlaces).mockClear();
  await ask(at, ...argv);
  return { folds: vi.mocked(coveringTestsInFile).mock.calls.length / 2, placings: vi.mocked(testPlaces).mock.calls.length / 2 };
}

describe('one covering question, one pass', () => {
  it('folds the file once for a line the record has no place for, when the answer names no case', async () => {
    const { at } = await checkout({ ranOver: RECORDED, kept: true, runs: committed });
    await writeFile(join(at, 'src/pay.ts'), PAY.replace('{\n  if', '{ // held\n  if'));

    expect(await perPass(at, '--file', 'src/pay.ts', '--line', '5')).toEqual({ folds: 1, placings: 1 });
  });

  it('places the named test files and the ones that entered the file at once', async () => {
    const { at } = await checkout({ runs: committed });
    await writeFile(join(at, 'src/pay.ts'), PAY.replace('  }\n', '  }\n  const charged = amount;\n'));

    expect(await perPass(at, '--file', 'src/pay.ts', '--line', '1-7')).toEqual({ folds: 1, placings: 1 });
  });

  it('dates a whole-file answer that names no case by the fold it was answered from', async () => {
    const { at } = await checkout({ runs: committed });

    // The narrowing is read inside its own fold, so a range boundary marks where the claim changes: two folds, no third.
    expect(await perPass(at, '--file', 'src/pay.ts', '--at-distance', '2-3')).toEqual({ folds: 2, placings: 1 });
  });

  it('dates a stale answer that names no case by the fold it was answered from', async () => {
    const { at } = await checkout({ ranOver: RECORDED, runs: committed });

    expect(await perPass(at, '--file', 'src/pay.ts', '--line', '3', '--at-distance', '2-3')).toEqual({ folds: 1, placings: 1 });
  });

  it('folds each changed file once under `--since`', async () => {
    const { at } = await checkout({ runs: committed });
    await writeFile(join(at, 'src/pay.ts'), PAY.replace('return amount;', 'return amount * 1;'));
    await writeFile(join(at, 'src/pay.test.ts'), "import { pay } from './pay';\nexport const paid = pay(2);\n");

    // `git` reads the change from the working directory, as it does for a person asking in their checkout.
    process.chdir(at);
    try {
      expect(await perPass(at, '--since', 'HEAD')).toEqual({ folds: 2, placings: 1 });
    } finally {
      process.chdir(cwd);
    }
  });
});
