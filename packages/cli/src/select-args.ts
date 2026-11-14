import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';
import type { SelectFormat } from './commands/select.js';

export interface ParsedSelect {
  readonly command: 'select';
  /** `--since <ref>`: the base to measure from when the journal names no commit. */
  readonly since?: string;
  /** `--ran-at <commit>`: the pull request's tested tree, which a merge queue merged onto `--since`. */
  readonly ranAt?: string;
  readonly format: SelectFormat;
  readonly noGit?: boolean;
  /** `--execution <path>`: a journey file to read instead of this checkout's snapshot. */
  readonly execution?: string;
  /** `--diff <path>`, or `-` for stdin: the change, handed in rather than read from git. */
  readonly diff?: string;
  /**
   * `--suite <name>`: whose record is read, when more than one suite is declared;
   * beside a journey file, whose `before` it is read against.
   */
  readonly suite?: string;
  /** `--at-distance <hops>`: one leg of the selection, the text as typed, read by `parseAtDistance`. */
  readonly atDistance?: string;
  /** `--local`: a reading that cannot narrow falls to the changed files' importers or packages. */
  readonly local?: boolean;
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
  const suite = flags.values.get('--suite');
  const atDistance = flags.values.get('--at-distance');
  const ranAt = flags.values.get('--ran-at');
  if (diff !== undefined && execution === undefined) {
    throw new OperatorError(
      '`--diff` is read against a journey file, and none was named: pass `--execution <path>`',
    );
  }
  if (ranAt !== undefined && since === undefined) {
    throw new OperatorError('`--ran-at` names the pull request a merge queue merged onto `--since`, and no `--since` was passed');
  }
  if (ranAt !== undefined && execution !== undefined) {
    throw new OperatorError('`--ran-at` reads both sides of a merge from git, and `--execution` names a record git does not hold; pass one');
  }
  if (diff !== undefined && since !== undefined) {
    throw new OperatorError('`--diff` and `--since` both name the change; pass one');
  }

  return {
    command: 'select',
    ...(since === undefined ? {} : { since }),
    ...(ranAt === undefined ? {} : { ranAt }),
    format,
    ...(flags.present.has('--no-git') ? { noGit: true } : {}),
    ...(execution === undefined ? {} : { execution: resolve(execution) }),
    ...(diff === undefined ? {} : { diff: diff === '-' ? diff : resolve(diff) }),
    ...(suite === undefined ? {} : { suite }),
    ...(atDistance === undefined ? {} : { atDistance }),
    ...(flags.present.has('--local') ? { local: true } : {}),
  };
}
