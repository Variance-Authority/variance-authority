import { resolve } from 'node:path';
import { type Flags } from './args.js';
import { OperatorError } from './exit.js';
import type { CarryDirection, CarryHand, CarryMerge, CarryMove } from './commands/carry.js';

export interface ParsedCarry {
  readonly command: 'carry';
  readonly direction: CarryDirection | CarryMove | CarryHand | CarryMerge;
  /**
   * The project config, only when one is named. The suites are the
   * repository root's and are read without it, so a workflow that carries a
   * recording and runs no visual review needs no project configured.
   */
  readonly config?: string;
  /** `take` and `keep`: where the pushed records are, when not `.variance/pushed`. `hand` and `receive`: the directory the host moves, always named. */
  readonly dir?: string;
  /** `merge`: the commit the mainline's record was made at, empty when there is none. */
  readonly commit?: string;
  /** `merge`: the pull request's head, when named rather than read from the event. */
  readonly head?: string;
  /** `merge`: what a head that conflicts with `commit` does, `stay` on the host's merge or `fail` the job. */
  readonly onConflict?: 'stay' | 'fail';
  /** `merge`: the merge commit the job that decided the run made, which this one's must be. */
  readonly expect?: string;
  readonly format: 'text' | 'github';
}

const DIRECTIONS = new Set(['restore', 'save', 'take', 'keep', 'hand', 'receive', 'merge']);

/** The flags only `merge` reads. */
const MERGE_FLAGS = ['--head', '--on-conflict', '--expect'] as const;

/**
 * `carry restore|save|take|keep|hand|receive|merge`, the direction first,
 * because it is the question. `take` and `keep` name the pushed records'
 * directory, or take `.variance/pushed`. `hand` and `receive` must name theirs:
 * it is an artifact's path, which the workflow chose. `merge` names the
 * record's commit, which a workflow output may leave empty, and is the one
 * direction that takes `--head`, `--on-conflict` and `--expect`; an empty one
 * of those is not given.
 */
export function parseCarryArgs(flags: Flags): ParsedCarry {
  const [direction, ...rest] = flags.positionals;
  if (direction === undefined || !DIRECTIONS.has(direction)) {
    throw new OperatorError(
      direction === undefined
        ? "`carry` needs a direction: `restore` before the run, `save` after it, `take` and `keep` for a pull request's next push, `hand` and `receive` for a run's other jobs, or `merge` for a pull request's head"
        : `\`carry\` restores, saves, takes, keeps, hands, receives or merges, not \`${direction}\``,
    );
  }
  const typed = direction as ParsedCarry['direction'];
  const merging = typed === 'merge';
  for (const flag of MERGE_FLAGS) {
    if (!merging && flags.present.has(flag)) throw new OperatorError(`\`${flag}\` belongs to \`carry merge\`, not \`carry ${typed}\``);
  }
  const handing = typed === 'hand' || typed === 'receive';
  const named = merging || handing || typed === 'take' || typed === 'keep';
  const [first, ...more] = named ? rest : [undefined, ...rest];
  if (handing && first === undefined) throw new OperatorError(`\`carry ${typed}\` needs the directory the host moves between jobs`);
  if (merging && first === undefined) throw new OperatorError("`carry merge` needs the record's commit, empty when the mainline has none");
  if (more.length > 0) throw new OperatorError(`\`carry ${typed}\` takes no other argument, and was given \`${more[0]}\``);
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'github') {
    throw new OperatorError(`--format must be text or github, not \`${format}\``);
  }
  const config = flags.values.get('--config');

  return {
    command: 'carry',
    direction: typed,
    ...(config === undefined ? {} : { config: resolve(config) }),
    ...(first === undefined || merging ? {} : { dir: resolve(first) }),
    ...(merging ? mergeAsk(first ?? '', flags) : {}),
    format,
  };
}

function mergeAsk(commit: string, flags: Flags): Pick<ParsedCarry, 'commit' | 'head' | 'onConflict' | 'expect'> {
  const given = (flag: string): string | undefined => {
    const value = flags.values.get(flag);
    return value === undefined || value === '' ? undefined : value;
  };
  const onConflict = given('--on-conflict') ?? 'fail';
  if (onConflict !== 'stay' && onConflict !== 'fail') throw new OperatorError(`--on-conflict must be stay or fail, not \`${onConflict}\``);
  const head = given('--head');
  const expect = given('--expect');
  return { commit, ...(head === undefined ? {} : { head }), onConflict, ...(expect === undefined ? {} : { expect }) };
}
