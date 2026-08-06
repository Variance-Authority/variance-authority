import type { PngDecoder } from '@variance-authority/png';
import type { RasterStore, Renderer } from '@variance-authority/raster';
import type { Config } from '../config.js';
import type { Collector } from './collector.js';
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
}

export interface RunOptions {
  readonly config: Config;
  readonly deps: RunDeps;
  /** `--intent`, overriding the config's. */
  readonly intent?: string;
  /** `--subjects`. Non-matching subjects are listed as excluded, never dropped. */
  readonly subjects?: string;
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
