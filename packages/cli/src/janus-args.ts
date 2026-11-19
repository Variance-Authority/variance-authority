// compass: variance-authority.reach
import type { Flags } from './args.js';
import { OperatorError } from './exit.js';

export interface ParsedJanus {
  readonly command: 'janus';
  /** The ref whose tests run: the merge base with it. */
  readonly since: string;
  /** The command to run, as it follows `--`. */
  readonly run: readonly string[];
}

/** `janus --since <ref> -- <command>...`. */
export function parseJanusArgs(flags: Flags): ParsedJanus {
  const since = flags.values.get('--since');
  if (since === undefined) throw new OperatorError('`janus` needs --since: the ref whose tests run on this code');
  if (flags.positionals.length === 0) throw new OperatorError('`janus` needs a command to run, after `--`');
  return { command: 'janus', since, run: flags.positionals };
}
