import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';
import type { SelectFormat } from './commands/select.js';

export interface ParsedSelect {
  readonly command: 'select';
  /** `--since <ref>`: the base to measure from when the journal names no commit. */
  readonly since?: string;
  readonly format: SelectFormat;
}

/**
 * Parse the one command a foreign runner calls, outside the config-shaped parser.
 *
 * Beside `parseDistill` for the same reason: both read evidence and neither
 * reads a project, so neither takes `--config`, and a parser that handed them
 * one would be advertising a file the command never opens.
 *
 * `plain` is the default because the default consumer is a shell, and a shell
 * that substitutes this straight into a command line gets paths — not a JSON
 * document it would pass to a runner as a filename.
 */
export function parseSelectArgs(flags: Flags): ParsedSelect {
  noPositionals(flags.positionals, 'select');
  const format = flags.values.get('--format') ?? 'plain';
  if (format !== 'plain' && format !== 'json' && format !== 'vitest' && format !== 'jest') {
    throw new OperatorError(`--format must be plain, json, vitest or jest, not \`${format}\``);
  }
  const since = flags.values.get('--since');

  return { command: 'select', ...(since === undefined ? {} : { since }), format };
}
