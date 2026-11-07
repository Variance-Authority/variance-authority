import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeAsSetExecutionIndex, landRun, testCoverageFile } from '@variance-authority/sense/test-selection';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../bin.fixture.js';
import { EXIT_CLEAN, EXIT_OPERATOR, EXIT_REVIEW } from '../exit.js';
import { probedModule } from './mainline-fixture.js';
import { AFTER, BEFORE, DISCOUNTS, block, changed, git, noRowsBy, roundedBy } from './review-fixture.js';

// `ci-info` decides CI once, when it loads, so the module is cut: these questions are asked outside CI.
vi.mock('ci-info', () => ({ isCI: false }));

/**
 * `--fail-on-uncovered`: a project that requires every changed function to have
 * run under a case. Driven through `main`, because the claim is about the
 * integer a CI step reads, and about what stands written when it reads it.
 */

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

describe('a review that fails on a changed function no case ran', () => {
  const cwd = process.cwd();
  afterEach(() => {
    process.chdir(cwd);
  });

  it('exits with the review code and names the function, the number the review prints', async () => {
    const { root, first, against } = await changed();

    const { code, out, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--format', 'markdown', '--fail-on-uncovered']);

    expect(code).toBe(EXIT_REVIEW);
    expect(out).toContain('**1 of 2 changed functions has code no case ran:** `round`.');
    expect(err).toContain('1 of 2 changed functions has code no case ran: `round`');
  });

  it('writes everything a review writes before it exits, so the failure has a review to point at', async () => {
    const { root, first, against } = await changed();
    const at = await mkdtemp(join(tmpdir(), 'variance-review-out-'));

    const { code } = await reviewed(['--since', first, '--against', against, '--root', root, '--out', at, '--fail-on-uncovered']);

    expect(code).toBe(EXIT_REVIEW);
    expect(await readFile(join(at, 'review.md'), 'utf8')).toContain('`round`');
    expect(JSON.parse(await readFile(join(at, 'review.json'), 'utf8'))).toMatchObject({ record: 'ran' });
  });

  it('stays clean on the same change for a project that did not ask', async () => {
    const { root, first, against } = await changed();

    expect((await reviewed(['--since', first, '--against', against, '--root', root])).code).toBe(EXIT_CLEAN);
  });

  it('stays clean when a case ran every changed function', async () => {
    const { root, first, against } = await changed({ gone: true });

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--fail-on-uncovered']);

    expect(code).toBe(EXIT_CLEAN);
    expect(err).toBe('');
  });

  it('is not green and calls nothing uncovered when the record is from before the change', async () => {
    const { root, first, against } = await changed({ text: BEFORE });
    const at = await mkdtemp(join(tmpdir(), 'variance-review-out-'));

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--out', at, '--fail-on-uncovered']);

    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('the record does not hold this change');
    expect(err).not.toContain('no case ran:');
    expect(await readFile(join(at, 'review.md'), 'utf8')).toContain('the record holds no case for');
  });

  const FEE = { 'src/fee.ts': ['export function fee(): number {\n  return 1;\n}\n', 'export function fee(): number {\n  return 2;\n}\n'] } as const;

  it('names a changed file no run loaded and counts nothing for it, beside a function no case ran', async () => {
    const { root, first, against } = await changed({ others: FEE });

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--fail-on-uncovered']);

    expect(code).toBe(EXIT_REVIEW);
    expect(err).toContain('1 of 2 changed functions has code no case ran: `round`.');
    expect(err).toContain('`src/fee.ts` changed and no run loaded it, so the count says nothing of it.');
  });

  /** The run at `first` lists itself, as a run of this commit does, and `src/total.ts` is all it loaded. */
  const listRun = (root: string, first: string, listed: { readonly commit?: string } = { commit: first }) => landRun(testCoverageFile(root), {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    ...listed,
    tests: [{ file: 'test/total.test.ts', complete: true, preconditions: [] }],
    modules: [probedModule(['test/total.test.ts'])],
  }, root, undefined, {
    fresh: encodeAsSetExecutionIndex({ tests: [DISCOUNTS], modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 1, 3, [0])] }] }),
    run: { tests: [{ file: 'test/total.test.ts', complete: true }], ...listed },
  });

  /** The change committed, so the tree is the commit a run can name. */
  const committed = (root: string): string => {
    git(root, ['add', 'src', 'test', 'config.json']);
    git(root, ['commit', '--quiet', '-m', 'change']);
    return git(root, ['rev-parse', 'HEAD']);
  };

  it('does not go red on a changed file a run of this commit did not load, which has no answer, and says so', async () => {
    const { root, first, against } = await changed({ tree: BEFORE, others: FEE });
    await listRun(root, committed(root));

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--fail-on-uncovered']);

    expect(code).toBe(EXIT_CLEAN);
    expect(err).toContain('`src/fee.ts` changed and no run loaded it');
  });

  it('is not green when the run listed is of this commit and the tree holds edits on top of it, which no run saw', async () => {
    const { root, first, against } = await changed({ tree: BEFORE, others: FEE });
    await listRun(root, first);

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--fail-on-uncovered']);

    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('nothing shows a run of this change');
  });

  it('says in the comment what the log says of a changed file no run loaded, and counts only what a run loaded', async () => {
    const { root, first, against } = await changed({ gone: true, others: FEE });

    const { code, out, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--format', 'markdown', '--fail-on-uncovered']);
    const said = '`src/fee.ts` changed and no run loaded it, so the count says nothing of it.';

    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('> Every one of the 2 changed functions a run loaded ran under a case.');
    expect(out).toContain(`> ${said}`);
    expect(err).toContain(said);
  });

  it('claims every changed function when no changed source is left out of the count', async () => {
    const { root, first, against } = await changed({ gone: true });

    const { out } = await reviewed(['--since', first, '--against', against, '--root', root, '--format', 'markdown']);

    expect(out).toContain('> Every one of the 2 changed functions ran under a case.');
  });

  /** `round` written under `applyDiscount`, which the base does not hold. */
  const APPENDED = `${BEFORE}\nexport function round(price: number): number {\n  return Math.round(price);\n}\n`;
  /** `applyDiscount` with its one statement deleted, so the change writes no line. */
  const EMPTIED = BEFORE.replace('  return price * 0.9;\n', '');
  /** A comment written above `applyDiscount`, which moves it and changes nothing that runs. */
  const COMMENTED = `// Prices are in cents.\n${BEFORE}`;
  /** A record's rows that no line of the change meets, as a record from before the change holds them: `round` stands past the tree's end. */
  const PAST_THE_CHANGE = { applyDiscount: [1, 3], round: [20, 22] } as const;

  it('goes red on a function appended to a file a run of this change recorded', async () => {
    const { root, first, against } = await changed({ tree: APPENDED });

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--fail-on-uncovered']);

    expect(code).toBe(EXIT_REVIEW);
    expect(err).toContain('no case ran: `round`');
  });

  it.each([
    ['a function appended to a recorded file', APPENDED],
    ['a line deleted inside a function', EMPTIED],
  ])('is not green on %s when the record is from before the change', async (_, tree) => {
    const { root, first, against } = await changed({ tree, text: BEFORE, lines: PAST_THE_CHANGE });

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--fail-on-uncovered']);

    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('the record does not hold this change in `src/total.ts`');
  });

  it('stays green on a line deleted inside a function a run of this change recorded, which leaves nothing to run', async () => {
    const { root, first, against } = await changed({ tree: EMPTIED, lines: PAST_THE_CHANGE });

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--fail-on-uncovered']);

    expect(code).toBe(EXIT_CLEAN);
    expect(err).toBe('');
  });

  it('names a file no run loaded when the change only deleted lines from it', async () => {
    const { root, first, against } = await changed({ gone: true, others: { 'src/fee.ts': ['export function fee(): number {\n  log();\n  return 1;\n}\n', 'export function fee(): number {\n  return 1;\n}\n'] } });

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--fail-on-uncovered']);

    expect(code).toBe(EXIT_CLEAN);
    expect(err).toContain('`src/fee.ts` changed and no run loaded it');
  });

  it.each([
    ['a run of this change', COMMENTED],
    ['a record from before the change', BEFORE],
  ])('stays green on a comment, which changes nothing that runs, over %s', async (_, text) => {
    const { root, first, against } = await changed({ tree: COMMENTED, text, lines: PAST_THE_CHANGE });

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--fail-on-uncovered']);

    expect(code).toBe(EXIT_CLEAN);
    expect(err).toBe('');
  });

  it('is not green on an edited function outside the record when nothing shows a run of this change', async () => {
    const { root, first, against } = await changed({ tree: BEFORE, others: FEE });

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--fail-on-uncovered']);

    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('`src/fee.ts`');
    expect(err).toContain('nothing shows a run of this change');
  });

  it('is not green when the runs listed name no commit, which shows no run of this one', async () => {
    const { root, first, against } = await changed({ tree: BEFORE, others: FEE });
    await listRun(root, first, {});

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--fail-on-uncovered']);

    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('nothing shows a run of this change');
  });

  it('is not green on a new source file when nothing shows a run of this change', async () => {
    const { root, first, against } = await changed({ tree: BEFORE });
    await writeFile(join(root, 'src/fresh.ts'), 'export function fresh(): number {\n  return 1;\n}\n');

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--fail-on-uncovered']);

    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('`src/fresh.ts`');
  });

  it('stays green on a change to documents alone, which no run has to load', async () => {
    const { root, first, against } = await changed({ tree: BEFORE, others: { 'README.md': ['# Total\n', '# Totals\n'] } });

    const { code, err } = await reviewed(['--since', first, '--against', against, '--root', root, '--fail-on-uncovered']);

    expect(code).toBe(EXIT_CLEAN);
    expect(err).toBe('');
  });

  describe('with a suite named and every suite read, the form the action runs', () => {
    const STALE = `${AFTER}\n`;
    const twoSuites = (root: string, first: string, against: string) =>
      reviewed(['--since', first, '--against', against, '--suite', 'unit', '--coverage', '--root', root, '--fail-on-uncovered']);

    it('is green when the named suite holds no row and another ran everything', async () => {
      const { root, first, against } = await changed({ suites: ['e2e', 'unit'], gone: true });
      await noRowsBy(root, first, 'unit');

      expect((await twoSuites(root, first, against)).code).toBe(EXIT_CLEAN);
    });

    it('is green when the named suite ran other text and another ran everything', async () => {
      const { root, first, against } = await changed({ suites: ['e2e', 'unit'], gone: true });
      await roundedBy(root, first, 'unit', STALE);

      expect((await twoSuites(root, first, against)).code).toBe(EXIT_CLEAN);
    });

    it('names what another suite left unrun when the named suite ran other text', async () => {
      const { root, first, against } = await changed({ suites: ['e2e', 'unit'] });
      await roundedBy(root, first, 'unit', STALE);

      const { code, err } = await twoSuites(root, first, against);

      expect(code).toBe(EXIT_REVIEW);
      expect(err).toContain('has code no case ran: `round`');
    });

    it('says in the comment what it says on the log, when the named suite ran other text', async () => {
      const { root, first, against } = await changed({ suites: ['e2e', 'unit'] });
      await roundedBy(root, first, 'unit', STALE);

      const { out } = await reviewed(['--since', first, '--against', against, '--root', root, '--suite', 'unit', '--coverage', '--fail-on-uncovered', '--format', 'markdown']);

      expect(out).toContain('code no case ran:** `round`');
      expect(out).not.toContain('the record holds no case for');
    });

    it('refuses when no suite ran the file as the tree holds it', async () => {
      const { root, first, against } = await changed({ suites: ['e2e', 'unit'], text: STALE });
      await roundedBy(root, first, 'unit', STALE);

      const { code, err } = await twoSuites(root, first, against);

      expect(code).toBe(EXIT_OPERATOR);
      expect(err).toContain('`src/total.ts`');
    });
  });

  it.each([
    [['--from-run', '123', '--fail-on-uncovered'], '--from-run prints the review the run already made', '--fail-on-uncovered'],
    [['--format', 'handover', '--fail-on-uncovered'], '--format handover reads this checkout before CI runs', '--fail-on-uncovered'],
  ])('refuses %j, which reads no count of its own', async (argv, refusal, flag) => {
    const { code, err } = await reviewed(argv);

    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain(refusal);
    expect(err).toContain(flag);
  });
});
