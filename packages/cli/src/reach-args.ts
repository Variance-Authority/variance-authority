import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';
import type { ReachFormat } from './commands/reach-command.js';

export interface ParsedReach {
  readonly command: 'reach';
  /** `--since <ref>`: the base to measure the diff from. There is no other coordinate. */
  readonly since: string;
  readonly format: ReachFormat;
  /** `--whole-files`: walk from every changed file whole, without reading the edit. */
  readonly wholeFiles?: boolean;
  readonly noGit?: boolean;
}

/**
 * Parse the command a foreign runner pipes, outside the config-shaped parser.
 *
 * Beside `parseSelectArgs` and `parseDistill` for the same reason: none of the
 * three reads a project, so none takes `--config`, and a parser that handed one
 * over would be advertising a file the command never opens.
 *
 * `--since` is required, unlike on `select`. There the execution journal names
 * the commit its line ranges are coordinates in, so a missing flag still has an
 * answer; here nothing carries a coordinate, and a reach with no base would
 * report the whole checkout as affected — a dump wearing the shape of an
 * answer, and the one output of this command that could be piped into a full
 * run without anybody noticing.
 *
 * `plain` is the default because the default consumer is a shell about to
 * substitute the answer into somebody else's command line.
 */
export function parseReachArgs(flags: Flags): ParsedReach {
  noPositionals(flags.positionals, 'reach');

  const format = flags.values.get('--format') ?? 'plain';
  if (format !== 'plain' && format !== 'json') {
    throw new OperatorError(`--format must be plain or json, not \`${format}\``);
  }

  const since = flags.values.get('--since');
  if (since === undefined || since === '') {
    throw new OperatorError(
      'reach needs `--since <ref>` to measure a diff from. Without one there is no change to ' +
        'walk from, and the honest answer would be every file in the checkout.',
    );
  }

  return {
    command: 'reach',
    since,
    format,
    ...(flags.present.has('--whole-files') ? { wholeFiles: true } : {}),
    ...(flags.present.has('--no-git') ? { noGit: true } : {}),
  };
}
