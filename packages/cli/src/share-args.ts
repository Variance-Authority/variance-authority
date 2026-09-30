import { type Flags } from './args.js';
import { OperatorError } from './exit.js';

/** The two directions of `variance share`, which take different inputs. */
export interface ParsedShare {
  readonly command: 'share';
  readonly config: string;
  /** The mainline to read. The pull request's base, else the listed one nearest `HEAD`. */
  readonly mainline?: string;
  /** Publish the report's suite index and subject costs rather than fetch mainline's. */
  readonly publish: boolean;
  /**
   * The reports to publish from; `config.report` when nothing is named. More
   * than one is the shards of one build, merged, and publishes their costs.
   */
  readonly reports: readonly string[];
  /**
   * The root config's suite whose record alone is read or published, with no
   * project config and no report: `share --suite <name>`.
   */
  readonly suite?: string;
}

/**
 * Parse the two directions apart, refusing the shape that reads like a third.
 *
 * Outside the main parser because the command is the only one whose positional
 * means something different depending on a flag, and that is exactly the kind of
 * rule that wants its own file rather than a longer switch arm.
 */
export function parseShareArgs(flags: Flags, config: string): ParsedShare {
  const mainline = flags.values.get('--mainline');
  const publish = flags.present.has('--publish');
  if (flags.positionals.length > 0 && !publish) {
    // A report is only an input to the publishing direction. Accepting one
    // while fetching would read as "look this up as of that run", which is
    // not what the mainline is read from and never will be.
    throw new OperatorError('`share <report>` is for `--publish`; a lookup takes `--mainline`');
  }
  const suite = flags.values.get('--suite');
  if (suite !== undefined) {
    // `--suite` reads the root config, which declares the suite and the share
    // it is published to. A project config, a report and a mainline to read
    // are the other form's inputs, and naming one beside it asks for both.
    const other = [
      ...(flags.values.has('--config') ? ['`--config`'] : []),
      ...(mainline !== undefined ? ['`--mainline`'] : []),
      ...(flags.positionals.length > 0 ? ['report'] : []),
    ];
    if (other.length > 0) {
      throw new OperatorError(
        `\`share --suite\` reads the suite and its share from the root variance.config.json, so it takes no ${other.join(' or ')}`,
      );
    }
  }
  return {
    command: 'share',
    config,
    publish,
    ...(mainline !== undefined ? { mainline } : {}),
    reports: flags.positionals,
    ...(suite !== undefined ? { suite } : {}),
  };
}
