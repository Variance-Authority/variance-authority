import { describe, expect, it } from 'vitest';
import type { ExecutionNarrowing } from '@variance-authority/sense/test-selection';
import { formatSelection, selectionNotes, skippableTests } from './select.js';

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

  it('narrows past a file a suite declining relations did not measure, and names it declined, not unread', () => {
    // The graph was not asked, so "records nothing" would be a claim nobody
    // checked: the suite said its unmeasured files go nowhere, and the note says so.
    const selection = skippableTests({
      at: '/cache/coverage.bin',
      commit: 'c0ffee',
      ground: {
        kind: 'read',
        narrowing: reading({ entered: ['test/beta.test.ts'], declined: ['src/added.ts'] }),
      },
    });

    expect(selection.skip).toEqual(['test/alpha.test.ts', 'test/gamma.test.ts']);
    expect(selection.declined).toEqual(['src/added.ts']);
    expect(selection.notes.join('\n')).toContain('the suite declines relations');
    expect(selection.notes.join('\n')).toContain('src/added.ts');
    expect(selection.notes.join('\n')).not.toContain('records nothing');
    expect(JSON.parse(formatSelection(selection, 'json', '/repo'))).toMatchObject({ unread: [], declined: ['src/added.ts'] });
  });

  it('leaves declined out of an answer from a suite that asks the graph', () => {
    const selection = skippableTests({ at: '/cache/coverage.bin', ground: { kind: 'read', narrowing: reading() } });

    expect(selection.declined).toBeUndefined();
    expect(JSON.parse(formatSelection(selection, 'json', '/repo'))).not.toHaveProperty('declined');
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
    // it is a fact about the recording: a text the landing did not keep, which
    // the next run that loads the module records again.
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

  it('writes each vitest exclusion from the directory vitest runs in, and as the place on disk', () => {
    // Vitest 2 matches an exclusion only relative to the project's directory;
    // vitest 3 and later also match the absolute path, which is the only form
    // that reaches every project of a workspace. An exclusion that matches
    // nothing is not an error, so a narrowed run would quietly be the whole
    // suite: each file goes out in both forms.
    expect(formatSelection(selection, 'vitest', '/repo', '/repo/test')).toBe(
      '--exclude=alpha.test.ts\n--exclude=/repo/test/alpha.test.ts\n--exclude=gamma.test.ts\n--exclude=/repo/test/gamma.test.ts\n',
    );
  });

  it('writes only the place on disk when a file that runs ends in the relative path', () => {
    // Each project of a workspace matches `test/alpha.test.ts` against its own
    // directory, so from the top it would also skip the app's test, which runs.
    const shared = skippableTests({
      at: '/cache/coverage.bin',
      ground: {
        kind: 'read',
        narrowing: reading({
          whole: ['packages/app/test/alpha.test.ts', 'test/alpha.test.ts', 'test/gamma.test.ts'],
          entered: ['packages/app/test/alpha.test.ts'],
        }),
      },
    });

    expect(formatSelection(shared, 'vitest', '/repo')).toBe(
      '--exclude=/repo/test/alpha.test.ts\n--exclude=test/gamma.test.ts\n--exclude=/repo/test/gamma.test.ts\n',
    );
  });

  it('writes only the place on disk for a vitest run from outside the file', () => {
    // A project rooted in `/repo/src` globs nothing under `/repo/test`, and a
    // `../` pattern is one no glob of that project ever produces.
    expect(formatSelection(selection, 'vitest', '/repo', '/repo/src')).toBe(
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
