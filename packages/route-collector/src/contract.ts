import type { CallSiteResolver, SourceIndex } from '@variance-authority/core/attribute';
import type {
  RenderDocument,
  SemanticSnapshot,
  SubjectRef,
  Viewport,
} from '@variance-authority/core/format';

/**
 * The contract a collector satisfies, restated here rather than imported.
 *
 * The CLI declares the same shapes and this package does not depend on it — a
 * surface package pulling in the binary would put a config parser, a docket and
 * six commands into an adopter's dependency tree to describe four values
 * (ADR-0024). What keeps the two copies honest is that the CLI imports *this*
 * collector in its own tests, so a drift between them fails a build rather than a
 * run.
 */

export interface CollectorConfig {
  readonly viewport: Viewport;
  readonly fonts?: readonly string[];
  /**
   * Subtrees this project excludes, from `config.ignore` (spec 0024).
   *
   * Only the two fields a page needs: a rule id to record the mark under, and a
   * selector to find it with. Everything else about a rule — its reason, its
   * expiry, the bands it narrows to — is decided after collection, where a clock
   * and the whole run's diffs are available and a browser is not.
   */
  readonly ignore?: readonly {
    readonly id: string;
    readonly select?: string;
    /**
     * Subjects the rule names. Read here to decide what to send, and never sent.
     *
     * A page can resolve a selector and cannot know which subject it is one of,
     * so scoping has to happen on this side of the boundary. Without it a rule
     * written for one route marks its element in every subject that renders the
     * same shared layout, and a real regression inside that element is absorbed
     * everywhere — an ignore silencing more than it says, which is the one thing
     * the mechanism must not do.
     */
    readonly subjects?: readonly string[];

    /** Tags the subject must carry. Read here to decide what to send, never sent. */
    readonly tags?: readonly string[];
  }[];

  /**
   * Images to serve as nothing, from `config.blank`.
   *
   * Handed to the driver rather than to the page, because it is enforced on the
   * wire — before a byte is decoded, and therefore before the layout it would
   * have participated in exists. Not scoped by subject, and it cannot be: a
   * request carries no idea which subject will end up using it, which is the
   * same reason the asset map is per page rather than per subject.
   */
  readonly blank?: readonly {
    readonly id: string;
    readonly url?: string;
    readonly minPixels?: number;
    readonly maxPixels?: number;
  }[];
}

export interface PlannedSubject {
  readonly subject: SubjectRef;
  readonly viewport?: Viewport;

  /**
   * What the subject declares itself to be.
   *
   * Present for a Storybook plan, where the built index carries a story's tags.
   * A route plan has no artifact to read one from, so it is absent — and absent
   * means *undeclared*, never *no tags*: a rule scoped by tag simply does not
   * apply here, rather than applying to everything.
   */
  readonly tags?: readonly string[];
}

export interface Plan {
  readonly subjects: readonly PlannedSubject[];
  readonly notObserved: readonly unknown[];
  readonly warnings: readonly string[];
}

export type Collected =
  | {
      readonly ok: true;
      readonly document: RenderDocument;
      readonly snapshot?: SemanticSnapshot;
      readonly source?: SourceIndex;

      /**
       * Stabilization tricks applied to the page before this subject was read.
       *
       * Reported so a run can say what it did to somebody else's page. The
       * digest of the same list is in the environment key, which is what makes a
       * differently-stabilized baseline `incomparable`; this is the half a
       * person reads.
       */
      readonly stabilization?: readonly string[];
    }
  | { readonly ok: false; readonly because: string };

export interface CollectorContext {
  readonly config: CollectorConfig;
  /** Computed by the run from `subjects.ids`. Returned unchanged. */
  readonly plan?: Plan;
}

export interface Collector {
  plan(): Promise<Plan>;
  collect(subject: PlannedSubject): Promise<Collected>;

  /**
   * The frames a snapshot carries, spent on demand.
   *
   * Present when the collector drives a browser, because resolving a frame means
   * fetching the module it names and the page is the only place that request is
   * already correct. Absent otherwise, and absence is not a degradation: it means
   * either that nothing captured frames, or that the run has no live page to
   * fetch through — and both are a report without call sites rather than a
   * report that is wrong.
   *
   * Handed to `locateSites` with the few nodes a region or a finding names. The
   * resolver is per collector rather than per subject: the cache is what makes
   * this bounded, and a suite's subjects share their modules.
   */
  readonly callSites?: CallSiteResolver;

  /**
   * Collect this subject again, in a world nothing else has touched.
   *
   * A route run navigates per subject, so the shared thing is not a document —
   * it is the browser and the origin beneath it. Cookies, `localStorage`,
   * `sessionStorage`, IndexedDB, the HTTP cache and any registered service
   * worker all survive a navigation, and a route whose render depends on one of
   * them renders differently because another route ran first. A comparison
   * cannot tell that apart from a regression, because both arrive as "the pixels
   * moved".
   *
   * One clean collection settles it. If the difference is gone with nothing else
   * in the world, the run reports `order-dependent` rather than asking anybody to
   * accept it.
   *
   * Optional in the contract the CLI declares, because a collector with no clean
   * world to offer must say so rather than have silence read as "nothing
   * leaked". This collector implements it, at a browser launch per subject —
   * which is why the run only spends it on subjects it already called `changed`,
   * up to `alone.limit`.
   */
  collectAlone?(subject: PlannedSubject): Promise<Collected>;

  close(): Promise<void>;
}
