/**
 * Which named tests reached this line.
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
 * Depth is printed where a producer measured one, and sorts the list when it
 * did: a test that entered at depth 1 addressed the line, one at depth 9 passed
 * through it on the way somewhere else, and those are not the same claim on the
 * code even when they are the same length of list. This project's own Vitest
 * recorder is not that producer — ADR-0056 forecloses a recorded depth, so it
 * writes zero everywhere and the list comes back in identity order. The column
 * is still printed, because a reader comparing two indexes has to be able to
 * see which of them measured it.
 */

import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { parseExecutionIndex } from '@variance-authority/distill';
import {
  changedLines,
  coveringChange,
  coveringTests,
  coveringTestsInFile,
  recordedCommit,
  testCoverageFile,
  type CoveringChange,
  type CoveringTest,
  type LineRange,
  type ExecutionIndex,
  type SourceTestRange,
} from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { diffSince } from './since.js';
import type { ParsedCovering } from '../covering-args.js';

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
  const from = request.execution ?? `${testCoverageFile(request.root)}.cases.json`;

  let index: ExecutionIndex;
  try {
    index = parseExecutionIndex(JSON.parse(await readFile(from, 'utf8')));
  } catch (error) {
    throw new OperatorError(
      `no readable per-case execution index at \`${from}\` (${
        error instanceof Error ? error.message : String(error)
      }). One is written by a run configured with \`withTestSelection(config, { cases: true })\`; ` +
        'without it this project knows which files a test entered but not which case entered them.',
    );
  }

  if (request.since !== undefined) return await sinceAnswer(request.since, request.root, index, from);

  const file = request.file;
  const module = index.modules.find((candidate) => candidate.file === file);
  if (module === undefined) {
    throw new OperatorError(
      `\`${file}\` is not in the index at \`${from}\`, which holds ${
        index.modules.length
      } file${index.modules.length === 1 ? '' : 's'}. A file the run never loaded has no answer ` +
        `here, and that is a different statement from no test reaching it. ${
          spelling(file, index)
        }`,
    );
  }

  if (request.line !== undefined) {
    const line = request.line;
    if (!module.blocks.some((block) => block.source && block.startLine <= line && line <= block.endLine)) {
      throw new OperatorError(
        `line ${line} of \`${file}\` is outside every recorded region. A blank line, an ` +
          'import or a type declaration has no region to be entered, so there is no list to ' +
          'print — which again is not the same as nobody reaching it.',
      );
    }
    return {
      file: file,
      target: { line },
      tests: coveringTests(index, { file: file, line }),
      from,
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
    return {
      file: file,
      target: { function: named },
      tests: coveringTests(index, { file: file, function: named }),
      from,
    };
  }

  return { file: file, ranges: coveringTestsInFile(index, file), from };
}

/**
 * Every region a diff changed, and which named cases went there.
 *
 * The diff is measured from the commit the record was written at rather than
 * from the merge base with `ref`, because the index's line ranges are in that
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
async function sinceAnswer(
  since: string,
  root: string,
  index: ExecutionIndex,
  from: string,
): Promise<Covering> {
  const at = await recordedCommit(testCoverageFile(root));
  const diff = await diffSince(since, [], at);
  if (diff === undefined) {
    throw new OperatorError(
      `\`--since ${since}\` could not be read as a diff. Check the ref exists and that this is a ` +
        'git checkout; an empty answer here would read as `your change touches nothing`.',
    );
  }

  const here = process.cwd();
  const changed = new Map<string, readonly LineRange[]>();
  for (const [file, ranges] of changedLines(diff)) {
    changed.set(here === root ? file : relative(root, resolve(here, file)), ranges);
  }
  if (changed.size === 0) {
    throw new OperatorError(
      `nothing has changed since \`${since}\`, so there is no region to ask about.`,
    );
  }

  return {
    since,
    changed: coveringChange(index, changed),
    ...(at === undefined ? {} : { at }),
    from,
  };
}

/** Say the answer in the shape the caller asked for. */
export function formatCovering(answer: Covering, format: CoveringFormat): string {
  return format === 'json' ? `${JSON.stringify(answer, undefined, 2)}\n` : `${text(answer)}\n`;
}

function text(answer: Covering): string {
  if (answer.changed !== undefined) return sinceText(answer, answer.changed);
  if (answer.ranges !== undefined) return wholeFile(answer.file ?? '', answer.from, answer.ranges);

  const tests = answer.tests ?? [];
  const target = answer.target ?? { function: '' };
  const where = 'line' in target ? `line ${target.line}` : `function ${target.function}`;
  if (tests.length === 0) return `No named test reached ${where} of ${answer.file}.`;
  return [
    `${tests.length} named test${tests.length === 1 ? '' : 's'} reached ${where} of ${
      answer.file
    }, nearest first where the index carries a depth:`,
    ...tests.map((test) => `  ${describe(test)}`),
  ].join('\n');
}

function wholeFile(file: string, from: string, ranges: readonly SourceTestRange[]): string {
  if (ranges.length === 0) return `No line of ${file} is recorded in ${from}.`;
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
      ? ['  no named test reached this range']
      : range.tests.map((test) => `  ${describe(test)}`)));
  }
  return lines.join('\n');
}

/**
 * The review reading: the counts first, then the regions that produced them.
 *
 * The header is the part a reviewer acts on, so it leads. Two numbers matter
 * and neither is a percentage: regions the change touched that **no case
 * entered by a route it chose**, and regions one case alone entered. The first
 * is a hole in the evidence; the second is evidence resting on a single point,
 * which is the reading a line count cannot express at all.
 *
 * A case that was only inside a region while its module evaluated is counted
 * apart. It was present, it did not go there, and folding the two together
 * would make every module-scope constant look as watched as the function under
 * it.
 */
function sinceText(answer: Covering, changed: readonly CoveringChange[]): string {
  const regions = changed.flatMap((file) => file.regions);
  const blind = regions.filter((region) => region.tests.length === 0);
  const alone = regions.filter((region) => region.tests.length === 1);
  const silent = changed.filter((file) => !file.recorded && file.cases.length === 0);

  const lines = [
    `${changed.length} changed file${changed.length === 1 ? '' : 's'} since ${answer.since}, ` +
      `${regions.length} changed region${regions.length === 1 ? '' : 's'}: ${blind.length} ` +
      `nothing entered, ${alone.length} entered by one case.`,
    `Read from ${answer.from}${answer.at === undefined ? '' : `, recorded at ${answer.at}`}.`,
  ];

  for (const file of changed) {
    lines.push('', file.file);
    if (file.cases.length > 0) {
      lines.push(
        `  a test file — ${file.cases.length} named case${file.cases.length === 1 ? '' : 's'} ` +
          'declared here, which is what changed rather than what was reached:',
      );
      lines.push(...file.cases.map((test) => `    ${test.name} [${test.id}]`));
    }
    if (!file.recorded) {
      if (file.cases.length === 0) {
        lines.push('  no row — the recorded run never loaded this file, which is not the same as nobody reaching it');
      }
      continue;
    }
    if (file.regions.length === 0) {
      lines.push('  in the index, and the change landed on no recorded region of it');
      continue;
    }
    for (const region of file.regions) {
      const carried = region.passengers.length === 0
        ? ''
        : ` (+${region.passengers.length} carried in while the module evaluated)`;
      lines.push(
        `  ${region.startLine}-${region.endLine} ${region.kind}${
          region.name === '' ? '' : ` ${region.name}`
        } — ${
          region.tests.length === 0
            ? 'no case entered this region'
            : region.tests.length === 1
              ? '1 case, and it is the only witness'
              : `${region.tests.length} cases`
        }${carried}`,
      );
      lines.push(...region.tests.map((test) => `    ${describe(test)}`));
    }
  }

  if (silent.length > 0) {
    lines.push(
      '',
      `${silent.length} changed path${silent.length === 1 ? ' has' : 's have'} no row here at all. ` +
        'The reading above is about the rest of the diff.',
    );
  }
  return lines.join('\n');
}

function describe(test: CoveringTest): string {
  return `depth ${test.distance} — ${test.name} — ${test.file} [${test.id}]`;
}

/**
 * Point at the closest spelling rather than printing the whole index.
 *
 * A path given to this command is usually the right file and the wrong root:
 * the record spells a module the way the run saw it, and a reader who pasted an
 * editor path is one prefix away. Three candidates answer that; a list of every
 * recorded file answers nothing and scrolls the refusal off the screen.
 */
function spelling(file: string, index: ExecutionIndex): string {
  const tail = file.slice(file.lastIndexOf('/') + 1);
  const near = index.modules
    .map((module) => module.file)
    .filter((candidate) => candidate === tail || candidate.endsWith(`/${tail}`))
    .sort();
  return near.length === 0
    ? `Nothing recorded ends in \`${tail}\`.`
    : `The record spells it ${near.slice(0, 3).map((candidate) => `\`${candidate}\``).join(', ')}.`;
}
