import { countOf, noPositionals, type Flags } from './args.js';
import { parseAtDistance } from './covering-args.js';
import { OperatorError } from './exit.js';
import type { ShardsFormat } from './commands/shards.js';

export interface ParsedShards {
  readonly command: 'shards';
  readonly suite?: string;
  /** `--since <ref>`: the change whose skipped files ask for no shard. */
  readonly since?: string;
  /** `--at-distance <hops>`: count only the leg of the change's selection this many imports away. */
  readonly atDistance?: { readonly from: number; readonly to: number };
  /** `--setup <seconds>`, in milliseconds: what each shard spends before its first test; absent, the count does not weigh it. */
  readonly setup?: number;
  /** `--budget <seconds>`, in milliseconds: what one shard may take, setup included. */
  readonly budget?: number;
  readonly max?: number;
  /** `--workers <n>`: how many test files one shard's runner runs at once. */
  readonly workers?: number;
  /** `--collected <file>`: the runner's list of test files, which counts what `--since` adds. */
  readonly collected?: string;
  /** `--unrecorded <n>`: the count to answer while nothing is recorded. */
  readonly unrecorded?: number;
  readonly format: ShardsFormat;
}

/**
 * Parse `variance shards`, which reads a record and no project, like `select`.
 *
 * Only a value that is not one refuses. A missing `--setup`, a budget no
 * shard can meet, `--since` with no `--collected` or `--at-distance` with no
 * `--since` is answered, and the
 * answer names what it could not weigh. `--setup` has no default: what a
 * shard spends before its first test is the checkout, the install and the
 * build of one CI, and a number chosen here would be somebody else's
 * pipeline, so without one the count weighs none and says so.
 */
export function parseShardsArgs(flags: Flags): ParsedShards {
  noPositionals(flags.positionals, 'shards');
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new OperatorError(`--format must be text or json, not \`${format}\``);
  }
  const setup = secondsOf(flags.values.get('--setup'), '--setup', 'what each shard spends before its first test');
  const budget = secondsOf(flags.values.get('--budget'), '--budget', 'one shard may take, setup included');
  const max = countOf(flags.values.get('--max'), 'shards to start', '--max');
  const workers = countOf(flags.values.get('--workers'), 'test files one shard runs at once', '--workers');
  const unrecorded = flags.values.get('--unrecorded');
  if (unrecorded !== undefined && !/^(0|[1-9][0-9]*)$/.test(unrecorded)) {
    throw new OperatorError(`--unrecorded is how many shards to start while nothing is recorded, a whole number, not \`${unrecorded}\``);
  }
  const suite = flags.values.get('--suite');
  const since = flags.values.get('--since');
  const collected = flags.values.get('--collected');
  const atDistance = parseAtDistance(flags);
  return {
    command: 'shards',
    ...(suite === undefined ? {} : { suite }),
    ...(since === undefined ? {} : { since }),
    ...(collected === undefined ? {} : { collected }),
    ...(atDistance === undefined ? {} : { atDistance }),
    ...(setup === undefined ? {} : { setup }),
    ...(budget === undefined ? {} : { budget }),
    ...(max === undefined ? {} : { max }),
    ...(workers === undefined ? {} : { workers }),
    ...(unrecorded === undefined ? {} : { unrecorded: Number(unrecorded) }),
    format,
  };
}

function secondsOf(value: string | undefined, flag: string, what: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(value)) {
    throw new OperatorError(`${flag} is ${what}, in seconds, not \`${value}\``);
  }
  return Math.round(Number(value) * 1000);
}
