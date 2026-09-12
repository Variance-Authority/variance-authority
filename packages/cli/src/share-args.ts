import { type Flags } from './args.js';
import { OperatorError } from './exit.js';

/** The two directions of `variance share`, which take different inputs. */
export interface ParsedShare {
  readonly command: 'share';
  readonly config: string;
  /** The mainline ref whose lineage is looked up. The config's, or `origin/main`. */
  readonly ref?: string;
  /** Publish the report's suite index rather than fetch mainline's. */
  readonly publish: boolean;
  /** The report to publish from. `config.report` when nothing is named. */
  readonly report?: string;
}

/**
 * Parse the two directions apart, refusing the shape that reads like a third.
 *
 * Outside the main parser because the command is the only one whose positional
 * means something different depending on a flag, and that is exactly the kind of
 * rule that wants its own file rather than a longer switch arm.
 */
export function parseShareArgs(flags: Flags, config: string): ParsedShare {
  const ref = flags.values.get('--ref');
  const publish = flags.present.has('--publish');
  if (flags.positionals.length > 1) {
    throw new OperatorError('`share` publishes from one report, and more than one was named');
  }
  const report = flags.positionals[0];
  if (report !== undefined && !publish) {
    // A report is only an input to the publishing direction. Accepting one
    // while fetching would read as "look this up as of that run", which is
    // not what the lineage is walked from and never will be.
    throw new OperatorError('`share <report>` is for `--publish`; a lookup takes `--ref`');
  }
  return {
    command: 'share',
    config,
    publish,
    ...(ref !== undefined ? { ref } : {}),
    ...(report !== undefined ? { report } : {}),
  };
}
