// compass: variance-authority.reach
import type { Flags } from './args.js';
import { OperatorError } from './exit.js';

export interface ParsedProves {
  readonly command: 'proves';
  /** The test file that declares the asked test. */
  readonly file: string;
  /** The asked test's name, or a word of it; optional when the file declares one recorded test. */
  readonly name?: string;
  /** The command that runs the asked test, as it follows `--`. */
  readonly run: readonly [string, ...string[]];
}

/** `proves --file <path> [--name <name>] -- <command>...`. */
export function parseProvesArgs(flags: Flags): ParsedProves {
  const file = flags.values.get('--file');
  if (file === undefined) throw new OperatorError('`proves` needs --file: the test file that declares the test');
  const name = flags.values.get('--name');
  const [program, ...args] = flags.positionals;
  if (program === undefined) throw new OperatorError('`proves` needs a command that runs the test, after `--`');
  return { command: 'proves', file, ...(name === undefined ? {} : { name }), run: [program, ...args] };
}
