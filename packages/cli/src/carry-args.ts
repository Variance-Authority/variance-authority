import { resolve } from 'node:path';
import { type Flags } from './args.js';
import { OperatorError } from './exit.js';
import type { CarryDirection } from './commands/carry.js';

export interface ParsedCarry {
  readonly command: 'carry';
  readonly direction: CarryDirection;
  /**
   * The project config, only when one is named. The suites are the
   * repository root's and are read without it, so a workflow that carries a
   * recording and runs no visual review needs no project configured.
   */
  readonly config?: string;
  readonly format: 'text' | 'github';
}

/** `carry restore|save`, the direction first, because it is the question. */
export function parseCarryArgs(flags: Flags): ParsedCarry {
  const [direction, ...rest] = flags.positionals;
  if (direction !== 'restore' && direction !== 'save') {
    throw new OperatorError(
      direction === undefined
        ? '`carry` needs a direction: `restore` before the run, or `save` after it'
        : `\`carry\` restores or saves, not \`${direction}\``,
    );
  }
  if (rest.length > 0) throw new OperatorError(`\`carry ${direction}\` takes no other argument, and was given \`${rest[0]}\``);
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'github') {
    throw new OperatorError(`--format must be text or github, not \`${format}\``);
  }
  const config = flags.values.get('--config');

  return { command: 'carry', direction, ...(config === undefined ? {} : { config: resolve(config) }), format };
}
