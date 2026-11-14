import { afterEach, describe, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_REVIEW } from '../exit.js';
import type { Coverage } from './coverage.js';
import { lostVerdict } from './review-coverage.js';
import { BEFORE, changed } from './review-fixture.js';

// `ci-info` decides CI once, when it loads, so the module is cut: these questions are asked outside CI.
vi.mock('ci-info', () => ({ isCI: false }));

/** The base's `applyDiscount` as the tree holds it, so the pairing reads the same region on both sides. */
const UNTOUCHED = `${BEFORE}\nexport function round(price: number): number {\n  return Math.round(price);\n}\n`;

async function reviewed(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(['review', ...argv], {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

/**
 * `--fail-on-lost`: a project that requires a pull request to keep running what
 * its mainline ran. Driven through `main`, because the claim is the integer a CI
 * step reads.
 */
describe('a review that fails on regions the mainline ran and the change stopped running', () => {
  const cwd = process.cwd();
  afterEach(() => {
    process.chdir(cwd);
  });

  it('exits with the review code and counts the regions, in the unit the review prints', async () => {
    const { root, first, against } = await changed({ tree: UNTOUCHED, stopped: true });

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--fail-on-lost']);

    expect(code).toBe(EXIT_REVIEW);
    expect(err).toContain('1 region the mainline ran no case runs now');
  });

  it('stays clean on the same loss for a project that did not ask', async () => {
    const { root, first, against } = await changed({ tree: UNTOUCHED, stopped: true });

    expect((await reviewed(['--since', first, '--against', against, '--root', root, '--coverage'])).code).toBe(EXIT_CLEAN);
  });

  it('stays clean when every region the mainline ran still runs', async () => {
    const { root, first, against } = await changed({ tree: UNTOUCHED });

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--fail-on-lost']);

    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
  });

  it('says a base it could not read and does not fail on it', () => {
    const { failed, said } = lostVerdict([
      { suite: 'e2e', missed: 'the share holds no record' },
      { suites: [{ suite: 'unit', kind: 'unit', from: 'unit.bin', baseMissed: 'no base: unit is not given to the share' }] } as unknown as Coverage,
    ], () => false);

    expect(failed).toBe(false);
    expect(said).toEqual([
      'e2e was not compared, so what it stopped running is not known: the share holds no record',
      'unit was not compared, so what it stopped running is not known: no base: unit is not given to the share',
    ]);
  });

  describe('a file the suite stopped loading', () => {
    const departed = (ran: readonly string[]): Coverage => ({
      suites: [{ suite: 'unit', base: { change: { lost: 0, departed: { regions: 4, run: 2, files: ['src/kept.ts', 'src/cut.ts'], ran } } } }],
    }) as unknown as Coverage;
    const holds = (file: string): boolean => file === 'src/kept.ts';

    it('fails while the checkout still holds it: its last test went, and its code stayed', () => {
      const { failed, said } = lostVerdict([departed(['src/kept.ts'])], holds);

      expect(failed).toBe(true);
      expect(said.join('\n')).toContain('src/kept.ts');
    });

    it('passes when the file went with its code', () => {
      expect(lostVerdict([departed(['src/cut.ts'])], holds).failed).toBe(false);
    });

    it('passes when the mainline ran nothing in it, so nothing stopped', () => {
      expect(lostVerdict([departed([])], holds).failed).toBe(false);
    });
  });
});
