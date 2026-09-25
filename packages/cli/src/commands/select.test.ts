import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import {
  testCoverageFile,
  writeTestCoverage,
  type ExecutionNarrowing,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { formatSelection, selectionNotes, skippableTests } from './select.js';
import { selectOutput } from './select-command.js';
import { indexOutput } from './index-command.js';

/**
 * The one command that hands its answer to a runner this tool does not drive.
 *
 * Every assertion here is about the same asymmetry, one step sharper than the
 * one `journey.test.ts` is about. There, a subject skipped in error is a green
 * run over an unwatched surface. Here the consumer is a `vitest` or a `jest`
 * that will never know this tool was asked: a path that reaches its command
 * line wrongly is a test file that stops running, in a suite that stays green
 * and gets faster. So the cases below are mostly the ways this must decline to
 * narrow, and the two that check what reaches *stdout* — because stdout is the
 * part a shell substitutes without reading.
 */

const WHOLE = ['test/alpha.test.ts', 'test/beta.test.ts', 'test/gamma.test.ts'];

function reading(over: Partial<ExecutionNarrowing> = {}): ExecutionNarrowing {
  return { whole: WHOLE, entered: [], unread: [], stale: [], because: [], ...over };
}

describe('what a foreign runner may skip', () => {
  it('skips a recorded test file this diff never entered', () => {
    const { skip, widened, because } = skippableTests({
      at: '/cache/coverage.bin',
      commit: 'c0ffee',
      ground: { kind: 'read', narrowing: reading({ entered: ['test/beta.test.ts'] }) },
    });

    expect(skip).toEqual(['test/alpha.test.ts', 'test/gamma.test.ts']);
    expect(widened).toBeUndefined();
    expect(because).toContain('every other test file runs');
  });

  it('skips every recorded test file when the diff entered none, and never says run nothing', () => {
    // `entered: []` is the trap this command exists inside. Read as a *run*
    // list it is "run nothing" and the suite silently stops; read as the skip
    // list it is, it is the largest honest answer — every test the journal
    // recorded whole, and nothing it has never seen.
    const { skip, widened } = skippableTests({
      at: '/cache/coverage.bin',
      commit: 'c0ffee',
      ground: { kind: 'read', narrowing: reading() },
    });

    expect(skip).toEqual(WHOLE);
    expect(widened).toBeUndefined();
  });

  it('narrows past a changed file nothing recorded holds, and names it', () => {
    // `unread` is a report. A path the journal, the preconditions and the graph
    // all hold nothing about keeps no test in the run: the skip list is the one
    // `entered` gave, and the path is named so a fixture read undeclared can be
    // recognised and declared.
    const selection = skippableTests({
      at: '/cache/coverage.bin',
      commit: 'c0ffee',
      ground: {
        kind: 'read',
        narrowing: reading({ entered: ['test/beta.test.ts'], unread: ['docs/selecting.md'] }),
      },
    });

    expect(selection.skip).toEqual(['test/alpha.test.ts', 'test/gamma.test.ts']);
    expect(selection.widened).toBeUndefined();
    expect(selection.unread).toEqual(['docs/selecting.md']);
    expect(selection.notes.join('\n')).toContain('docs/selecting.md');
    expect(selectionNotes(selection)).not.toContain('skipping nothing');
  });

  it('names the first three unread paths and says there are more', () => {
    const { notes } = skippableTests({
      at: '/cache/coverage.bin',
      commit: 'c0ffee',
      ground: { kind: 'read', narrowing: reading({ unread: ['a.md', 'b.md', 'c.md', 'd.md'] }) },
    });

    expect(notes.join('\n')).toContain('4 changed files (a.md, b.md, c.md, …)');
  });

  it('refuses to narrow when the journal recorded nothing it can speak for', () => {
    // A journal exists and holds no complete observation, so no absence in it is
    // evidence. Same empty skip list as a diff that reached everybody, opposite
    // fact about the next run.
    const { skip, widened } = skippableTests({
      at: '/cache/coverage.bin',
      ground: { kind: 'read', narrowing: reading({ whole: [] }) },
    });

    expect(skip).toEqual([]);
    expect(widened).toContain('no whole observation');
  });

  it('names where a recording would have been when there is none', () => {
    const { skip, widened } = skippableTests({
      at: '/cache/variance-authority/test-selection/abc/coverage.bin',
      ground: { kind: 'no-journal' },
    });

    expect(skip).toEqual([]);
    // The path, because a repository whose build carries no probes has no other
    // way to learn the feature is there.
    expect(widened).toContain('/cache/variance-authority/test-selection/abc/coverage.bin');
  });

  it('refuses to narrow when the diff itself could not be read', () => {
    // An empty diff and an unobtainable one look identical, and one of them
    // means skip the entire suite.
    const { skip, widened } = skippableTests({
      at: '/cache/coverage.bin',
      ground: { kind: 'no-diff', from: 'origin/main' },
    });

    expect(skip).toEqual([]);
    expect(widened).toContain('origin/main');
  });

  it('refuses to narrow when the install could not be compared', () => {
    // A bump moves no line a test covered, so a journal read over it would skip
    // every test that imports the package.
    const { skip, widened } = skippableTests({
      at: '/cache/coverage.bin',
      ground: { kind: 'no-install', whole: 'yarn.lock is not in the tree at the base of this diff' },
    });

    expect(skip).toEqual([]);
    expect(widened).toContain('yarn.lock is not in the tree');
  });

  it('reports a module recorded from another text, having already widened for it', () => {
    // `stale` cannot make the skip list wrong — every region of such a module
    // was charged, so its tests are in `entered` already. It is printed because
    // it is a fact about the recording, and it is fixed by recording once over a
    // clean tree rather than by anything typed here.
    const selection = skippableTests({
      at: '/cache/coverage.bin',
      commit: 'c0ffee',
      ground: {
        kind: 'read',
        narrowing: reading({ entered: WHOLE, stale: ['src/widget.ts', 'src/other.ts'] }),
      },
    });

    expect(selection.skip).toEqual([]);
    expect(selection.notes.join('\n')).toContain('2 changed modules were recorded');
    expect(selectionNotes(selection)).toContain('src/widget.ts');
  });

  it('says a journal with no commit checked none of its line ranges', () => {
    const { notes } = skippableTests({
      at: '/cache/coverage.bin',
      ground: { kind: 'read', narrowing: reading({ entered: WHOLE }) },
    });

    expect(notes.join('\n')).toContain('names no commit');
  });
});

describe('what reaches the runner', () => {
  const selection = skippableTests({
    at: '/cache/coverage.bin',
    commit: 'c0ffee',
    ground: { kind: 'read', narrowing: reading({ entered: ['test/beta.test.ts'] }) },
  });

  it('writes bare paths by default, one per line, and nothing else', () => {
    expect(formatSelection(selection, 'plain', '/repo')).toBe(
      'test/alpha.test.ts\ntest/gamma.test.ts\n',
    );
  });

  it('writes vitest exclusions against the place on disk, not the path the journal counts from', () => {
    // A workspace is many vitest projects, and each one matches an exclude
    // pattern against its own directory. A pattern relative to the repository
    // root matches inside none of them, and an exclusion that matches nothing
    // is not an error in any runner — so a narrowed run would quietly be the
    // whole suite.
    expect(formatSelection(selection, 'vitest', '/repo')).toBe(
      '--exclude=/repo/test/alpha.test.ts\n--exclude=/repo/test/gamma.test.ts\n',
    );
  });

  it('hands jest back its own node_modules default, which the flag would otherwise replace', () => {
    // `--testPathIgnorePatterns` is not additive: jest's default is
    // `["/node_modules/"]` and one on the command line takes its place. A skip
    // list that forgot it would make a narrowed run walk `node_modules`.
    expect(formatSelection(selection, 'jest', '/repo').split('\n')).toEqual([
      '--testPathIgnorePatterns=/node_modules/',
      '--testPathIgnorePatterns=/test/alpha\\.test\\.ts$',
      '--testPathIgnorePatterns=/test/gamma\\.test\\.ts$',
      '',
    ]);
  });

  it('writes nothing at all to a shell when nothing is skipped', () => {
    // The reading a shell already has: `vitest $(variance select --format
    // vitest)` with nothing substituted is `vitest`, the whole suite. Every
    // sentence about why goes to the other stream, so a substitution cannot
    // pick one up and hand it to a runner as a path.
    const widened = skippableTests({ at: '/cache/coverage.bin', ground: { kind: 'no-journal' } });

    for (const format of ['plain', 'vitest', 'jest'] as const) {
      expect(formatSelection(widened, format, '/repo')).toBe('');
    }
    expect(selectionNotes(widened)).toContain('skipping nothing');
  });

  it('carries the whole reading under json, where the field names keep the two apart', () => {
    const said = JSON.parse(formatSelection(selection, 'json', '/repo')) as {
      skip: readonly string[];
      journal: { at: string; commit: string; recorded: { whole: number; entered: number } };
    };

    expect(said.skip).toEqual(['test/alpha.test.ts', 'test/gamma.test.ts']);
    expect(said.journal).toEqual({
      at: '/cache/coverage.bin',
      commit: 'c0ffee',
      recorded: { whole: 3, entered: 1 },
    });
  });
});

/**
 * The same rules with a real snapshot, a real checkout and a real diff under
 * them.
 *
 * The fixtures above assert the decision; these assert that the four things the
 * decision needs are actually fetched — the journal's path, the commit its line
 * ranges are coordinates in, the hunks, and the text at that commit. Every one
 * of them has a failure mode that reads as a clean answer, so none of them is
 * stood in for here.
 */
describe('reading this checkout', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    // Every journal these cases write is addressed through this, so none of them
    // can read or overwrite the recording this repository keeps for itself.
    process.env['XDG_CACHE_HOME'] = mkdtempSync(join(tmpdir(), 'va-select-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['XDG_CACHE_HOME'];
  });

  it('skips nothing and names the file when nothing has been recorded here', async () => {
    const root = mkdtempSync(join(tmpdir(), 'va-select-bare-'));

    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('');
    expect(said.err).toContain('skipping nothing: no execution journal at');
    expect(said.err).toContain(testCoverageFile(root));
  });

  it('refuses a snapshot it cannot read, rather than reporting nothing recorded', async () => {
    // The failure this whole subsystem is written to refuse. Something wrote
    // this file, and an answer that skipped it would look exactly like a
    // repository that never recorded anything.
    const root = mkdtempSync(join(tmpdir(), 'va-select-broken-'));
    const file = testCoverageFile(root);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'this is not a snapshot');

    await expect(selectOutput({ cwd: root, format: 'plain' })).rejects.toThrow(
      /could not be read/,
    );
  });

  it('skips the test files a real journal and a real diff rule out', async () => {
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head));

    // One line inside `other`, which only one recorded test ever entered.
    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'b';", "return 'c';"));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).toContain('skipping 2 of 3 test files recorded whole');
    // The frame check ran and agreed: the module was read at its line ranges
    // rather than charged whole for being unrecognisable.
    expect(said.err).not.toContain('recorded from a different text');
  });

  it('charges every region of a module whose recorded text is not the text at its commit', async () => {
    // The check `sourceAt` exists for, end to end. The snapshot is labelled with
    // a commit but describes a text that commit does not hold — a suite recorded
    // over a dirty tree, which is how a suite is normally recorded. Its line
    // numbers are coordinates in nothing, so no range may be read and every test
    // that touched the module runs.
    const { root, head } = checkout();
    const drifted = snapshot(head);
    const [module] = drifted.modules;
    await writeTestCoverage(testCoverageFile(root), {
      ...drifted,
      modules: [{ ...module!, sourceDigest: digestString(`${SOURCE}// another text\n`) }],
    });

    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'b';", "return 'c';"));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    // Both tests that ever entered the module run, and the one that never did is
    // still skipped: a stale frame is a fact about one module's line numbers, so
    // it widens over that module's observers and no further.
    expect(said.out).toBe('test/gamma.test.ts\n');
    expect(said.err).toContain('1 changed module was recorded from a different text');
    expect(said.err).toContain('src/widget.ts');
  });

  it('skips a test that mocked the changed module, where it entered only while the module evaluated', async () => {
    // The mock ran the real module to learn its shape, so the recording holds
    // `beta` inside `other` while `widget.ts` loaded. What `other` contains
    // cannot fail a test that replaced it, and only the file graph knows the
    // replacement is there.
    const said = await mockedBeta({ loaded: true });

    expect(said.out).toBe('test/alpha.test.ts\ntest/beta.test.ts\ntest/gamma.test.ts\n');
  });

  it('runs a test that mocked the changed module, where a case of it called in', async () => {
    // A mock is installed before the file's first case, so a crossing a case
    // made ran the real `other`: a passthrough, a restored implementation.
    const said = await mockedBeta({ loaded: false });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
  });

  async function mockedBeta({ loaded }: { loaded: boolean }) {
    const { root, head } = checkout({
      'test/beta.test.ts': "import { vi } from 'vitest';\nimport { other } from '../src/widget';\nvi.mock('../src/widget');\nother();\n",
    });
    const recorded = snapshot(head);
    const [module] = recorded.modules;
    await writeTestCoverage(testCoverageFile(root), {
      ...recorded,
      modules: [{
        ...module!,
        blocks: module!.blocks.map((block) => block.name === 'other' && loaded ? { ...block, loadedBy: ['test/beta.test.ts'] } : block),
      }],
    });

    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'b';", "return 'c';"));
    process.chdir(root);

    await indexOutput({ cwd: root });
    return selectOutput({ cwd: root, format: 'plain' });
  }

  it('narrows past a changed file no probe was ever in', async () => {
    // The scan holds `src/elsewhere.ts` and no measured module imports it, so
    // it is connected to nothing the suite ran: it keeps no test and is not
    // `unread`, which names only a path the graph does not hold either.
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head));

    writeFileSync(join(root, 'src/elsewhere.ts'), 'export const other = 2;\n');
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'vitest' });

    expect(said.out).toBe(
      ['alpha', 'beta', 'gamma'].map((name) => `--exclude=${join(root, `test/${name}.test.ts`)}\n`).join(''),
    );
    expect(said.err).not.toContain('skipping nothing');
    expect(said.err).not.toContain('records nothing about');
    expect(said.err).toContain('skipping 3 of 3 test files recorded whole');
  });
});

const SOURCE = [
  'export function widget(): string {',
  "  return 'a';",
  '}',
  '',
  'export function other(): string {',
  "  return 'b';",
  '}',
  '',
].join('\n');

/** A checkout holding exactly the text the snapshot below is recorded against. */
function checkout(files: Readonly<Record<string, string>> = {}): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'va-select-'));
  const git = (args: readonly string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/widget.ts'), SOURCE);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);

  return { root, head: git(['rev-parse', 'HEAD']) };
}

/**
 * One module, two functions, three tests — and the third entered nothing at all,
 * which is what makes the skip list bigger than the diff.
 */
function snapshot(commit: string): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [
      { file: 'test/alpha.test.ts', complete: true, preconditions: [] },
      { file: 'test/beta.test.ts', complete: true, preconditions: [] },
      { file: 'test/gamma.test.ts', complete: true, preconditions: [] },
    ],
    modules: [
      {
        file: 'src/widget.ts',
        sourceDigest: digestString(SOURCE),
        instrumented: true,
        blocks: [
          {
            ordinal: 0,
            kind: 'module',
            digest: digestString('module'),
            name: 'widget.ts',
            path: 'module',
            startLine: 1,
            endLine: 8,
            source: true,
            testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'],
          },
          {
            ordinal: 1,
            kind: 'function',
            owner: 0,
            digest: digestString('widget'),
            name: 'widget',
            path: 'widget',
            startLine: 1,
            endLine: 3,
            source: true,
            testFiles: ['test/alpha.test.ts'],
          },
          {
            ordinal: 2,
            kind: 'function',
            owner: 0,
            digest: digestString('other'),
            name: 'other',
            path: 'other',
            startLine: 5,
            endLine: 7,
            source: true,
            testFiles: ['test/beta.test.ts'],
          },
        ],
      },
    ],
  };
}
