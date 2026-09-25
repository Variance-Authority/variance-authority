/**
 * `variance select` — the skip list, for a runner that is not this one.
 *
 * Every other use of the execution journal in this tool is inside a run it also
 * drives: `variance run --since` asks which subjects the diff reached and then
 * paints the rest itself. That is one process holding both halves of the
 * answer, and it leaves the journal unreachable from exactly the place most
 * repositories keep their tests — a plain `vitest`, a `jest`, a CI shell script
 * that this tool never enters. This command is that half on its own: a diff
 * goes in, and what comes out is a list of test files the recorded journal
 * proves the diff did not reach.
 *
 * ## It emits what to skip, never what to run
 *
 * The journal is an incomplete record on purpose. It speaks for the tests it
 * recorded whole and for no others, so a test it has never seen — added this
 * morning, skipped last time, run on another machine — is absent from every
 * list it produces. A *run list* built from `entered` would therefore drop that
 * test silently, and the failure has a shape that hides it: the run is green,
 * faster than yesterday, and nobody counts the suite.
 *
 * A skip list cannot fail that way. Whatever the journal has never heard of is
 * not in it, so the foreign runner keeps it. `entered` coming back empty means
 * *the diff reached nobody the journal recorded*, and it produces the largest
 * honest skip list rather than the instruction to run nothing — the two
 * readings of the same empty list that
 * [`journey.ts`](./journey.ts) exists to hold apart, met here in the one place
 * where confusing them would be a suite that stopped running with no error.
 *
 * ## The four ways it declines to narrow, each said out loud
 *
 * Skipping nothing is a correct answer and a common one, and it is also what a
 * broken invocation looks like. So every one of them is a sentence on stderr
 * rather than an empty stdout an operator has to interpret:
 *
 * - **No journal.** The ordinary state of a repository whose suite has never
 *   been recorded. Nothing is skipped, and the path a recording would be at is
 *   named, because that is the only way to learn the feature is there.
 * - **No diff.** Not a checkout, no such ref, a shallow clone. Refusing to
 *   narrow is the only safe reading: an empty diff and an unobtainable one look
 *   identical, and one of them means *skip everything*.
 * - **No install to compare.** The lockfile is missing at the diff's base, or
 *   this cannot read it. Any package may have moved, and a bump shows in no
 *   line a test covered, so every test that imports one would be skipped.
 * - **Nothing recorded whole.** A journal exists and holds no complete
 *   observation of any test, so no absence in it is evidence.
 *
 * Each of the four is a reading that could not be made. A reading that was
 * made and found nothing is an answer, and it is given.
 *
 * ## An unread path is named, and keeps nothing in the run
 *
 * `unread` is a changed path the journal, the declared preconditions and the
 * file graph all say nothing about. The ways a real module could land there
 * are closed where they arise rather than here: a module the recorder loaded
 * and could not instrument is declared a precondition of every test that loaded
 * it, and a module with no row is answered by the nearest measured files that
 * import it. What is left is a file the suite does not import — prose, a
 * workflow, a fixture read with `fs`, a script it spawns — and for the last two
 * the suite's own declaration is the fix, because only the suite knows it
 * reads them.
 *
 * Widening on it would put the cost on the wrong commit. Every change that
 * touches a README would run the whole suite, which empties the skip list on
 * exactly the commits where it is longest, and it would still say nothing about
 * the fixture a test reads undeclared. So the paths are named on stderr and in
 * `json`'s `unread`, and the answer is the one the journal gave.
 *
 * ## Stale is already handled, and is reported anyway
 *
 * A module whose recorded text disagrees with the text at the snapshot's own
 * commit has had every one of its regions charged, so its tests are already in
 * `entered` and the skip list is already safe. It is printed because it is a
 * fact about the *recording* — a suite recorded over a dirty tree — and it is
 * fixed by recording once on a clean one rather than by anything an operator
 * could type here.
 */

import { resolve } from 'node:path';
import { readingLines, type ExecutionNarrowing, type FileReading } from '@variance-authority/sense/test-selection';
import { many } from './reach.js';

/** How the answer is written for whoever is about to run the tests. */
export type SelectFormat = 'plain' | 'json' | 'vitest' | 'jest';

/**
 * What the journal answered, or why it did not.
 *
 * Four states rather than an optional reading, because *no snapshot*, *no
 * diff*, *no install to compare* and *a snapshot that answered* are four
 * different claims and only one of them is about the tests. Collapsing the
 * first three into an empty narrowing would make a broken `git` print the same
 * thing as a clean recording.
 */
export type SelectGround =
  | { readonly kind: 'read'; readonly narrowing: ExecutionNarrowing }
  | { readonly kind: 'no-journal' }
  | { readonly kind: 'no-diff'; readonly from: string }
  | { readonly kind: 'no-install'; readonly whole: string };

export interface SelectInput {
  /** Where the journal is, or would have been. Named in every outcome. */
  readonly at: string;
  /** The commit the journal's line ranges are coordinates in, when it named one. */
  readonly commit?: string;
  /**
   * The change was handed in by the caller, who vouches that it is in the
   * journal's coordinates. A journey file names no commit and needs none: it is
   * read against whatever diff it is given, a synthetic one included.
   */
  readonly given?: boolean;
  readonly ground: SelectGround;
}

export interface TestSelection {
  /**
   * Test files the journal proves this diff did not reach.
   *
   * A skip list. Empty means *skip nothing*, never *run nothing*, and
   * {@link TestSelection.widened} says which of the four reasons it was.
   */
  readonly skip: readonly string[];

  /**
   * Why the journal ruled nothing out, when it did not.
   *
   * Present is a statement about the *journal* or the *diff*, not about the
   * tests. A diff that reached everybody and a journal that could not be asked
   * produce the same empty list, and an operator reading a runner's own output
   * has no other way to tell them apart.
   */
  readonly widened?: string;

  /** One sentence for the operator, whichever way it went. */
  readonly because: string;

  /** Facts about the recording itself that survive the answer. */
  readonly notes: readonly string[];

  /** Carried so the machine-readable form can name the journal it read. */
  readonly at: string;
  readonly commit?: string;
  /** Counts rather than lists: `whole` is the whole suite, and nobody reads it. */
  readonly recorded?: { readonly whole: number; readonly entered: number };
  readonly unread: readonly string[];
  readonly stale: readonly string[];
  /**
   * What the parser made of each changed file. Absent when no diff was read
   * against the journal, which is not the same as a diff that changed nothing.
   */
  readonly readings?: readonly FileReading[];
}

/**
 * Decide what a foreign runner may skip.
 *
 * Pure, and takes the journal as a value: reading a binary snapshot out of a
 * user cache and walking git for a diff both belong to the caller, which is
 * what makes every rule above assertable with no cache, no repository and no
 * suite.
 */
export function skippableTests(input: SelectInput): TestSelection {
  const base = {
    skip: [] as readonly string[],
    at: input.at,
    ...(input.commit === undefined ? {} : { commit: input.commit }),
    unread: [] as readonly string[],
    stale: [] as readonly string[],
    notes: [] as readonly string[],
  };

  if (input.ground.kind === 'no-journal') {
    return {
      ...base,
      widened: `no execution journal at ${input.at}`,
      because: 'nothing to narrow by, so every test file runs',
    };
  }

  if (input.ground.kind === 'no-diff') {
    return {
      ...base,
      widened: `cannot read what changed since ${input.ground.from}`,
      because: 'no diff, so every test file runs',
    };
  }

  if (input.ground.kind === 'no-install') {
    return {
      ...base,
      widened: input.ground.whole,
      because: 'a package bump shows in no covered line, so every test file runs',
    };
  }

  const { whole, entered, unread, stale, readings } = input.ground.narrowing;
  const notes = [...unreadNotes(unread), ...recordingNotes(stale, input.commit, input.given === true)];
  const measured = {
    ...base,
    notes,
    unread,
    stale,
    ...(readings === undefined ? {} : { readings }),
    recorded: { whole: whole.length, entered: entered.length },
  };

  if (whole.length === 0) {
    return {
      ...measured,
      widened: 'the journal holds no whole observation of any test file',
      because: 'nothing recorded whole, so every test file runs',
    };
  }

  const reached = new Set(entered);
  const skip = whole.filter((test) => !reached.has(test));

  return {
    ...measured,
    skip,
    because:
      `skipping ${skip.length} of ${many(whole.length, 'test file')} recorded whole: none ` +
      'covered a changed line; every other test file runs',
  };
}

/**
 * The changed paths the journal records nothing about, argued at the top of
 * this file.
 *
 * Named rather than counted, because the one an operator acts on is a fixture a
 * test reads without importing it, and that is recognised by its name.
 */
function unreadNotes(unread: readonly string[]): readonly string[] {
  if (unread.length === 0) return [];
  return [
    `the journal records nothing about ${many(unread.length, 'changed file')} ` +
      `(${unread.slice(0, 3).join(', ')}${unread.length > 3 ? ', …' : ''}), so ` +
      `${unread.length === 1 ? 'it keeps' : 'they keep'} no test in the run; a file the suite ` +
      'reads without importing it is declared as a precondition',
  ];
}

/**
 * What the recording says about itself, which outlives whichever way the answer
 * went.
 *
 * `stale` has already widened the reading — every region of such a module was
 * charged — so it cannot make the skip list wrong. It is printed because it is
 * the one number here an operator can act on: it counts modules recorded from a
 * text nobody at that commit has, and it goes to zero by recording once over a
 * clean tree.
 */
function recordingNotes(
  stale: readonly string[],
  commit: string | undefined,
  given: boolean,
): readonly string[] {
  const notes: string[] = [];

  if (commit === undefined && !given) {
    notes.push(
      'the journal names no commit, so none of its line ranges could be checked against the ' +
        'text they were cut from; every changed module with a row was charged whole',
    );
  }

  if (stale.length > 0) {
    const [first] = stale;
    notes.push(
      `${many(stale.length, 'changed module')} ${stale.length === 1 ? 'was' : 'were'} recorded ` +
        `from a different text than the one at the journal's own commit (${first}), so every ` +
        `region of ${stale.length === 1 ? 'it' : 'them'} was charged rather than read; record ` +
        'once over a clean tree to clear this',
    );
  }

  return notes;
}

/**
 * The answer, for the runner. Nothing but skip data reaches stdout.
 *
 * An empty skip list prints nothing at all in the three shell formats, which is
 * the reading a shell already has: `vitest $(variance select --format vitest)`
 * with nothing substituted is `vitest`, the whole suite. Everything explaining
 * the answer goes to stderr instead, so a command substitution cannot pick up a
 * sentence and hand it to a runner as a path.
 *
 * `json` is the one format where the explanation belongs on stdout, because
 * there the consumer is a program that asked for the whole reading and the
 * field names keep the two apart.
 *
 * `root` is where the journal's paths are relative to, and the two shell
 * formats both need it for the same reason from opposite directions: a runner
 * matches an ignore pattern against a place on disk, and a journal speaks in
 * paths relative to the repository. Jest gets an anchored expression because it
 * is handed absolute paths to match; vitest gets the absolute path itself.
 */
export function formatSelection(
  selection: TestSelection,
  format: SelectFormat,
  root: string,
): string {
  if (format === 'json') return `${JSON.stringify(jsonOf(selection), null, 2)}\n`;
  if (selection.skip.length === 0) return '';

  const lines =
    format === 'plain'
      ? selection.skip
      : format === 'vitest'
        ? // Absolute, because a workspace is many projects and a project matches
          // an exclude pattern against its own directory rather than against the
          // root the journal counts from. A path the record holds is relative to
          // the workspace and relative to nothing any project holds, so a
          // relative pattern matches in none of them and the narrowed run is the
          // whole suite — silently, since an exclusion that matches nothing is
          // not an error anywhere.
          selection.skip.map((test) => `--exclude=${resolve(root, test)}`)
        : // `--testPathIgnorePatterns` replaces jest's default rather than adding
          // to it, so the default has to be handed back or a run that skips four
          // test files also walks `node_modules`.
          ['--testPathIgnorePatterns=/node_modules/', ...selection.skip.map(jestIgnore)];

  return `${lines.join('\n')}\n`;
}

/**
 * One skipped path as a regular expression jest will match and nothing else
 * will.
 *
 * Jest tests its ignore patterns against the *absolute* path of every test
 * file, so an anchor at the front is unavailable — the rootDir prefix is not
 * ours to write. `/` before the path and `$` after it is the next best: the
 * pattern then matches at a path boundary and at the end, so `src/a.test.ts`
 * cannot also ignore `src/ba.test.ts`. What survives is a path that repeats
 * under two roots of one monorepo, and the relative path we emit already
 * carries the package, so it takes a duplicated directory structure to collide.
 * Over-matching here skips a test, so it is worth the sentence.
 */
function jestIgnore(test: string): string {
  const escaped = test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boundary = escaped.startsWith('/') || escaped.startsWith('\\.') ? '' : '/';
  return `--testPathIgnorePatterns=${boundary}${escaped}$`;
}

/** Everything the reading knows, for a caller that is a program. */
function jsonOf(selection: TestSelection): object {
  return {
    skip: selection.skip,
    ...(selection.widened === undefined ? {} : { widened: selection.widened }),
    because: selection.because,
    notes: selection.notes,
    journal: {
      at: selection.at,
      ...(selection.commit === undefined ? {} : { commit: selection.commit }),
      ...(selection.recorded === undefined ? {} : { recorded: selection.recorded }),
    },
    unread: selection.unread,
    stale: selection.stale,
    ...(selection.readings === undefined ? {} : { readings: selection.readings }),
  };
}

/**
 * What an operator is told, on stderr, every time.
 *
 * Printed whichever way the answer went, and printed *first* when nothing was
 * skipped, because an empty stdout is the one outcome a person cannot read. A
 * runner's own output follows this on the same terminal, so it is a short block
 * rather than a report.
 */
export function selectionNotes(selection: TestSelection): string {
  // A widened answer is said once: `because` restates "every test file runs",
  // which `skipping nothing` already says. `json` keeps both fields.
  const lines =
    selection.widened === undefined
      ? [`${selection.because}.`]
      : [`skipping nothing: ${selection.widened}.`];

  for (const note of selection.notes) lines.push(`${note}.`);
  lines.push(...readingLines(selection.readings ?? []));

  return `${lines.join('\n')}\n`;
}
