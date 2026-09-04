import type { StoryExecutionOptions } from './execution.js';
import type { SourceScan } from './source.js';

/**
 * What the operator declares, and what each declaration is load-bearing for.
 *
 * Split from `index.ts` so the shape an adopter reads is not buried in the
 * machinery that consumes it: every field here is a fact only the project
 * holds, and the reason each one could not be defaulted is the documentation.
 */

export interface StorybookCollectorOptions {
  /**
   * Story id to the selector that says it is ready.
   *
   * Per story, not per project, and that is the design rather than an
   * ergonomics gap. A button needs no marker and demanding one from it would
   * time out every story to solve a problem one of them has. A story that
   * declares a marker and never attaches it times out saying which selector it
   * waited for — there is no fallback, because falling back is how you
   * photograph a spinner and call it a component.
   */
  readonly ready?: Readonly<Record<string, string>>;

  /**
   * Where the components live, for `file:line` attribution.
   *
   * Omitted, the report names components and no files — which is still ahead of
   * every product in the category and is not what this is for.
   */
  readonly source?: SourceScan;

  /**
   * A Storybook that is already served, e.g. `http://localhost:6006`.
   *
   * Preferred when it exists: then nothing here has an opinion about how the
   * build is hosted. Omitted, the directory holding `subjects.index` is served
   * on a loopback port for the life of the run.
   */
  readonly baseUrl?: string;

  /** Defaults to `true`. Set false to watch a run by hand. */
  readonly headless?: boolean;

  /**
   * Watch the wire: hash asset bodies into the environment key, and serve
   * animated GIFs as their first frame. Defaults to `true`.
   *
   * On, this is what closes a false `unchanged` that a page cannot see about
   * itself. A logo re-exported at the same URL is the same markup, the same CSS
   * and the same document — so every tier settles, and the run reports that
   * nothing moved while the image on the page is different bytes. Only the party
   * that saw the response knows otherwise.
   *
   * The assets are narrowed **per story** before they reach a key, from the URLs
   * that story's own subtree references (`assetsFor`). Without that, a run that
   * reads three hundred stories out of one page would give story 200 a key that
   * depends on which stories ran before it, and sharding the suite would change
   * every baseline's identity.
   *
   * Off is a position for a build whose asset URLs already contain their own
   * content hash: the URL is then the identity, and hashing the bytes again buys
   * a read and nothing else.
   */
  readonly network?: boolean;

  /**
   * Hash the bytes the wire served into each story's key. Defaults to `true`,
   * and is read only while `network` is on.
   *
   * Separate from `network` because the observation does three things and this
   * is one of them: it also serves animated GIFs as their first frame and
   * applies the blanking rules. A build whose asset URLs already contain their
   * own content hash wants the redundant digest gone and the other two kept, and
   * `network: false` is the setting that takes all three.
   */
  readonly hashAssets?: boolean;

  /**
   * Read the framework wiring of each node — props, context, hook cells, keys.
   * Defaults to `true`.
   *
   * On because a run over a Storybook has already paid for the fiber walk, and
   * wiring is the dimension that says *a prop moved* about a story whose markup
   * did not. It is a band of its own rather than part of `rendering`, so a story
   * that never had it read still hashes to what it hashed before.
   *
   * Off is for a preview this project's adapter cannot read anyway — a Storybook
   * whose renderer is not React — where the walk buys an absent band at the
   * price of visiting every node in every story.
   */
  readonly wiring?: boolean;

  /**
   * Read the held state behind each node — the digests of the application values
   * a component was rendered with. Defaults to `false`.
   *
   * Opt-in rather than symmetric with `wiring`, because it changes what a
   * `structureHash` is: a node carrying a holding suppresses the inert-wrapper
   * collapse, so the same story read with holdings and without produces two
   * different structures. Both sides of a comparison must therefore be read the
   * same way, which is a decision a project makes rather than one a default
   * makes for it.
   */
  readonly holdings?: boolean;

  /** Overrides the roots the story is read from. Tightest first. */
  readonly roots?: readonly string[];

  /** Milliseconds for Storybook or a declared marker to report readiness. Defaults to 15000. */
  readonly readyTimeoutMs?: number;

  /**
   * Milliseconds to wait for a story's Suspense boundaries. Defaults to 5000.
   *
   * Paid only by stories that are actually waiting: a subtree with no boundary
   * in it returns on the first read. `0` turns the wait off and keeps the
   * reading, which is a position for a project whose readiness markers already
   * cover its data — the refusal below still fires, so the boundary is reported
   * rather than photographed.
   */
  readonly suspenseTimeoutMs?: number;

  /**
   * Record what each story executed, into the shared test-selection index.
   *
   * Off unless asked for, and it asks something of the build rather than of this
   * package: the Storybook preview has to have been built with
   * `testSelectionProbes()` from `@variance-authority/sense/journal`, which is
   * what puts probes in the source and writes down what their ordinals mean.
   * Without it a run records nothing and says so on stderr — the next selection
   * then runs everything, which is the direction every uncertainty here
   * resolves.
   *
   * A story is its own owner in that index. Storybook is an execution surface
   * this tool drives one subject at a time, so unlike a test runner — where the
   * file is the smallest thing a runner can be asked to execute — the crossings
   * of one story belong to that story and to nothing else.
   */
  readonly tests?: boolean | StoryExecutionOptions;

  /**
   * Stories whose *loading* state is the subject, as id globs.
   *
   * The escape hatch, and the only one. A story left showing its fallback is
   * otherwise refused, because a subject that records a skeleton on a slow
   * machine and a component on a fast one is a flake nobody wrote — so a
   * skeleton somebody *does* want a baseline over has to be said out loud.
   *
   * Declared here rather than sensed, and checked in both directions: a story
   * named by this that turns out to settle is refused too. A declaration that
   * outlived its subject is the same nondeterminism arriving from the other side.
   *
   * Matched against the story id and the subject id both, so
   * `case-surface--feed` and `story:case-surface--feed` name the same story —
   * `ready` above is keyed by the first.
   */
  readonly loading?: readonly string[];
}
