import { resolve } from 'node:path';
import { distanceRange } from '@variance-authority/sense/test-selection';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';
import type { CoveringFormat } from './commands/covering.js';

/** Where the answer is read from and how it is written, whichever was asked. */
export interface CoveringSource {
  readonly command: 'covering';
  /** Where the per-case execution index is. Defaults to where a recorded run puts it. */
  readonly execution?: string;
  /** The project root the run recorded against; defaults to the working directory. */
  readonly root: string;
  readonly format: CoveringFormat;
  /**
   * `--cases last|<test file>`: answer from those cases alone rather than the
   * whole suite — the run that wrote the index last, or every case of one file.
   */
  readonly cases?: string;
}

/** A question about one piece of source. */
export interface CoveringAt extends CoveringSource {
  /** The source file the question is about, as the index spells it. */
  readonly file: string;
  /** `--line <n>`: one line of it. Alternative to `--function`. */
  readonly line?: number;
  /** `--function <name>`: one indexed function of it. Alternative to `--line`. */
  readonly function?: string;
  /**
   * `--at-distance <range>`: keep only witnesses within this many import hops.
   *
   * Hops from the file the question names to the test's own file, walked over
   * the import graph. A separate reading from the crossing that put the test in
   * the list, and a more expensive one, which is why it is a flag.
   */
  readonly atDistance?: { readonly from: number; readonly to: number };
  /** `--in-package`: keep only witnesses whose test file shares the subject's package. */
  readonly inPackage?: true;
  /**
   * `--hops`: measure import hops from the file to each test file whose cases
   * reached the line or function, and order the files nearest first. It reads
   * the file graph, which the plain question does not.
   */
  readonly hops?: true;
  /**
   * `--text <path>`: the text the file holds now, when it is not the file on
   * disk — `-` reads it from standard input, which is how an editor asks about
   * a buffer it has not saved. Line numbers are asked and answered in it.
   */
  readonly text?: string;
  readonly since?: undefined;
}

/** A question about everything a diff changed. */
export interface CoveringSince extends CoveringSource {
  /** `--since <ref>`: every region a diff against this ref changed. */
  readonly since: string;
  /** `--against <record>`: the base's case index, compared with this one region by region. */
  readonly against?: string;
  readonly file?: undefined;
}

export type ParsedCovering = CoveringAt | CoveringSince;

/**
 * Parse the question a person or an agent asks about one piece of source.
 *
 * One of `--file` and `--since` is required and neither coordinate is, which is
 * the one place this parser is looser than its neighbours. A file alone is a
 * real question — *what does the suite claim about this module* — and it is
 * answered as ranges rather than as a list, so there is no shape in which the
 * missing flag turns into a dump. A file is the question; a line narrows it.
 *
 * `--line` and `--function` are alternatives rather than a filter pair. Given
 * both, the honest answer would be the tests that reached the line *and* the
 * function, which is the line's answer with a longer command line — so the
 * second flag is refused rather than ignored.
 *
 * `--since <ref>` is the third alternative: a diff is
 * a wider target than a line, not a different question, so it takes the place of
 * `--file` rather than filtering it. Combined with any of the other three it is
 * refused — a diff already names its own files, and a `--file` beside it would
 * either agree and say nothing or disagree and silently answer about one of them.
 *
 * `--at-distance` and `--in-package` are not a fourth question but a narrowing
 * of the answer to the first three: the witnesses stay the witnesses, and what
 * changes is how many of them are printed. Both need one origin to measure
 * from, so both are refused beside `--since`.
 */
export function parseCoveringArgs(flags: Flags): ParsedCovering {
  noPositionals(flags.positionals, 'covering');

  const since = flags.values.get('--since');
  const file = flags.values.get('--file');
  if (since !== undefined) {
    for (const other of ['--file', '--line', '--function', '--text'] as const) {
      if (flags.values.get(other) === undefined) continue;
      throw new OperatorError(
        `\`--since\` and \`${other}\` are alternatives. A diff names the files it changed, so ` +
          'asking it about one more is either the same question or a different one answered quietly.',
      );
    }
    for (const other of ['--at-distance', '--in-package', '--hops'] as const) {
      if (!flags.present.has(other)) continue;
      throw new OperatorError(
        `\`--since\` and \`${other}\` do not compose. A diff is many origins, so a test has a ` +
          'distance to each changed file and no single one to the change; ask a file or a line, ' +
          'which is one origin and has one answer.',
      );
    }
    const against = flags.values.get('--against');
    if (against === '') throw new OperatorError('`--against` takes the case index the base recorded.');
    return { ...executionAnd(flags), since, ...(against === undefined ? {} : { against }) };
  }
  if (flags.values.get('--against') !== undefined) {
    throw new OperatorError(
      '`--against` compares two records of one change, so it takes `--since <ref>`; ' +
        '`--cases last` compares the last run with the one before it without it.',
    );
  }

  if (file === undefined || file === '') {
    throw new OperatorError(
      'covering needs `--file <path>` to ask about. Without one there is no question: the whole ' +
        'index is every test you have, which is the list you already had.',
    );
  }

  const raw = flags.values.get('--line');
  const functionName = flags.values.get('--function');
  if (raw !== undefined && functionName !== undefined) {
    throw new OperatorError(
      '`--line` and `--function` are alternatives; a line already sits inside a function, so ' +
        'giving both asks the narrower of the two questions twice.',
    );
  }

  let line: number | undefined;
  if (raw !== undefined) {
    line = Number(raw);
    if (!Number.isInteger(line) || line < 1) {
      throw new OperatorError(`--line must be a positive integer, not \`${raw}\``);
    }
  }

  const atDistance = parseAtDistance(flags);
  const text = flags.values.get('--text');
  if (flags.present.has('--hops') && line === undefined && functionName === undefined) {
    throw new OperatorError(
      '`--hops` measures how far each test file whose cases reached a line or function is from ' +
        'it, so it takes `--line` or `--function`; a whole file is answered as ranges, one list of ' +
        'test files per range.',
    );
  }

  return {
    ...executionAnd(flags),
    file,
    ...(line === undefined ? {} : { line }),
    ...(functionName === undefined ? {} : { function: functionName }),
    ...(atDistance === undefined ? {} : { atDistance }),
    ...(flags.present.has('--in-package') ? { inPackage: true as const } : {}),
    ...(flags.present.has('--hops') ? { hops: true as const } : {}),
    ...(text === undefined ? {} : { text }),
  };
}

/**
 * Read `--at-distance`, or say what it should have been.
 *
 * The same spelling `atDistance` ranges over — `0-3`, `2`, `3-` — because the
 * flag is named after the quantity and the quantity is hop counts. A typo is
 * refused rather than read as one distance: `0-e` narrowing silently to zero
 * hops would answer *nothing is near* about a line six tests reach.
 */
function parseAtDistance(
  flags: Flags,
): { readonly from: number; readonly to: number } | undefined {
  const raw = flags.values.get('--at-distance');
  if (raw === undefined) return undefined;
  const range = distanceRange(raw);
  if (range === undefined) {
    throw new OperatorError(
      `--at-distance takes hop counts — \`0-3\`, \`2\`, or \`3-\` for three and beyond — not ` +
        `\`${raw}\`.`,
    );
  }
  return range;
}

/** Where to read the index, where the run was rooted, and how to write the answer. */
function executionAnd(flags: Flags): CoveringSource {
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'refs' && format !== 'json') {
    throw new OperatorError(`--format must be text, refs or json, not \`${format}\``);
  }
  const execution = flags.values.get('--execution');
  const cases = flags.values.get('--cases');
  if (cases === '') throw new OperatorError('`--cases` takes `last` or a test file.');
  return {
    command: 'covering',
    ...(execution === undefined ? {} : { execution: resolve(execution) }),
    ...(cases === undefined ? {} : { cases }),
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    format: format as CoveringFormat,
  };
}

