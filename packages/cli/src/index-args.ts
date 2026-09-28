import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';

export interface ParsedIndex {
  readonly command: 'index';
  readonly noGit?: boolean;
  readonly apiFiles?: readonly string[];
}

/**
 * Parse the step that publishes the source index, outside the config-shaped parser.
 *
 * Beside `parseSelectArgs` for the reason the two are one pipeline: this writes
 * what `select` and `reach` read, in a repository that may have configured this
 * tool for nothing else, so neither of them takes `--config`.
 */
export function parseIndexArgs(flags: Flags): ParsedIndex {
  if (flags.present.has('--api')) {
    if (flags.present.has('--no-git')) throw new OperatorError('`index --api` reads a published source index and cannot take `--no-git`');
    if (flags.positionals.length === 0) throw new OperatorError('`index --api` needs at least one source file');
    return { command: 'index', apiFiles: flags.positionals };
  }
  noPositionals(flags.positionals, 'index');
  return { command: 'index', ...(flags.present.has('--no-git') ? { noGit: true } : {}) };
}
