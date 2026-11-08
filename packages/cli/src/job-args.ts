// compass: variance-authority.reach
import type { Flags } from './args.js';
import { OperatorError } from './exit.js';

export interface ParsedJob {
  readonly command: 'job';
  /** The suite the job is recorded under, one job to a suite. */
  readonly suite: string;
  /** The command to run, as it follows `--`. */
  readonly run: readonly string[];
  /** An exit besides 0 that still means the command ran whole. */
  readonly completeOn?: number;
}

/** `job --suite <name> [--complete-on <exit>] -- <command>...`. */
export function parseJobArgs(flags: Flags): ParsedJob {
  const suite = flags.values.get('--suite');
  if (suite === undefined) throw new OperatorError('`job` needs --suite: the suite this job is recorded under');
  if (flags.positionals.length === 0) throw new OperatorError('`job` needs a command to run, after `--`');
  const completeOn = flags.values.get('--complete-on');
  if (completeOn !== undefined && !/^\d{1,3}$/.test(completeOn)) throw new OperatorError('`--complete-on` needs an exit code, a number');
  return { command: 'job', suite, run: flags.positionals, ...(completeOn === undefined ? {} : { completeOn: Number(completeOn) }) };
}
