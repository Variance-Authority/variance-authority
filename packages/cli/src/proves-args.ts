// compass: variance-authority.reach
import type { Flags } from './args.js';
import { OperatorError } from './exit.js';

export interface ParsedProves {
  readonly command: 'proves';
  /** The test file that declares the asked test. */
  readonly file: string;
  /** The asked test's name, or a word of it; optional when the file declares one recorded test. */
  readonly name?: string;
  /** How many regions to break, when given. */
  readonly limit?: number;
  /** The command that runs the asked test, as it follows `--`. */
  readonly run: readonly [string, ...string[]];
}

/** `proves --file <path> [--name <name>] [--limit <n>] -- <command>...`. */
export function parseProvesArgs(flags: Flags): ParsedProves {
  const file = flags.values.get('--file');
  if (file === undefined) throw new OperatorError('`proves` needs --file: the test file that declares the test');
  const name = flags.values.get('--name');
  const limitText = flags.values.get('--limit');
  const limit = limitText === undefined ? undefined : Number(limitText);
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new OperatorError('`proves --limit` takes a whole number of regions, 1 or more');
  const [program, ...args] = flags.positionals;
  if (program === undefined) throw new OperatorError('`proves` needs a command that runs the test, after `--`');
  return { command: 'proves', file, ...(name === undefined ? {} : { name }), ...(limit === undefined ? {} : { limit }), run: [program, ...args] };
}
