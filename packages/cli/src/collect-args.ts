// compass: variance-authority.report.shard-merge
import { resolve } from 'node:path';
import { countOf, type Flags } from './args.js';
import { OperatorError } from './exit.js';
import { parseShard, type Shard } from './shard-args.js';

/**
 * `variance collect`: one job's evidence into a part, or every job's parts into
 * the suite index. Two forms, because the merge reads no project: what it needs
 * is in the parts, and a config beside them would be a second account of it.
 */
export type ParsedCollect =
  | {
      readonly command: 'collect';
      readonly operation?: undefined;
      readonly config: string;
      readonly shard?: Shard;
      /** Browsers this job opens, over `workers` in the config. */
      readonly workers?: number;
      readonly subjects?: string;
      readonly out: string;
    }
  | { readonly command: 'collect'; readonly operation: 'merge'; readonly parts: readonly string[]; readonly out: string };

const COLLECTING = ['--config', '--subjects', '--shard', '--workers'] as const;

export function parseCollectArgs(flags: Flags, config: string): ParsedCollect {
  const out = flags.values.get('--out');
  const [operation, ...parts] = flags.positionals;

  if (operation === 'merge') {
    const given = COLLECTING.filter((flag) => flags.present.has(flag));
    if (given.length > 0) {
      throw new OperatorError(
        `\`variance collect merge\` takes no ${given.map((flag) => `\`${flag}\``).join(' or ')}: each part already says how it was collected`,
      );
    }
    if (parts.length === 0) throw new OperatorError('`variance collect merge` needs at least one part, such as `evidence-*.json`');
    if (out === undefined) throw new OperatorError('`variance collect merge` needs `--out <suite.index>`, where the index is written');
    return { command: 'collect', operation: 'merge', parts: parts.map((path) => resolve(path)), out: resolve(out) };
  }

  if (operation !== undefined) {
    throw new OperatorError(`\`variance collect\` takes no part to read, and got ${operation}; to fold parts, run \`variance collect merge ${flags.positionals.join(' ')} --out <suite.index>\``);
  }
  if (out === undefined) throw new OperatorError('`variance collect` needs `--out <part.json>`, where this job\'s part is written');

  const shardText = flags.values.get('--shard');
  const shard = shardText === undefined ? undefined : parseShard(shardText);
  if (typeof shard === 'string') throw new OperatorError(shard);
  const workers = countOf(flags.values.get('--workers'), 'browsers this job opens', '--workers');
  const subjects = flags.values.get('--subjects');

  return {
    command: 'collect',
    config,
    ...(shard === undefined ? {} : { shard }),
    ...(workers === undefined ? {} : { workers }),
    ...(subjects === undefined ? {} : { subjects }),
    out: resolve(out),
  };
}
