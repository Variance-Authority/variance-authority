/**
 * The half of `variance select` with a disk, a subprocess and a snapshot in it.
 *
 * The decision is next door in [`select.ts`](./select.ts), a pure function over
 * a reading. This is what has to happen before it can be asked: find the
 * journal, learn the commit its line ranges are coordinates in, walk git for the
 * diff, and read the snapshot. The split is the one every narrowing in this
 * package uses, and it matters most here — the rules this command ships are the
 * ones that decide whether somebody else's suite runs, and they have to be
 * assertable with no cache, no repository and no tests.
 *
 * ## No configuration is read, deliberately
 *
 * Every other command that touches a store or a baseline loads
 * `variance.config.json` first, and `loadConfig` refuses when it is not there —
 * correctly, because a run that guessed its subjects would be observing
 * something nobody chose. This command has no subjects. It is asked by a
 * repository whose tests are run by `vitest` or `jest` and which may never have
 * configured this tool for anything else, and requiring a config file would put
 * it out of reach in exactly those repositories.
 *
 * The cost is real and is named here rather than left to be discovered: without
 * a config there is no file graph, so `relations` is not passed, and a changed
 * stylesheet or asset no probe can sit in is answered by nobody. It lands in
 * `unread` instead — which, under the rule in `select.ts`, widens the answer to
 * the whole suite. Wider than `variance run --since` would be on the same diff,
 * never narrower.
 */

import { stat } from 'node:fs/promises';
import { OperatorError } from '../exit.js';
import { isMissing, journeyAgainst } from './resources.js';
import { diffSince } from './since.js';
import {
  formatSelection,
  selectionNotes,
  skippableTests,
  type SelectFormat,
  type SelectGround,
} from './select.js';

/** What `variance select` was asked for, once the flags are off the command line. */
export interface SelectRequest {
  readonly cwd: string;
  /** `--since <ref>`: where to measure from when the journal names no commit of its own. */
  readonly since?: string;
  readonly format: SelectFormat;
}

/**
 * The two streams, kept apart by the caller that writes them.
 *
 * Returned as a pair rather than written here, so the whole command is one
 * value a test can read — and so that nothing in the reading can reach stdout
 * by accident, which is the property the skip list rests on.
 */
export interface SelectOutput {
  /** Skip data, and nothing else. */
  readonly out: string;
  /** Everything a person needs and no runner may parse. */
  readonly err: string;
}

/** Read the journal against what has changed, and say what may be skipped. */
export async function selectOutput(request: SelectRequest): Promise<SelectOutput> {
  const selection = await import('@variance-authority/sense/test-selection');
  const at = selection.testCoverageFile(request.cwd);

  // Asked of the file before anything is decoded, because *no recording here*
  // is the ordinary state of a repository and must not arrive as a failure to
  // produce a diff — which is what an operator would see if the commit were
  // looked for first and the answer were "pass --since".
  if (!(await exists(at))) {
    return said({ at, ground: { kind: 'no-journal' } }, request.format);
  }

  // The position, and nothing else decoded to reach it. A snapshot of this
  // repository holds hundreds of thousands of regions and this asks it for
  // forty characters. A file that cannot be read at all answers `undefined`
  // here and throws by name a moment later, where the message belongs.
  const commit = await selection.recordedCommit(at);
  const from = commit ?? request.since;
  if (from === undefined) {
    // `recordedCommit` answers `undefined` for two different files: one that
    // names no commit, and one this build cannot read at all. Those are an
    // operator's two different afternoons, and the reader is what tells them
    // apart — asked here for the empty diff, so an unreadable snapshot is
    // refused by name instead of being reported as a missing coordinate.
    await journeyAgainst(request.cwd, '');
    throw new OperatorError(
      `the execution journal at ${at} names no commit, so there is no coordinate to measure a ` +
        'diff from. Pass `--since <ref>` to name one, or record the suite again from a git ' +
        'checkout so the journal carries its own; a selection measured from a guess would skip ' +
        'test files for lines nobody changed.',
    );
  }

  // The journal's own commit wins whenever it has one, `--since` or not: its
  // line ranges are coordinates in that commit's text and nothing else's, and a
  // diff read from anywhere further back lands its hunks on regions belonging
  // to other tests. `--since` names the base only when the journal cannot.
  const diff = await diffSince(request.since ?? from, [], commit);
  if (diff === undefined) {
    const ground: SelectGround = { kind: 'no-diff', from };
    return said({ at, ...(commit === undefined ? {} : { commit }), ground }, request.format);
  }

  const narrowing = await journeyAgainst(request.cwd, diff);
  const ground: SelectGround =
    narrowing === undefined ? { kind: 'no-journal' } : { kind: 'read', narrowing };

  return said({ at, ...(commit === undefined ? {} : { commit }), ground }, request.format);
}

function said(
  input: { readonly at: string; readonly commit?: string; readonly ground: SelectGround },
  format: SelectFormat,
): SelectOutput {
  const selection = skippableTests(input);
  return { out: formatSelection(selection, format), err: selectionNotes(selection) };
}

/**
 * Whether the journal is on disk, distinguishing *missing* from *unreadable*.
 *
 * Anything other than ENOENT is handed on: a directory in its place, a
 * permission the operator lost, a mount that went away. Reporting those as "no
 * recording here" would be the one failure this whole subsystem is written to
 * refuse — a run that ignored a snapshot looking exactly like a run that never
 * had one.
 */
async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw new OperatorError(
      `the recorded execution journal at ${file} could not be reached: ` +
        `${error instanceof Error ? error.message : String(error)}. A selection that treated ` +
        'this as "nothing recorded" would skip nothing and look exactly like a clean answer.',
      { cause: error },
    );
  }
}
