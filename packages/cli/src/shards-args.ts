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
  /** `--setup <seconds>`, in milliseconds: what each shard spends before its first test. */
  readonly setup: number;
  /** `--budget <seconds>`, in milliseconds: what one shard may take, setup included. */
  readonly budget?: number;
  readonly max?: number;
  /** `--workers <n>`: how many test files one shard's runner runs at once. */
  readonly workers?: number;
  /** `--collected <file>`: the runner's list of test files, which `--since` needs. */
  readonly collected?: string;
  /** `--unrecorded <n>`: the count to answer while nothing is recorded. */
  readonly unrecorded?: number;
  readonly format: ShardsFormat;
}

/**
 * Parse `variance shards`, which reads a record and no project, like `select`.
 *
 * `--setup` has no default. What a shard spends before its first test is the
 * checkout, the install and the build of one CI, and a number chosen here
 * would be somebody else's pipeline: too low asks for shards that only set
 * up, too high runs a suite on one machine that four would finish sooner.
 */
export function parseShardsArgs(flags: Flags): ParsedShards {
  noPositionals(flags.positionals, 'shards');
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new OperatorError(`--format must be text or json, not \`${format}\``);
  }
  const setup = secondsOf(flags.values.get('--setup'), '--setup', 'what each shard spends before its first test');
  if (setup === undefined) {
    throw new OperatorError(
      '`variance shards` needs `--setup <seconds>`: what each shard spends before its first test — ' +
        'checkout, install and build — which decides when one more shard stops paying for itself',
    );
  }
  const budget = secondsOf(flags.values.get('--budget'), '--budget', 'one shard may take, setup included');
  if (budget === 0) throw new OperatorError('--budget is what one shard may take, and no shard finishes in 0 s');
  // Every shard spends its setup before its first test, so no count meets a
  // budget the setup alone takes, and a slow file is never what stands in the way.
  if (budget !== undefined && budget <= setup) {
    throw new OperatorError(
      `--budget is what one shard may take, setup included, and no shard finishes in ${flags.values.get('--budget')} s ` +
        `when each spends ${flags.values.get('--setup')} s on setup before its first test`,
    );
  }
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
  if (atDistance !== undefined && since === undefined) {
    throw new OperatorError('`variance shards --at-distance` cuts the selection of a change, and none is named: pass `--since <ref>`');
  }
  if (since !== undefined && collected === undefined) {
    throw new OperatorError(
      '`variance shards --since` needs `--collected <file>`, the runner\'s list of test files: the record holds only ' +
        'the files it has seen, and a change that only adds tests would count 0 shards without the list',
    );
  }
  return {
    command: 'shards',
    ...(suite === undefined ? {} : { suite }),
    ...(since === undefined ? {} : { since }),
    ...(collected === undefined ? {} : { collected }),
    ...(atDistance === undefined ? {} : { atDistance }),
    setup,
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
