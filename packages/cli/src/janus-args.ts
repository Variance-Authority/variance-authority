// compass: variance-authority.reach
import type { Flags } from './args.js';
import { OperatorError } from './exit.js';

export interface ParsedJanus {
  readonly command: 'janus';
  /** The ref whose text the files are rolled back to: the merge base with it. */
  readonly since: string;
  /** The files to roll back, as given: each one the checkout and the base both hold. */
  readonly files: readonly [string, ...string[]];
  /** The command to run, as it follows `--`. */
  readonly run: readonly [string, ...string[]];
}

/** `janus --since <ref> --file <path>... -- <command>...`. */
export function parseJanusArgs(flags: Flags): ParsedJanus {
  const since = flags.values.get('--since');
  if (since === undefined) throw new OperatorError('`janus` needs --since: the ref to roll the files back to');
  const [file, ...more] = flags.repeated.get('--file') ?? [];
  if (file === undefined) throw new OperatorError('`janus` needs --file: a file to roll back, once per file');
  const [program, ...args] = flags.positionals;
  if (program === undefined) throw new OperatorError('`janus` needs a command to run, after `--`');
  return { command: 'janus', since, files: [file, ...more], run: [program, ...args] };
}
