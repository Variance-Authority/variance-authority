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
 * A run the selection leaves nothing to run passes: the change reached none of
 * its files, so none of them can fail. Vitest 2 decides "no test files" before
 * it calls a sequencer, so it never sees the files dropped here. Vitest 3 and 4
 * decide after, when the run ends, and fail a run that ran no file unless
 * `passWithNoTests` is set, so the sequencer sets it on the run's own config
 * when what it hands back is empty and the selection dropped any file. A shard
 * the selection's files all landed outside is the same answer. When nothing
 * was dropped, an empty run is the runner's, and the project's option stands.
 * The line before the run says `selected none of M`.
 *
 * Under `--shard k/n` the files left are placed whole by the time the suite's
 * record holds for each, or by file count when it holds none, rather than by
 * Vitest's own cut: every shard places every file and keeps its own part
 * (`shard-placement.ts`), and stderr says which part, by what, and what it is
 * expected to take. The project's sequencer never cuts the shard. A shard the
 * placement leaves empty passes, as one the selection leaves empty does.
 */

// compass: variance-authority.reach

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cutOf, type CaseCut } from './case-cut.js';
import { projectPath } from './instrumented-modules.js';
import { shardOf, type ShardAsked } from './shard-placement.js';
import { kept, selectedLines, type SuiteSelection, type SuiteTimes } from './suite-selection.js';

/** Marks a sequencer that already selects, so a second wrap is the first one. */
const SELECTING = Symbol.for('variance-authority:selecting-sequencer');
/** On a selecting sequencer: the seed a run under it shuffles files with, or `undefined` when it shuffles none. */
const SEED = Symbol.for('variance-authority:selecting-seed');
/** Marks a logger whose banner already names the seed, so a second hook is the first one. */
const BANNER = Symbol.for('variance-authority:seed-banner');
/** On a selecting sequencer: reads the command line the run was started with, once; see {@link readCommandLine}. */
const COMMAND_LINE = Symbol.for('variance-authority:selecting-command-line');

/** The part of Vitest's context a sequencer is constructed with that this one reads. */
export interface SequencerContext {
  readonly config: {
    readonly root?: string;
    readonly watch?: boolean;
    readonly shard?: unknown;
    readonly sequence?: { readonly shuffle?: unknown; seed?: number };
    /** Read by Vitest 3 and 4 when the run ends; set here when the selection leaves the run nothing. */
    passWithNoTests?: boolean;
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
  let reading: Promise<void> | undefined;
  let commandLine: CommandLine | undefined;

  class Selecting implements Sequencer {
    static readonly [SELECTING] = true;
    readonly #ctx: SequencerContext;
    #inner: Promise<Sequencer> | undefined;
    /** Has the selection dropped any file handed to this sequencer, through `shard` or `sort`. */
    #dropped = false;

    /**
     * What Vitest does for its own `RandomSequencer` only: a seed when none was
     * given, on the config its workers are handed. Asked by the banner, which
     * prints before any sequencer is made, and by each sequencer.
     */
    static [SEED](ctx: SequencerContext): number | undefined {
      if (own !== undefined || ctx.config.sequence === undefined || !filesShuffled(options.shuffle, ctx, commandLine)) return undefined;
      return ctx.config.sequence.seed ??= Date.now();
    }

    static [COMMAND_LINE](): Promise<void> {
      return reading ??= commandLineOf(options.configRoot).then((read) => {
        commandLine = read;
      });
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
      if (shard === undefined) return (await this.#sequencer()).shard(kept);
      timed ??= options.times?.() ?? Promise.resolve({ unread: 'no record was named to read them from' });
      const part = shardOf(kept.map((file) => projectPath(options.root, moduleOf(file))), shard, await timed);
      if (!placed) say(part.line);
      placed = true;
      if (part.take.length === 0 && kept.length > 0) this.#dropped = true;
      return part.take.map((at) => kept[at]!);
    }

    async sort<T extends Spec>(files: T[]): Promise<T[]> {
      const kept = await this.#kept(files);
      const sorted = await (await this.#sequencer()).sort(kept);
      // Vitest sorts after it shards, so this is what the run is left with.
      if (sorted.length === 0 && this.#dropped) this.#ctx.config.passWithNoTests = true;
      return sorted;
    }

    #sequencer(): Promise<Sequencer> {
      this.#inner ??= own === undefined
        ? vitestSequencer(options.configRoot, filesShuffled(options.shuffle, this.#ctx, commandLine)).then((Inner) => new Inner(this.#ctx))
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
      const runs = [...kept(selection, files, (file) => name(moduleOf(file)))];
      if (runs.length < files.length) this.#dropped = true;
      const cut = cutOf(selection, runs.map(moduleOf), options.root);
      if (cut.size > 0) options.cut?.(cut);
      return runs;
    }
  }
  return Selecting;
}

/**
 * Has a selecting sequencer read the command line its run was started with,
 * where Vitest 2 hands it no other way.
 *
 * Vitest 2 parses its command line and hands what it parsed to its own plugin
 * alone, which merges it over the configuration file and resolves the result:
 * `--sequence.shuffle.files` picks the sequencer there, and the resolved config
 * keeps only `tests`. A sequencer of the project's own, which this one is, is
 * never told which. The command line is the one source left, so it is read
 * again, by the parser of the project's Vitest, `parseCLI` from `vitest/node`.
 *
 * Importing it is asynchronous and the seed is asked for synchronously, so this
 * runs from a Vite `config` hook, which Vite awaits before Vitest prints its
 * banner or makes a sequencer.
 */
export async function readCommandLine(sequencer: unknown): Promise<void> {
  await (sequencer as { [COMMAND_LINE]?: () => Promise<void> } | undefined)?.[COMMAND_LINE]?.();
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

/** What the command line asked of `sequence`, as Vitest's own parser reads it. */
interface CommandLine {
  readonly shuffle?: unknown;
}

/**
 * Whether Vitest would have shuffled files, by the rule its config resolution
 * applies to `sequence.shuffle` once the command line is merged over the file:
 * an object's `files`, or the boolean.
 *
 * Vitest keeps only `tests` of an object after it picks its sequencer, so the
 * resolved config cannot tell `--sequence.shuffle.tests` from
 * `--sequence.shuffle`. From Vitest 3 the command line as parsed is on the
 * context, `_cliOptions`; Vitest 2 keeps it to itself, and it is read from
 * argv instead ({@link readCommandLine}). A run started from code under
 * Vitest 2 has neither, and the resolved value is read when the file wrote no
 * object.
 */
function filesShuffled(written: unknown, ctx: SequencerContext, commandLine: CommandLine | undefined): boolean {
  const asked = ctx._cliOptions?.sequence?.shuffle ?? commandLine?.shuffle;
  const shuffle = asked === undefined ? written : isObject(asked) && isObject(written) ? { ...written, ...asked } : asked;
  if (isObject(shuffle)) return shuffle.files === true;
  if (asked !== undefined) return asked === true;
  // FIXME: a Vitest 2 run started from code, or through a launcher that leaves
  // another script in argv[1], reads `--sequence.shuffle.files` as no shuffle
  // and `.tests` as a shuffle of files too, with no warning: Vitest has folded
  // them, and nothing else says which was asked.
  return ctx.config.sequence?.shuffle === true;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * `sequence` as the command line asked for it, read by the project's Vitest's
 * own parser, when this process is that Vitest's command line; `undefined` when
 * it is not, as under `startVitest`, whose options are not on argv.
 */
async function commandLineOf(configRoot: string): Promise<CommandLine | undefined> {
  const invoked = process.argv[1];
  const bin = vitestBin(configRoot);
  if (invoked === undefined || bin === undefined || !existsSync(invoked) || realpathSync(invoked) !== bin) return undefined;
  const { parseCLI } = await vitestImport(configRoot)('vitest/node') as {
    parseCLI: (argv: string[]) => { options: { sequence?: CommandLine } };
  };
  return { shuffle: parseCLI(['vitest', ...process.argv.slice(2)]).options.sequence?.shuffle };
}

/** The command-line script of the Vitest the project resolves, by the `bin` its manifest names, or `undefined` when it resolves none. */
function vitestBin(configRoot: string): string | undefined {
  let at: string;
  try {
    at = dirname(createRequire(resolve(configRoot, 'package.json')).resolve('vitest/node'));
  } catch {
    return undefined;
  }
  for (; at !== dirname(at); at = dirname(at)) {
    const file = resolve(at, 'package.json');
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown; bin?: unknown };
    if (manifest.name !== 'vitest') return undefined;
    const bin = typeof manifest.bin === 'string' ? manifest.bin : (manifest.bin as { vitest?: unknown } | undefined)?.vitest;
    return typeof bin === 'string' ? realpathSync(resolve(at, bin)) : undefined;
  }
  return undefined;
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
  const shuffle = ((await unexported(load('@vitest/utils/helpers')))?.shuffle ?? (await load('@vitest/utils')).shuffle) as Shuffle | undefined;
  if (shuffle === undefined) throw new Error('variance-authority: this Vitest names no `shuffle` in `@vitest/utils`, so a shuffled run cannot order its files as Vitest would');
  return class RandomSequencer extends BaseSequencer {
    override async sort<T extends Spec>(files: T[]): Promise<T[]> {
      return shuffle(files, this.ctx.config.sequence?.seed);
    }
  };
}

/** A module, or `undefined` when its package does not export that subpath, as `@vitest/utils` exports no `/helpers` before Vitest 4; any other failure is thrown. */
async function unexported(module: Promise<Record<string, unknown>>): Promise<Record<string, unknown> | undefined> {
  try {
    return await module;
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return undefined;
    throw error;
  }
}

/** Imports a module of Vitest's own as the project's Vitest resolves it, or as this package does when that fails. */
function vitestImport(configRoot: string): (specifier: string) => Promise<Record<string, unknown>> {
  let from: NodeJS.Require | undefined;
  try {
    from = createRequire(createRequire(resolve(configRoot, 'package.json')).resolve('vitest/node'));
  } catch {
    from = undefined;
  }
  return async (specifier) => from === undefined ? import(specifier) : import(pathToFileURL(from.resolve(specifier)).href);
}
