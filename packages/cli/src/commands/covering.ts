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
 * this prints named tests and the call-stack depth each stood at, and stops:
 * nothing here says a test is redundant, and a list of six is the beginning of
 * the question *why do all of these need this code*, not the answer to it.
 * Depth orders the list because it is the one thing the record knows about
 * nearness — a test that entered at depth 1 addressed the line, one at depth 9
 * passed through it on the way somewhere else, and those are not the same claim
 * on the code even when they are the same length of list.
 */

import { readFile } from 'node:fs/promises';
import { parseExecutionIndex } from '@variance-authority/distill';
import {
  coveringTests,
  coveringTestsInFile,
  testCoverageFile,
  type CoveringTest,
  type ExecutionIndex,
  type SourceTestRange,
} from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import type { ParsedCovering } from '../covering-args.js';

/** How the answer is written. `text` reads; `json` is for whatever asks next. */
export type CoveringFormat = 'text' | 'json';

/** What was asked, and what the record said about it. */
export interface Covering {
  readonly file: string;
  /** The line or function the question named, absent when it named neither. */
  readonly target?: { readonly line: number } | { readonly function: string };
  /** Present when the question named a line or a function. */
  readonly tests?: readonly CoveringTest[];
  /** Present when the question named a file and nothing narrower. */
  readonly ranges?: readonly SourceTestRange[];
  /** Where the index was read, so an empty answer can be checked against a path. */
  readonly from: string;
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

  const module = index.modules.find((candidate) => candidate.file === request.file);
  if (module === undefined) {
    throw new OperatorError(
      `\`${request.file}\` is not in the index at \`${from}\`, which holds ${
        index.modules.length
      } file${index.modules.length === 1 ? '' : 's'}. A file the run never loaded has no answer ` +
        `here, and that is a different statement from no test reaching it. ${
          spelling(request.file, index)
        }`,
    );
  }

  if (request.line !== undefined) {
    const line = request.line;
    if (!module.blocks.some((block) => block.source && block.startLine <= line && line <= block.endLine)) {
      throw new OperatorError(
        `line ${line} of \`${request.file}\` is outside every recorded region. A blank line, an ` +
          'import or a type declaration has no region to be entered, so there is no list to ' +
          'print — which again is not the same as nobody reaching it.',
      );
    }
    return {
      file: request.file,
      target: { line },
      tests: coveringTests(index, { file: request.file, line }),
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
        `\`${named}\` is not a recorded function of \`${request.file}\`. ` +
          (functions.length === 0
            ? 'That file has no recorded functions at all.'
            : `It has ${functions.join(', ')}.`),
      );
    }
    return {
      file: request.file,
      target: { function: named },
      tests: coveringTests(index, { file: request.file, function: named }),
      from,
    };
  }

  return { file: request.file, ranges: coveringTestsInFile(index, request.file), from };
}

/** Say the answer in the shape the caller asked for. */
export function formatCovering(answer: Covering, format: CoveringFormat): string {
  return format === 'json' ? `${JSON.stringify(answer, undefined, 2)}\n` : `${text(answer)}\n`;
}

function text(answer: Covering): string {
  if (answer.ranges !== undefined) return wholeFile(answer.file, answer.from, answer.ranges);

  const tests = answer.tests ?? [];
  const target = answer.target ?? { function: '' };
  const where = 'line' in target ? `line ${target.line}` : `function ${target.function}`;
  if (tests.length === 0) return `No named test reached ${where} of ${answer.file}.`;
  return [
    `${tests.length} named test${tests.length === 1 ? '' : 's'} reached ${where} of ${
      answer.file
    }, nearest first:`,
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
