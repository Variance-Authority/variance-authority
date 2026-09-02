import type { HistoryStore } from '@variance-authority/history';
import type { Relations, SourceIndex } from '@variance-authority/core';
import type { PngDecoder } from '@variance-authority/png';
import type { RasterStore, Renderer } from '@variance-authority/raster';
import type { ExecutionNarrowing } from '@variance-authority/sense/test-selection';
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

  /**
   * Build the component index from the configured directories.
   *
   * Injected because it walks a disk, and because `--since` is the one decision
   * in this command whose inputs are all outside it: a diff, a scan and a set of
   * baselines. With all three as values, every rule about what may be ruled out
   * is assertable with no repository and no browser.
   */
  scanSource?(dirs: readonly string[]): Promise<SourceIndex>;

  /**
   * Read what imports what, when the config asked for it.
   *
   * Injected beside `scanSource` and for the same reason, but it answers a
   * different question. The index says which file *declares* a component; this
   * says which files a component *rests on*, and that is the difference between
   * ruling out a changed token file and running the whole suite because of one.
   *
   * Absent when no graph was configured, and the selector states which of the two
   * rules it applied rather than leaving an operator to infer it from the count.
   */
  scanRelations?(dirs: readonly string[]): Promise<Relations>;

  /**
   * Directories a monorepo tool reports as affected, when one is configured.
   *
   * Seeds, not an answer — see `changes.ts`. Injected because it shells out to
   * `nx` or `turbo`, and a decision that shells out is a decision no test can
   * make claims about.
   */
  changedProjects?(base: string): Promise<readonly string[]>;

  /**
   * What the last run recorded entering, read against this diff.
   *
   * Injected for the same reason as `scanSource`: it opens a binary snapshot out
   * of a user cache, and a rule that reads a cache is a rule no test can make
   * claims about. `undefined` from it is *no journal*, which is the ordinary
   * answer for a build nobody put probes in — see [`journey.ts`](./journey.ts).
   */
  readJourney?(diff: string): Promise<ExecutionNarrowing | undefined>;
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

  /**
   * `--since <ref>`: observe only what this diff could have changed.
   *
   * The subjects it rules out are recorded as `excluded` with the sentence that
   * ruled them out — never dropped, because a subject missing from a report is a
   * subject nobody can ask about, and a selector that skipped one it should have
   * observed would produce a green run over an unwatched surface.
   */
  readonly since?: {
    /** Repository-relative paths the diff named. */
    readonly changed: readonly string[];
    /** The ref they were computed against, for the sentence. */
    readonly ref: string;

    /**
     * The diff itself, when one could be read — hunk headers and all.
     *
     * The paths answer *which files*; only the text answers *which lines*, and
     * the execution journal is indexed by line. Absent means the second ground
     * is not consulted, which narrows nothing.
     */
    readonly diff?: string;
  };

  /**
   * `--against <ref>`: explain the run by this diff, and narrow nothing.
   *
   * The same inputs as `since` and the opposite use of them. The walk says which
   * components the changed files can have moved and by which chain; crossed
   * against the verdicts, that is what turns a green subject the edit reached
   * into a finding, and a red subject nothing reached into a different one.
   *
   * Separate from `since` because narrowing is a cost decision and the
   * explanation is not, and a suite that cannot afford to skip subjects still
   * wants to know what its commit touched.
   */
  readonly against?: {
    readonly changed: readonly string[];
    readonly ref: string;
  };

  /**
   * Where the recorded execution index stands, and how far the tree is from it.
   *
   * Carried into the report and used for nothing else. A run narrows by `since`
   * or it does not; this is the coordinate a reader needs to judge that
   * decision, and resolving it here rather than in the run keeps a `git` call
   * out of the loop that observes subjects.
   */
  readonly index?: {
    readonly commit: string;
    readonly changed: number;
  };
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
