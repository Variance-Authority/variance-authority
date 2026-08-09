import type { HistoryStore } from '@variance-authority/history';
import type { PngDecoder } from '@variance-authority/png';
import type { RasterStore, Renderer } from '@variance-authority/raster';
import type { Config } from '../config.js';
import type { Collector } from './collector.js';
import type { RunIdentity } from './history.js';
import type { CliObservationRecord, CliRunReport, NotObserved } from './run-report.js';

/**
 * What a run is handed, and what one subject's decision is handed.
 *
 * Four shapes, in their own file because the modules that *consume* them —
 * `images.ts`, `alone.ts`, `observe-one.ts` — would otherwise have to import the
 * loop that constructs them, and a comparison helper reaching back into
 * `run.ts` for a type is the shape that later becomes a real cycle.
 *
 * Nothing here has behaviour. What it has is the injection: a clock, a writer,
 * and a renderer factory arrive as fields rather than as imports, which is what
 * makes the whole run testable with no disk, no browser and no hidden clock, and
 * therefore what makes the claims in `run.ts` assertions rather than prose.
 */

export interface RunDeps {
  readonly collector: Collector;
  readonly store: RasterStore;
  /**
   * Opened once, on first need.
   *
   * The laziness is not about the launch. A durable lookup is scoped by renderer
   * identity, so the identity has to be known before the first `find`, and this
   * is therefore called at the start of any durable run — 205ms, once (journal
   * 0007). What it saves is the per-subject rasterization, which is the cost that
   * scales with the suite.
   */
  renderer(): Promise<Renderer>;
  /** ISO 8601. Injected because nothing in a report should come from a hidden clock. */
  now(): string;
  /** Writes candidate images. Injected so the run loop is testable with no disk. */
  writeArtifact(path: string, bytes: Buffer): Promise<void>;
  writeReport(path: string, report: CliRunReport): Promise<void>;

  /**
   * Where this run's observations and instabilities are written down.
   *
   * Injected rather than constructed, and absent when the operator configured no
   * `history`. The alternative — a store built inside the loop — would put a
   * socket in the one function that is supposed to be testable with no disk, no
   * browser and no network, and every test would have to defeat it.
   *
   * Absent is not `createAbsentStore()`. The absent store answers questions, and
   * what the run needs to know first is whether to *compute* anything at all: a
   * run with no history configured must not hash three hundred snapshots to hand
   * them to something that discards them.
   */
  readonly history?: HistoryStore;
}

export interface RunOptions {
  readonly config: Config;
  readonly deps: RunDeps;
  /** `--intent`, overriding the config's. */
  readonly intent?: string;
  /** `--subjects`. Non-matching subjects are listed as excluded, never dropped. */
  readonly subjects?: string;

  /**
   * `--flakes`: read **every** subject twice, not only the ones that changed.
   *
   * The sweep. A run's ordinary second reading fires only on a subject somebody
   * was going to have to review anyway, which is what makes it free — and also
   * means the first time a flake is seen, it has already cost a red build. This
   * mode buys the other half: it finds a subject that agrees with its baseline
   * today and disagrees with *itself*, which is the same defect one run earlier.
   *
   * It is a mode rather than a default because it doubles the collection cost of
   * a green run, and a nightly sweep is the shape that pays for itself. The
   * `alone.limit` budget does not apply to it: an operator who asked for the
   * sweep asked for the whole suite, and a silently partial answer that looks
   * complete is the failure this tool exists to refuse.
   */
  readonly flakes?: boolean;

  /**
   * Which run this is, and at which commit — `--run` and `--commit`, or the CI
   * environment's own pair.
   *
   * Only a history record needs it, and only a configured one: absent means
   * nothing is written and the report says so, rather than an id being invented.
   * An invented id is worse than no record, because it cannot be joined back to
   * anything that shipped and it silently becomes a denominator.
   */
  readonly identity?: RunIdentity;
}

export interface ObserveContext {
  readonly config: Config;
  readonly deps: RunDeps;
  readonly renderer: Renderer;
  /**
   * How many more subjects may be re-collected alone.
   *
   * Mutable and shared across the loop, because the budget is a property of the
   * *run* rather than of a subject: twenty changed subjects should spend twenty,
   * not twenty each. Passed rather than closed over so `observeOne` stays
   * callable from a test with a budget of its own.
   */
  readonly budget: { remaining: number };
  /** `--flakes`: read every subject twice, outside the budget. See `RunOptions`. */
  readonly sweep?: boolean;
  /** Absent means `pngjs`. See `decoderFor`. */
  readonly decoder?: PngDecoder;
}

export type Outcome =
  | {
      readonly kind: 'observed';
      readonly record: CliObservationRecord;
      /**
       * Stabilization tricks the collector applied to the page for this subject.
       *
       * On the outcome rather than on the record, because it is almost always
       * the same list for every subject in a run and a per-subject copy would be
       * three hundred identical lines in an artifact people already find long.
       * The run folds them into one set and states it once.
       */
      readonly stabilization?: readonly string[];
    }
  | { readonly kind: 'not-observed'; readonly entry: NotObserved };
