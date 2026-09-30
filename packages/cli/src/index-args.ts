import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';

export interface ParsedIndex {
  readonly command: 'index';
  readonly noGit?: boolean;
  /** Make every follow-up before returning. */
  readonly wait?: boolean;
  /** Be the process a detached `index` hands its follow-ups to. */
  readonly followUps?: boolean;
}

/**
 * Parse the step that publishes the source index, outside the config-shaped parser.
 *
 * Beside `parseSelectArgs` for the reason the two are one pipeline: this writes
 * what `select` and `reach` read, in a repository that may have configured this
 * tool for nothing else, so neither of them takes `--config`.
 */
export function parseIndexArgs(flags: Flags): ParsedIndex {
  noPositionals(flags.positionals, 'index');
  if (flags.present.has('--wait') && flags.present.has('--follow-ups')) {
    throw new OperatorError('index: --wait and --follow-ups are two ways of making the follow-ups; pass one');
  }
  return {
    command: 'index',
    ...(flags.present.has('--no-git') ? { noGit: true } : {}),
    ...(flags.present.has('--wait') ? { wait: true } : {}),
    ...(flags.present.has('--follow-ups') ? { followUps: true } : {}),
  };
}
