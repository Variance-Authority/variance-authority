import { type Flags } from './args.js';
import { OperatorError } from './exit.js';

/** The directions of `variance share`, which take different inputs. */
export interface ParsedShare {
  readonly command: 'share';
  readonly config: string;
  /** Set when `--config` was given: a purge then removes from that config's share and no other. */
  readonly configNamed?: boolean;
  /** The mainline to read. The pull request's base, else the listed one nearest `HEAD`. */
  readonly mainline?: string;
  /** Publish the report's suite index and subject costs rather than fetch mainline's. */
  readonly publish: boolean;
  /**
   * The project form: the reports to publish from, `config.report` when
   * nothing is named; more than one is the shards of one build, merged, and
   * publishes their costs. The root config's form: the records its suites'
   * jobs handed on, files or directories holding `suites/<suite>/coverage.bin`,
   * folded over the mainline's base before it is read or published.
   */
  readonly reports: readonly string[];
  /**
   * The root config's suite whose record alone is read or published, with no
   * project config: `share --suite <name>`. Every suite the root config gives
   * to the share when absent and no project is configured.
   */
  readonly suite?: string;
  /**
   * A file listing the test files the suite's runner collects at this commit,
   * one per line, as `vitest list --filesOnly` prints them: what a mainline
   * publish counts a whole run against. A directory holds one `<suite>.txt`
   * per suite, for a publish of several.
   */
  readonly collected?: string;
  /**
   * `github` prints `commit=<sha>`, the commit of the record `--suite` reads,
   * for `$GITHUB_OUTPUT`: what a workflow merges a pull request with before it
   * selects, empty when the mainline holds none; and `based=true` when the
   * record laid carries its cases. Read for several suites, each output is
   * keyed by its suite, `commit-<suite>=`.
   */
  readonly format?: 'text' | 'github';
  /** Remove what is kept by commit, written more than this many days ago, rather than read or publish. */
  readonly purgeOlderThan?: number;
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
  const suite = flags.values.get('--suite');
  if (suite !== undefined) {
    // `--suite` reads the root config, which declares the suite and the share
    // it is published to. A project config and a mainline to read are the
    // other form's inputs, and naming one beside it asks for both.
    const other = [
      ...(flags.values.has('--config') ? ['`--config`'] : []),
      ...(mainline !== undefined ? ['`--mainline`'] : []),
    ];
    if (other.length > 0) {
      throw new OperatorError(
        `\`share --suite\` reads the suite and its share from the root variance.config.json, so it takes no ${other.join(' or ')}`,
      );
    }
  }
  const collected = flags.values.get('--collected');
  if (collected !== undefined && !publish) {
    // The list is what a whole run is counted against, and only a publish counts one.
    throw new OperatorError('`--collected` is for `share --publish`, which counts a whole run against it');
  }
  const format = flags.values.get('--format');
  if (format !== undefined && format !== 'text' && format !== 'github') {
    throw new OperatorError(`--format must be text or github, not \`${format}\``);
  }
  if (format !== undefined && (publish || mainline !== undefined || flags.values.has('--config'))) {
    throw new OperatorError("`--format` shapes what `share` reads for the root config's suites; a publish prints what it wrote");
  }
  const purge = flags.values.get('--purge-older-than');
  if (purge !== undefined && !/^\d+$/u.test(purge)) {
    throw new OperatorError(`--purge-older-than takes a whole number of days, not \`${purge}\``);
  }
  if (purge !== undefined && (publish || suite !== undefined || flags.positionals.length > 0)) {
    // A record at a commit holds every suite's entries, so a purge names no suite.
    throw new OperatorError('`--purge-older-than` removes whole records by commit, so it takes no `--publish`, `--suite` or report');
  }
  return {
    command: 'share',
    config,
    ...(flags.values.has('--config') ? { configNamed: true } : {}),
    publish,
    ...(purge !== undefined ? { purgeOlderThan: Number(purge) } : {}),
    ...(mainline !== undefined ? { mainline } : {}),
    reports: flags.positionals,
    ...(suite !== undefined ? { suite } : {}),
    ...(collected !== undefined ? { collected } : {}),
    ...(format !== undefined ? { format } : {}),
  };
}
