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
 */

// compass: variance-authority.reach

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectPath } from './instrumented-modules.js';
import { selectedLines, type SuiteSelection } from './suite-selection.js';

/** Marks a sequencer that already selects, so a second wrap is the first one. */
const SELECTING = Symbol.for('variance-authority:selecting-sequencer');

/** The part of Vitest's context a sequencer is constructed with that this one reads. */
export interface SequencerContext {
  readonly config: {
    readonly root?: string;
    readonly watch?: boolean;
    readonly shard?: unknown;
    readonly sequence?: { readonly shuffle?: unknown };
  };
  readonly state?: { readonly getPaths?: () => readonly string[] };
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
  /** Read once, the first time a run asks. */
  readonly selection: () => Promise<SuiteSelection>;
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
 * A sequencer class that drops `selection().skip` and hands the rest to `own`,
 * or to the sequencer Vitest would have picked when the project named none.
 */
export function selectingSequencer(own: SequencerClass | undefined, options: SelectingOptions): SequencerClass {
  if (own !== undefined && (own as unknown as Record<symbol, unknown>)[SELECTING] === true) return own;
  const say = options.say ?? ((line: string) => process.stderr.write(`${line}\n`));
  let asked: Promise<SuiteSelection> | undefined;
  let said = false;

  class Selecting implements Sequencer {
    static readonly [SELECTING] = true;
    readonly #ctx: SequencerContext;
    #inner: Promise<Sequencer> | undefined;

    constructor(ctx: SequencerContext) {
      this.#ctx = ctx;
    }

    async shard<T extends Spec>(files: T[]): Promise<T[]> {
      const kept = await this.#kept(files);
      return (await this.#sequencer()).shard(kept);
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
      return files.filter((file) => !selection.skip.has(name(moduleOf(file))));
    }
  }
  return Selecting;
}

function moduleOf(spec: Spec): string {
  return spec.moduleId ?? spec[1] ?? '';
}

/** Whether Vitest would have shuffled files, by the rule its config resolution applies. */
function filesShuffled(written: unknown, ctx: SequencerContext): boolean {
  if (typeof written === 'object' && written !== null) return (written as { files?: unknown }).files === true;
  return ctx.config.sequence?.shuffle === true;
}

/**
 * Vitest's own `RandomSequencer` or `BaseSequencer`, from the Vitest the
 * project resolves: the one a sequencer would have been without this wrap.
 */
async function vitestSequencer(configRoot: string, shuffled: boolean): Promise<SequencerClass> {
  let node: { BaseSequencer: SequencerClass; RandomSequencer: SequencerClass };
  try {
    const file = createRequire(resolve(configRoot, 'package.json')).resolve('vitest/node');
    node = await import(pathToFileURL(file).href);
  } catch {
    node = (await import('vitest/node')) as unknown as typeof node;
  }
  return shuffled ? node.RandomSequencer : node.BaseSequencer;
}
