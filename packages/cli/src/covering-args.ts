import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';
import type { CoveringFormat } from './commands/covering.js';

export interface ParsedCovering {
  readonly command: 'covering';
  /** The source file the question is about, as the index spells it. */
  readonly file: string;
  /** `--line <n>`: one line of it. Alternative to `--function`. */
  readonly line?: number;
  /** `--function <name>`: one indexed function of it. Alternative to `--line`. */
  readonly function?: string;
  /** Where the per-case execution index is. Defaults to where a recorded run puts it. */
  readonly execution?: string;
  /** The project root the run recorded against; defaults to the working directory. */
  readonly root: string;
  readonly format: CoveringFormat;
}

/**
 * Parse the question a person or an agent asks about one piece of source.
 *
 * `--file` is required and neither coordinate is, which is the one place this
 * parser is looser than its neighbours. A file alone is a real question — *what
 * does the suite claim about this module* — and it is answered as ranges rather
 * than as a list, so there is no shape in which the missing flag turns into a
 * dump. A file is the question; a line narrows it.
 *
 * `--line` and `--function` are alternatives rather than a filter pair. Given
 * both, the honest answer would be the tests that reached the line *and* the
 * function, which is the line's answer with a longer command line — so the
 * second flag is refused rather than ignored.
 */
export function parseCoveringArgs(flags: Flags): ParsedCovering {
  noPositionals(flags.positionals, 'covering');

  const file = flags.values.get('--file');
  if (file === undefined || file === '') {
    throw new OperatorError(
      'covering needs `--file <path>` to ask about. Without one there is no question: the whole ' +
        'index is every test you have, which is the list you already had.',
    );
  }

  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new OperatorError(`--format must be text or json, not \`${format}\``);
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

  const execution = flags.values.get('--execution');
  return {
    command: 'covering',
    file,
    ...(line === undefined ? {} : { line }),
    ...(functionName === undefined ? {} : { function: functionName }),
    ...(execution === undefined ? {} : { execution: resolve(execution) }),
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    format,
  };
}
