import { resolve } from 'node:path';
import { type Flags } from './args.js';
import { OperatorError } from './exit.js';
import type { CarryDirection, CarryHand, CarryMove } from './commands/carry.js';

export interface ParsedCarry {
  readonly command: 'carry';
  readonly direction: CarryDirection | CarryMove | CarryHand;
  /**
   * The project config, only when one is named. The suites are the
   * repository root's and are read without it, so a workflow that carries a
   * recording and runs no visual review needs no project configured.
   */
  readonly config?: string;
  /** `take` and `keep`: where the pushed records are, when not `.variance/pushed`. `hand` and `receive`: the directory the host moves, always named. */
  readonly dir?: string;
  readonly format: 'text' | 'github';
}

/**
 * `carry restore|save|take|keep|hand|receive`, the direction first, because it
 * is the question. `take` and `keep` name the pushed records' directory, or take
 * `.variance/pushed`. `hand` and `receive` must name theirs: it is an artifact's
 * path, which the workflow chose.
 */
export function parseCarryArgs(flags: Flags): ParsedCarry {
  const [direction, ...rest] = flags.positionals;
  if (direction !== 'restore' && direction !== 'save' && direction !== 'take' && direction !== 'keep' && direction !== 'hand' && direction !== 'receive') {
    throw new OperatorError(
      direction === undefined
        ? "`carry` needs a direction: `restore` before the run, `save` after it, `take` and `keep` for a pull request's next push, or `hand` and `receive` for a run's other jobs"
        : `\`carry\` restores, saves, takes, keeps, hands or receives, not \`${direction}\``,
    );
  }
  const handing = direction === 'hand' || direction === 'receive';
  const moves = handing || direction === 'take' || direction === 'keep';
  const [dir, ...more] = moves ? rest : [undefined, ...rest];
  if (handing && dir === undefined) throw new OperatorError(`\`carry ${direction}\` needs the directory the host moves between jobs`);
  if (more.length > 0) throw new OperatorError(`\`carry ${direction}\` takes no other argument, and was given \`${more[0]}\``);
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'github') {
    throw new OperatorError(`--format must be text or github, not \`${format}\``);
  }
  const config = flags.values.get('--config');

  return {
    command: 'carry',
    direction,
    ...(config === undefined ? {} : { config: resolve(config) }),
    ...(dir === undefined ? {} : { dir: resolve(dir) }),
    format,
  };
}
