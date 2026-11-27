// compass: variance-authority.reach
import type { Flags } from './args.js';

export interface ParsedPython {
  readonly command: 'python';
  /** The suite the tests are recorded under; absent, the only one declared. */
  readonly suite?: string;
  /** What follows `--`, handed to `pytest`: the paths, markers and options to run. */
  readonly args: readonly string[];
}

/** `python [--suite <name>] [-- <pytest argument>...]`. */
export function parsePythonArgs(flags: Flags): ParsedPython {
  const suite = flags.values.get('--suite');
  return { command: 'python', ...(suite === undefined ? {} : { suite }), args: flags.positionals };
}
