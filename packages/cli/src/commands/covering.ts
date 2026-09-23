/**
 * Which named tests covered this line.
 *
 * The inverse of [`reach`](./reach-command.ts). That one walks the import graph
 * forward from a diff and answers *what could this change touch*; this one
 * reads a recorded run backwards from one piece of source and answers *what
 * already went there*. One is structure and needs no history; this one is
 * evidence and exists only where a suite has been recorded with `cases: true`.
 *
 * The reading is three library calls, and it was three library calls for a
 * while: whoever wanted it wrote a script around `coveringTests`. That is a
 * fine shape for a program and the wrong one for the two readers who ask this
 * question most — a person deciding whether a test still earns its place, and
 * an agent holding a line number it is about to change. Neither wants to author
 * a file to ask one question, and an agent that has to will ask a worse
 * question instead.
 *
 * Execution says where a test went, never why the trip was worth taking. So
 * this prints named tests and stops: nothing here says a test is redundant, and
 * a list of six is the beginning of the question *why do all of these need this
 * code*, not the answer to it.
 *
 * No depth is printed. `ExecutionCrossing.distance` is call-stack depth, which
 * ADR-0056 forecloses recording, so this project's collector writes zero into
 * it everywhere — a column of zeroes beside every witness advertised a reading
 * nothing here has ever produced. What a reader wanted from it is *how far
 * away is this test*, and that is import hops rather than stack frames:
 * `--at-distance 0-3` narrows the list to tests within three imports of the
 * file, and `--in-package` to tests that share its package. Both are measured
 * on demand, off the file graph, in [`covering-reach.ts`](./covering-reach.ts).
 */

import { realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  changedLines,
  coveringChange,
  coveringTests,
  coveringTestsInFile,
  formatCoveringChange,
  ranWhileLoading,
  recordedCommit,
  testCoverageFile,
  type CoveringChange,
  type CoveringTest,
  type LineRange,
  type ExecutionIndex,
  type SourceTestRange,
} from '@variance-authority/sense/test-selection';
import type { Relations } from '@variance-authority/core/relate';
import { OperatorError } from '../exit.js';
import { defaultExecutionFile, readExecutionFor } from './execution-input.js';
import { nearbyWitnesses, type Narrowing } from './covering-reach.js';
import { diffSince } from './since.js';
import { relationsFor } from './source-graph.js';
import type { CoveringAt, ParsedCovering } from '../covering-args.js';

/** How the answer is written. `text` reads; `json` is for whatever asks next. */
export type CoveringFormat = 'text' | 'json';

/** What was asked, and what the record said about it. */
export interface Covering {
  /** The file the question named, absent when it named a diff. */
  readonly file?: string;
  /** The ref a diff was taken against, present only under `--since`. */
  readonly since?: string;
  /** Present when the question named a diff: one entry per changed file. */
  readonly changed?: readonly CoveringChange[];
  /** The line or function the question named, absent when it named neither. */
  readonly target?: { readonly line: number } | { readonly function: string };
  /** Present when the question named a line or a function. */
  readonly tests?: readonly CoveringTest[];
  /** Present when the question named a file and nothing narrower. */
  readonly ranges?: readonly SourceTestRange[];
  /** Where the index was read, so an empty answer can be checked against a path. */
  readonly from: string;
  /** The commit the record stands at, when it says. The diff is measured from it. */
  readonly at?: string;
  /**
   * What a narrowing did, when one was asked for.
   *
   * Present only under `--at-distance` or `--in-package`, and printed whichever
   * way the answer went: a short list and an empty one both read as *few tests
   * go here* unless the reader is told that most of them were filtered out.
   */
  readonly narrowed?: {
    readonly kept: number;
    readonly of: number;
    readonly notes: readonly string[];
  };
}

/**
 * Read the per-case execution index and ask it about one piece of source.
 *
 * The default path is where a recorded run writes the index, so the common
 * question needs no flag but `--file`. A missing file is refused rather than
 * answered empty: an empty list here reads as *no test covers this line*, which
 * is the sentence that gets a test deleted.
 */
export async function covering(request: ParsedCovering): Promise<Covering> {
  const from = request.execution ?? (await defaultExecutionFile(request.root));

  if (request.since !== undefined) {
    // The snapshot's commit is the coordinate of what was recorded beside it,
    // and of nothing else: a journey file handed in by path names no commit, and
    // diffing it from the snapshot's would land its hunks on another text.
    const at = from.startsWith(testCoverageFile(request.root))
      ? await recordedCommit(testCoverageFile(request.root))
      : undefined;
    const changed = await changeSince(request.since, request.root, at);
    const { index } = await readIndex(from, changed);
    return {
      since: request.since,
      // The graph carries the mocks: a case whose file mocked the changed module
      // is not listed under it, whatever it crossed there.
      changed: coveringChange(index, changed, { relations: await fileGraph(request.root) }),
      ...(at === undefined ? {} : { at }),
      from,
    };
  }

  const file = request.file;
  const { index, files } = await readIndex(from, new Map([[file, []]]));
  const module = index.modules.find((candidate) => candidate.file === file);
  if (module === undefined) {
    throw new OperatorError(
      `\`${file}\` is not in the index at \`${from}\`, which holds ${
        files.length
      } file${files.length === 1 ? '' : 's'}. A file the run never loaded has no answer ` +
        `here, and that is a different statement from no test covering it. ${
          spelling(file, files)
        }`,
    );
  }

  const near = await nearbyWitnesses(request as CoveringAt);

  if (request.line !== undefined) {
    const line = request.line;
    if (!module.blocks.some((block) => block.source && block.startLine <= line && line <= block.endLine)) {
      throw new OperatorError(
        `line ${line} of \`${file}\` is outside every recorded region. A blank line, an ` +
          'import or a type declaration has no region to be covered, so there is no list to ' +
          'print — which again is not the same as nobody covering it.',
      );
    }
    const target = { file, line };
    const found = coveringTests(index, target, await loadersFor(index, target, request.root));
    const kept = near.whole ? found : found.filter(near.keep);
    return {
      file: file,
      target: { line },
      tests: kept,
      from,
      ...countOf(near, kept.length, found.length),
    };
  }

  if (request.function !== undefined) {
    const named = request.function;
    if (!module.blocks.some((block) =>
      block.source && block.kind === 'function' && block.name === named,
    )) {
      const functions = module.blocks
        .filter((block) => block.source && block.kind === 'function')
        .map((block) => block.name);
      throw new OperatorError(
        `\`${named}\` is not a recorded function of \`${file}\`. ` +
          (functions.length === 0
            ? 'That file has no recorded functions at all.'
            : `It has ${functions.join(', ')}.`),
      );
    }
    const target = { file, function: named };
    const found = coveringTests(index, target, await loadersFor(index, target, request.root));
    const kept = near.whole ? found : found.filter(near.keep);
    return {
      file: file,
      target: { function: named },
      tests: kept,
      from,
      ...countOf(near, kept.length, found.length),
    };
  }

  const found = coveringTestsInFile(
    index,
    file,
    module.blocks.some((block) => block.loaded === true) ? { relations: await fileGraph(request.root) } : {},
  );
  if (near.whole) return { file: file, ranges: found, from };
  const narrowed = refold(found.map((range) => ({ ...range, tests: range.tests.filter(near.keep) })));
  return {
    file: file,
    ranges: narrowed,
    from,
    ...countOf(near, identities(narrowed), identities(found)),
  };
}

/**
 * Re-fold ranges a filter has just changed the answer of.
 *
 * `coveringTestsInFile` folds adjacent lines whose witness lists are identical,
 * so a range boundary is a place where the claim on the code changes. Filtering
 * the lists afterwards can make two neighbours agree that did not, and leaving
 * them apart would print a boundary where nothing happens — the one thing the
 * folding rule exists to prevent.
 */
function refold(ranges: readonly SourceTestRange[]): readonly SourceTestRange[] {
  const folded: SourceTestRange[] = [];
  for (const range of ranges) {
    const previous = folded.at(-1);
    if (
      previous !== undefined &&
      previous.endLine + 1 === range.startLine &&
      previous.tests.length === range.tests.length &&
      previous.tests.every((test, at) => test.id === range.tests[at]?.id)
    ) {
      folded[folded.length - 1] = { ...previous, endLine: range.endLine };
      continue;
    }
    folded.push(range);
  }
  return folded;
}

/** How many distinct named tests a set of ranges names. */
function identities(ranges: readonly SourceTestRange[]): number {
  return new Set(ranges.flatMap((range) => range.tests.map((test) => test.id))).size;
}

/** The narrowing's own report, when there was a narrowing. */
function countOf(
  near: Narrowing,
  kept: number,
  of: number,
): Pick<Covering, 'narrowed'> {
  return near.whole ? {} : { narrowed: { kept, of, notes: near.notes } };
}

/**
 * Every line a diff changed, in the index's coordinates.
 *
 * The diff is measured from the commit the record was written at, when it has
 * one, rather than from the merge base with `ref`, because the index's line ranges are in that
 * commit's coordinates and nothing else's. The two part company as soon as the
 * branch moves under the recording, and a hunk read at the wrong end lands on
 * lines the index numbered for a different region — which is the one failure
 * here nobody can see, since a wrong list of test names reads exactly like a
 * right one.
 *
 * `git` names files from the repository root and the index names them from the
 * run's, so the paths are brought into the index's coordinates before anything
 * is looked up. Unmatched paths are reported rather than dropped: a review that
 * silently left out half a diff is worse than one that says it cannot speak to
 * it.
 */
async function changeSince(
  since: string,
  root: string,
  at: string | undefined,
): Promise<ReadonlyMap<string, readonly LineRange[]>> {
  const diff = await diffSince(since, [], at);
  if (diff === undefined) {
    throw new OperatorError(
      `\`--since ${since}\` could not be read as a diff. Check the ref exists and that this is a ` +
        'git checkout; an empty answer here would read as `your change touches nothing`.',
    );
  }

  // The working directory is always a real path and `--root` is spelled however
  // the caller spelled it; through a symlink (`/var` on macOS) the two never meet.
  const here = process.cwd();
  const base = await realpath(root);
  const changed = new Map<string, readonly LineRange[]>();
  for (const [file, ranges] of changedLines(diff)) {
    changed.set(here === base ? file : relative(base, resolve(here, file)), ranges);
  }
  if (changed.size === 0) {
    throw new OperatorError(
      `nothing has changed since \`${since}\`, so there is no region to ask about.`,
    );
  }
  return changed;
}

/**
 * The index, read for the files a question is about.
 *
 * A missing file is refused rather than answered empty: an empty list here
 * reads as *no test covers this line*, which is the sentence that gets a test
 * deleted.
 */
async function readIndex(
  from: string,
  changed: ReadonlyMap<string, readonly LineRange[]>,
): Promise<{ readonly index: ExecutionIndex; readonly files: readonly string[] }> {
  try {
    return await readExecutionFor(from, changed);
  } catch (error) {
    throw new OperatorError(
      `no readable per-case execution index at \`${from}\` (${
        error instanceof Error ? error.message : String(error)
      }). One is written by a run configured with \`withTestSelection(config, { cases: true })\`; ` +
        'without it this project knows which files a test covered but not which case covered them.',
    );
  }
}

/**
 * The file graph, read only when a region the question landed on ran while its
 * module evaluated.
 *
 * The record credits no case with that: a module evaluates once per realm, for
 * whichever case imported it first. The graph names every case whose file
 * imports the module, and rules out one that mocked it. A question about a
 * region only a case called into never pays for the scan.
 */
async function loadersFor(
  index: ExecutionIndex,
  target: Parameters<typeof ranWhileLoading>[1],
  root: string,
): Promise<{ readonly relations?: Relations }> {
  return ranWhileLoading(index, target) ? { relations: await fileGraph(root) } : {};
}

function fileGraph(root: string): Promise<Relations> {
  return relationsFor(root, ['.'], [], [], {
    why: 'a region that ran while its module evaluated is answered, and a mocked module ruled out, by the file graph',
    fix: 'Install `@variance-authority/sense`, which is what reads the tree.',
  });
}

/** Say the answer in the shape the caller asked for. */
export function formatCovering(answer: Covering, format: CoveringFormat): string {
  return format === 'json' ? `${JSON.stringify(answer, undefined, 2)}\n` : `${text(answer)}\n`;
}

function text(answer: Covering): string {
  if (answer.changed !== undefined) return sinceText(answer, answer.changed);
  if (answer.ranges !== undefined) return wholeFile(answer, answer.ranges);

  const tests = answer.tests ?? [];
  const target = answer.target ?? { function: '' };
  const where = 'line' in target ? `line ${target.line}` : `function ${target.function}`;
  if (tests.length === 0) {
    return [`No named test covered ${where} of ${answer.file}.`, ...narrowedText(answer)].join('\n');
  }
  return [
    `${tests.length} named test${tests.length === 1 ? '' : 's'} covered ${where} of ${answer.file}:`,
    ...tests.map((test) => `  ${describe(test)}`),
    ...narrowedText(answer),
  ].join('\n');
}

function wholeFile(answer: Covering, ranges: readonly SourceTestRange[]): string {
  const file = answer.file ?? '';
  if (ranges.length === 0) return `No line of ${file} is recorded in ${answer.from}.`;
  const named = new Set(ranges.flatMap((range) => range.tests.map((test) => test.id)));
  const lines = [
    `${file} — ${ranges.length} recorded range${ranges.length === 1 ? '' : 's'}, ${
      named.size
    } named test${named.size === 1 ? '' : 's'}`,
  ];
  for (const range of ranges) {
    lines.push(range.startLine === range.endLine
      ? `line ${range.startLine}`
      : `lines ${range.startLine}-${range.endLine}`);
    lines.push(...(range.tests.length === 0
      ? ['  no named test covered this range']
      : range.tests.map((test) => `  ${describe(test)}`)));
  }
  lines.push(...narrowedText(answer));
  return lines.join('\n');
}

/**
 * What the narrowing removed, said out loud under every answer it shaped.
 *
 * A filtered list is indistinguishable from a short one, and the two lead to
 * opposite decisions: *one test covers this line* is an argument for writing
 * another, and *one test covers it within three hops, of eleven that cover it*
 * is an argument about where the eleven live. So the counts are printed even
 * when nothing was removed — a band that filtered nothing is a fact about the
 * code, not an absent feature.
 *
 * The sentence says how many survived and stops there. *The rest are further
 * out* would be a second claim, and a false one whenever the rest are tests the
 * walk could not place at all — which on a recording made against built output
 * is most of them. Why each one left is the notes' job, and the notes say it.
 */
function narrowedText(answer: Covering): readonly string[] {
  const narrowed = answer.narrowed;
  if (narrowed === undefined) return [];
  return [
    `${narrowed.kept} of ${narrowed.of} named test${narrowed.of === 1 ? '' : 's'} that covered ` +
      'it are inside the narrowing.',
    ...narrowed.notes.map((note) => `  ${note}`),
  ];
}

/**
 * The review reading, which `variance_changed_tests` also prints.
 *
 * The words live in `@variance-authority/sense/test-selection` beside
 * `coveringChange`, because two surfaces ask for them and a reading with two
 * renderers has two answers. All this adds is the provenance the CLI is the
 * only one able to state: the ref the diff was taken against, the file the
 * index was read from, and the commit it stands at.
 */
function sinceText(answer: Covering, changed: readonly CoveringChange[]): string {
  return formatCoveringChange(changed, {
    ...(answer.since === undefined ? {} : { since: answer.since }),
    from: answer.from,
    ...(answer.at === undefined ? {} : { at: answer.at }),
  });
}

function describe(test: CoveringTest): string {
  return `${test.name} — ${test.file} [${test.id}]${test.loaded === true ? ' (its file imports the module; ran while it evaluated)' : ''}`;
}

/**
 * Point at the closest spelling rather than printing the whole index.
 *
 * A path given to this command is usually the right file and the wrong root:
 * the record spells a module the way the run saw it, and a reader who pasted an
 * editor path is one prefix away. Three candidates answer that; a list of every
 * recorded file answers nothing and scrolls the refusal off the screen.
 */
function spelling(file: string, files: readonly string[]): string {
  const tail = file.slice(file.lastIndexOf('/') + 1);
  const near = files
    .filter((candidate) => candidate === tail || candidate.endsWith(`/${tail}`))
    .sort();
  return near.length === 0
    ? `Nothing recorded ends in \`${tail}\`.`
    : `The record spells it ${near.slice(0, 3).map((candidate) => `\`${candidate}\``).join(', ')}.`;
}
