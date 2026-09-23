import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';
import type { SelectFormat } from './commands/select.js';

export interface ParsedSelect {
  readonly command: 'select';
  /** `--since <ref>`: the base to measure from when the journal names no commit. */
  readonly since?: string;
  readonly format: SelectFormat;
  readonly noGit?: boolean;
  /** `--execution <path>`: a journey file to read instead of this checkout's snapshot. */
  readonly execution?: string;
  /** `--diff <path>`, or `-` for stdin: the change, handed in rather than read from git. */
  readonly diff?: string;
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
  const execution = flags.values.get('--execution');
  const diff = flags.values.get('--diff');
  if (diff !== undefined && execution === undefined) {
    throw new OperatorError(
      '`--diff` is read against a journey file, and none was named: pass `--execution <path>`',
    );
  }
  if (execution !== undefined && diff === undefined && since === undefined) {
    throw new OperatorError(
      'a journey file names no commit, so the change has to be given: pass `--diff <patch>` ' +
        '(`-` reads stdin) or `--since <ref>`',
    );
  }
  if (diff !== undefined && since !== undefined) {
    throw new OperatorError('`--diff` and `--since` both name the change; pass one');
  }

  return {
    command: 'select',
    ...(since === undefined ? {} : { since }),
    format,
    ...(flags.present.has('--no-git') ? { noGit: true } : {}),
    ...(execution === undefined ? {} : { execution: resolve(execution) }),
    ...(diff === undefined ? {} : { diff: diff === '-' ? diff : resolve(diff) }),
  };
}
