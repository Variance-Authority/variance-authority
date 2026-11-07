// compass: variance-authority.reach
import type { Flags } from './args.js';
import { OperatorError } from './exit.js';

export interface ParsedJob {
  readonly command: 'job';
  /** The suite the job is recorded under, one job to a suite. */
  readonly suite: string;
  /** The command to run, as it follows `--`. */
  readonly run: readonly string[];
}

/** `job --suite <name> -- <command>...`. */
export function parseJobArgs(flags: Flags): ParsedJob {
  const suite = flags.values.get('--suite');
  if (suite === undefined) throw new OperatorError('`job` needs --suite: the suite this job is recorded under');
  if (flags.positionals.length === 0) throw new OperatorError('`job` needs a command to run, after `--`');
  return { command: 'job', suite, run: flags.positionals };
}
