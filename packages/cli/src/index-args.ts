import { noPositionals, type Flags } from './args.js';

export interface ParsedIndex {
  readonly command: 'index';
  readonly noGit?: boolean;
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
  return { command: 'index', ...(flags.present.has('--no-git') ? { noGit: true } : {}) };
}
