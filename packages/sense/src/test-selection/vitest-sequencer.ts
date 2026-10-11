/**
 * Where a Vitest run drops the test files a selection may skip: its sequencer.
 *
 * The sequencer is the one place Vitest hands every file it found, after it
 * found them and before any runs, under `--shard` and across `projects`, in
 * the process that reads the configuration. Dropping a file there is what a
 * file filter on argv did, without the argv: a selection of ten thousand files
 * never meets a command line's length limit, and the run still discovered the
 * whole suite, so the count it prints is of the suite.
 *
 * The project's own sequencer is chained rather than replaced. What it is
 * handed is what is left, so a shard cuts what runs rather than what was
 * found, and its order is the project's own.
 *
 * Every file dropped here is one the run never collected, so the run that
 * records it is a partial run: what it holds is folded over the record as any
 * filtered run's is, and a skipped file keeps the rows it had.
 *
 * Vitest checks for "no test files" before it calls the sequencer, so a run
 * whose every file was skipped exits as a run that passed. That is the
 * answer, and the line before it says `selected none of M`.
 *
 * Under `--shard k/n` the files left are placed by the time the suite's record
 * holds for each, rather than cut by count: every shard places every file and
 * keeps its own part (`shard-placement.ts`), and stderr says which part and
 * what it is expected to take. With no time recorded for any of them the
 * project's sequencer cuts the shard, and the line says that instead.
 */

// compass: variance-authority.reach

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cutOf, type CaseCut } from './case-cut.js';
import { projectPath } from './instrumented-modules.js';
import { shardOf, type ShardAsked } from './shard-placement.js';
import { selectedLines, type SuiteSelection, type SuiteTimes } from './suite-selection.js';

/** Marks a sequencer that already selects, so a second wrap is the first one. */
const SELECTING = Symbol.for('variance-authority:selecting-sequencer');
/** On a selecting sequencer: the seed a run under it shuffles files with, or `undefined` when it shuffles none. */
const SEED = Symbol.for('variance-authority:selecting-seed');
/** Marks a logger whose banner already names the seed, so a second hook is the first one. */
const BANNER = Symbol.for('variance-authority:seed-banner');

/** The part of Vitest's context a sequencer is constructed with that this one reads. */
export interface SequencerContext {
  readonly config: {
    readonly root?: string;
    readonly watch?: boolean;
    readonly shard?: unknown;
    readonly sequence?: { readonly shuffle?: unknown; seed?: number };
  };
  readonly state?: { readonly getPaths?: () => readonly string[] };
  /** Vitest's logger, which {@link seedInBanner} marks once its banner names the seed. */
  readonly logger?: object;
  /** The command line as Vitest 3 and 4 parsed it, before it was merged over the configuration file. */
  readonly _cliOptions?: { readonly sequence?: { readonly shuffle?: unknown } };
}

/** The part of Vitest's own context its banner reads: what a reporter's `onInit` and a plugin's `configureVitest` are handed. */
export interface BannerContext {
  readonly config: { readonly sequence?: { readonly sequencer?: unknown; readonly shuffle?: unknown; seed?: number } };
  readonly logger?: BannerLogger;
}

interface BannerLogger {
  log(...args: unknown[]): void;
  printBanner?(): void;
}

/** A test file as Vitest 2 hands it to a sequencer: `moduleId`, and the tuple it replaced. */
interface Spec {
  readonly moduleId?: string;
  readonly 1?: string;
}

interface Sequencer {
  shard<T extends Spec>(files: T[]): Promise<T[]>;
  sort<T extends Spec>(files: T[]): Promise<T[]>;
}

export type SequencerClass = new (ctx: SequencerContext) => Sequencer;

export interface SelectingOptions {
  /** The checkout the selection names its files from. */
  readonly root: string;
  /** Where the project's Vitest resolves from, for the sequencer it would have used. */
  readonly configRoot: string;
  /** Read once, the first time a run asks; absent, every file runs. */
  readonly selection?: () => Promise<SuiteSelection>;
  /** The suite's recorded times, read once, and only by a run under `--shard`. */
  readonly times?: () => Promise<SuiteTimes>;
  /**
   * Told, as each sequencer is made, whether the run asked for `--shard`, as
   * the runner resolved it: the sequencer is made under any reporter, and a
   * command-line `--reporter` replaces the seam's.
   */
  readonly sharded?: (asked: boolean) => void;
  /**
   * Handed the cases the selection skips in the files it kept, keyed by the
   * absolute path the run knows each by, when it skips any. It may be handed
   * them more than once in a run — `shard` and `sort` each keep files — so it
   * merges what it is handed.
   */
  readonly cut?: (cases: CaseCut) => void;
  /** Where the count goes; stderr unless a test says otherwise. */
  readonly say?: (line: string) => void;
  /**
   * `sequence.shuffle` as the configuration wrote it. Vitest reads an object's
   * `files` to pick its own sequencer and keeps only `tests` after, so the
   * object is read here, where it is still whole.
   */
  readonly shuffle?: unknown;
}

/**
 * A sequencer class that drops `selection().skip`, places the rest by `times()`
 * under `--shard`, and hands what is left to `own`, or to the sequencer Vitest
 * would have picked when the project named none.
 */
export function selectingSequencer(own: SequencerClass | undefined, options: SelectingOptions): SequencerClass {
  if (own !== undefined && (own as unknown as Record<symbol, unknown>)[SELECTING] === true) return own;
  const say = options.say ?? ((line: string) => process.stderr.write(`${line}\n`));
  let asked: Promise<SuiteSelection> | undefined;
  let timed: Promise<SuiteTimes> | undefined;
  let said = false;
  let placed = false;
  let seeded = false;

  class Selecting implements Sequencer {
    static readonly [SELECTING] = true;
    readonly #ctx: SequencerContext;
    #inner: Promise<Sequencer> | undefined;

    /**
     * What Vitest does for its own `RandomSequencer` only: a seed when none was
     * given, on the config its workers are handed. Asked by the banner, which
     * prints before any sequencer is made, and by each sequencer.
     */
    static [SEED](ctx: SequencerContext): number | undefined {
      if (own !== undefined || ctx.config.sequence === undefined || !filesShuffled(options.shuffle, ctx)) return undefined;
      return ctx.config.sequence.seed ??= Date.now();
    }

    /**
     * A banner {@link seedInBanner} never reached has printed without the seed
     * by the time a sequencer is made: a reporter named on the command line
     * replaces the seam's, and Vitest before 3.1 hands a plugin no other way to
     * it. The run is seeded all the same, and the seed is named on stderr, with
     * what the selection said, so the run can be reproduced.
     */
    constructor(ctx: SequencerContext) {
      this.#ctx = ctx;
      options.sharded?.(shardAsked(ctx.config.shard) !== undefined);
      const seed = Selecting[SEED](ctx);
      const banner = (ctx.logger as { [BANNER]?: true } | undefined)?.[BANNER] === true;
      if (seed === undefined || banner || seeded) return;
      say(`variance-authority: running tests with seed "${seed}"; --sequence.seed=${seed} runs them in this order again`);
      seeded = true;
    }

    async shard<T extends Spec>(files: T[]): Promise<T[]> {
      const kept = await this.#kept(files);
      const shard = shardAsked(this.#ctx.config.shard);
      if (shard === undefined || options.times === undefined) return (await this.#sequencer()).shard(kept);
      timed ??= options.times();
      const part = shardOf(kept.map((file) => projectPath(options.root, moduleOf(file))), shard, await timed);
      if (!placed) say(part.line);
      placed = true;
      if (part.take === undefined) return (await this.#sequencer()).shard(kept);
      return part.take.map((at) => kept[at]!);
    }

    async sort<T extends Spec>(files: T[]): Promise<T[]> {
      const kept = await this.#kept(files);
      return (await this.#sequencer()).sort(kept);
    }

    #sequencer(): Promise<Sequencer> {
      this.#inner ??= own === undefined
        ? vitestSequencer(options.configRoot, filesShuffled(options.shuffle, this.#ctx)).then((Inner) => new Inner(this.#ctx))
        : Promise.resolve(new own(this.#ctx));
      return this.#inner;
    }

    async #kept<T extends Spec>(files: T[]): Promise<T[]> {
      if (options.selection === undefined) return files;
      if (this.#ctx.config.watch === true) {
        if (!said) say('variance-authority: watch mode does not select');
        said = true;
        return files;
      }
      asked ??= options.selection();
      const selection = await asked;
      const name = (file: string) => projectPath(options.root, file);
      if (!said) {
        const discovered = this.#ctx.state?.getPaths?.() ?? files.map(moduleOf);
        for (const line of selectedLines(selection, discovered.map(name))) say(line);
      }
      said = true;
      const kept = files.filter((file) => !selection.skip.has(name(moduleOf(file))));
      const cut = cutOf(selection, kept.map(moduleOf), options.root);
      if (cut.size > 0) options.cut?.(cut);
      return kept;
    }
  }
  return Selecting;
}

/**
 * Has Vitest's banner name the seed a selecting sequencer shuffles files with,
 * where it names its own `RandomSequencer`'s.
 *
 * Vitest prints that line from its banner only, and only reporters that print
 * the banner call it: `--reporter=json` with no `outputFile` writes its report
 * to stdout, and a line there breaks whoever parses it. The banner checks
 * `sequence.sequencer === RandomSequencer`, which a wrapping sequencer never
 * is, so the line is added to the banner itself rather than printed beside it.
 * Vitest 2, 3 and 4 each print an empty line and then the `RUN` line first,
 * and the seed line next.
 *
 * Handed Vitest's context before any reporter prints the banner: by a reporter
 * ahead of the others in `onInit`, and by a plugin's `configureVitest` from
 * Vitest 3.1, which a command-line `--reporter` does not replace.
 */
export function seedInBanner(vitest: BannerContext): void {
  const logger = vitest.logger as (BannerLogger & { [BANNER]?: true }) | undefined;
  if (logger?.printBanner === undefined || logger[BANNER] === true) return;
  logger[BANNER] = true;
  const printBanner = logger.printBanner;
  logger.printBanner = function (this: BannerLogger): void {
    const sequencer = vitest.config.sequence?.sequencer as { [SEED]?: (ctx: SequencerContext) => number | undefined } | undefined;
    const seed = sequencer?.[SEED]?.(vitest);
    if (seed === undefined) return printBanner.call(this);
    const log = this.log;
    const owned = Object.hasOwn(this, 'log');
    let lines = 0;
    this.log = (...args: unknown[]) => {
      log.apply(this, args);
      if (++lines === 2) log.call(this, `      Running tests with seed "${seed}"`);
    };
    try {
      printBanner.call(this);
    } finally {
      if (owned) this.log = log;
      else delete (this as Partial<BannerLogger>).log;
    }
  };
}

/** `config.shard` as Vitest resolves `--shard k/n`, or `undefined` when no shard was asked for. */
function shardAsked(shard: unknown): ShardAsked | undefined {
  if (typeof shard !== 'object' || shard === null) return undefined;
  const { index, count } = shard as { index?: unknown; count?: unknown };
  return typeof index === 'number' && typeof count === 'number' ? { index, count } : undefined;
}

function moduleOf(spec: Spec): string {
  return spec.moduleId ?? spec[1] ?? '';
}

/**
 * Whether Vitest would have shuffled files, by the rule its config resolution
 * applies to `sequence.shuffle` once the command line is merged over the file:
 * an object's `files`, or the boolean.
 *
 * Vitest keeps only `tests` of an object after it picks its sequencer, so the
 * resolved config cannot tell `--sequence.shuffle.tests` from
 * `--sequence.shuffle`. From Vitest 3 the command line as parsed is on the
 * context, `_cliOptions`, and is read there; Vitest 2 keeps it from plugins and
 * sequencers alike, so there the resolved value is read when the file wrote no
 * object.
 */
function filesShuffled(written: unknown, ctx: SequencerContext): boolean {
  const asked = ctx._cliOptions?.sequence?.shuffle;
  const shuffle = asked === undefined ? written : isObject(asked) && isObject(written) ? { ...written, ...asked } : asked;
  if (isObject(shuffle)) return shuffle.files === true;
  if (asked !== undefined) return asked === true;
  return ctx.config.sequence?.shuffle === true;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

type Shuffle = <T>(array: T[], seed?: number) => T[];

/**
 * Vitest's own `BaseSequencer`, or its `RandomSequencer` when files are
 * shuffled, from the Vitest the project resolves: the one a sequencer would
 * have been without this wrap.
 *
 * `vitest/node` exports no `RandomSequencer` in any version this supports. It
 * is `BaseSequencer` sorting by `shuffle` from `@vitest/utils` (`/helpers`
 * from Vitest 4) with the run's seed, so it is put together here from those.
 */
async function vitestSequencer(configRoot: string, shuffled: boolean): Promise<SequencerClass> {
  const load = vitestImport(configRoot);
  const { BaseSequencer } = await load('vitest/node') as { BaseSequencer: new (ctx: SequencerContext) => Sequencer & { ctx: SequencerContext } };
  if (!shuffled) return BaseSequencer;
  const shuffle = ((await load('@vitest/utils/helpers')).shuffle ?? (await load('@vitest/utils')).shuffle) as Shuffle | undefined;
  if (shuffle === undefined) throw new Error('variance-authority: this Vitest names no `shuffle` in `@vitest/utils`, so a shuffled run cannot order its files as Vitest would');
  return class RandomSequencer extends BaseSequencer {
    override async sort<T extends Spec>(files: T[]): Promise<T[]> {
      return shuffle(files, this.ctx.config.sequence?.seed);
    }
  };
}

/** Imports a module of Vitest's own as the project's Vitest resolves it, or as this package does when that fails. */
function vitestImport(configRoot: string): (specifier: string) => Promise<Record<string, unknown>> {
  let from: NodeJS.Require | undefined;
  try {
    from = createRequire(createRequire(resolve(configRoot, 'package.json')).resolve('vitest/node'));
  } catch {
    from = undefined;
  }
  return (specifier) => from === undefined ? import(specifier) : import(pathToFileURL(from.resolve(specifier)).href);
}
