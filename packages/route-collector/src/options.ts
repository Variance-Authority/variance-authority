import type { RouteExecutionOptions } from './execution.js';
import type { SourceScan } from './source.js';

/**
 * What the operator declares, and what each declaration is load-bearing for.
 *
 * Split from `index.ts` so the shape an adopter reads is not buried in the
 * machinery that consumes it: every field here is a fact only the project
 * holds, and the reason each one could not be defaulted is the documentation.
 */

export interface RouteCollectorOptions {
  /**
   * Subject id to the URL that serves it.
   *
   * The ids must be the ones in `subjects.ids`, because the run plans from the
   * config and collects from here — a route with no id is never visited, and an
   * id with no route is reported as a subject that could not be collected rather
   * than silently dropped.
   */
  readonly routes?: Readonly<Record<string, string>>;

  /**
   * A sitemap to take the routes from, instead of writing them out.
   *
   * The no-code on-ramp: a page the application already publishes is watched
   * without a second commit. Requires `subjects.kind: "collector"`, because the
   * subject list is then discovered rather than declared — and that trade is the
   * operator's to make, since a page dropped from the sitemap stops being watched
   * without a diff anybody approves. The run still names the baseline it is left
   * holding (ADR-0063); what discovery gives up is the review, not the notice. Mutually exclusive with `routes`, `directory` and each other; a
   * config naming two is asking two lists to be one, and quietly merging them is
   * how a run watches a page nobody listed.
   *
   * Every entry is visited on this sitemap's origin, with its own path and
   * query: a site writes its sitemap for where it is published, and the copy a
   * local server answers still names production.
   *
   * A sitemap *index* is not followed. Fetching what a fetched document points at
   * is a crawler, and a crawler is a different product with a different failure
   * mode.
   *
   * A listed page that is not reviewed as pixels leaves the run from the page
   * itself: `data-variance-exclude="<reason>"` on any element. The page is
   * reported as `excluded` with that reason, and nothing is read from it.
   */
  readonly sitemap?: string;

  /**
   * A built directory to serve and take the pages from.
   *
   * The other no-code on-ramp: point at what a build produced and get a subject
   * per `.html` file, with nothing written down. Requires
   * `subjects.kind: "collector"`, and carries the same trade every discovered
   * plan does — a page the build stops producing stops being watched.
   *
   * Prefer `routes` or `sitemap` against a **real server** when there is one. A
   * static file server answers what is on disk; the thing that will be deployed
   * answers with its redirects, its headers and its rewrites, and those are part
   * of the page.
   */
  readonly directory?: string;

  /**
   * Viewport widths to read every route at. Defaults to the run's one viewport.
   *
   * The shape every Percy suite is written in — `widths: [375, 1280]` — and the
   * thing a single-viewport tool cannot express: a page has a layout per
   * breakpoint, and a suite that only reads the desktop one is not watching the
   * other two. It is a *plan* concern rather than a capture one, because each
   * width is genuinely its own subject: its own baseline, its own verdict, its
   * own place in the report. Reading one page at three widths and calling it one
   * result would hide two of the three answers behind whichever failed first.
   *
   * Each becomes `<id>@<width>` — a suffix rather than a field, so a baseline
   * cannot collide, an `ignore` or `sensitivity` rule matching `route/*` still
   * matches all of them, and `--subjects 'route/home@375'` selects exactly one.
   * The height is the run's; only the width moves, because a viewport height
   * bounds nothing when the subject is the page.
   */
  readonly widths?: readonly number[];

  /**
   * The subject's root, tightest first. Defaults to `body`.
   *
   * Bounding it is what keeps a shared header out of every page's comparison,
   * and what makes pruning affordable — the 1010-rules-to-1 ratio is a property
   * of a bounded subject. `body` is the caller saying the page is the subject.
   */
  readonly roots?: readonly string[];

  /**
   * Subject id to a selector that says the page is ready.
   *
   * Declared, never defaulted. `load` fires when the document is parsed, which
   * for anything that fetches after mount is *before the page exists* — and a
   * marker we chose for you would be a guess about every route to solve a
   * problem some of them have. A route that declares a marker and never
   * attaches it times out saying which selector it waited for; falling back is
   * how you photograph a spinner.
   *
   * A key is a subject id or a glob over them, so a framework that attaches the
   * same marker to every page it renders is one entry rather than five hundred
   * that drift apart. A literal key wins over a pattern, and between two
   * patterns the first declared wins.
   */
  readonly ready?: Readonly<Record<string, string>>;

  /** Where the components live, for `file:line` attribution. */
  readonly source?: SourceScan;

  /** Milliseconds to wait for a declared ready selector. Defaults to 10000. */
  readonly readyTimeoutMs?: number;

  /** Defaults to `true`. Set false to watch a run by hand. */
  readonly headless?: boolean;

  /**
   * Watch what the page is served. Defaults to `true`.
   *
   * On, this is where `EnvironmentInputs.assets` comes from — a field that has
   * existed since the format did and was filled by nobody, leaving an image
   * swapped under the same URL as a false `unchanged`. It is also where animated
   * GIFs are frozen, which no CSS can reach.
   *
   * Off is a position for a page whose assets are content-addressed URLs
   * already, or a run that cannot afford routing's loss of the browser's HTTP
   * cache. The cost is stated in `@variance-authority/playwright`'s
   * `network.ts`; the assets map is then empty and says so by being empty.
   */
  readonly network?: boolean;

  /**
   * Hash the bytes the wire served into `EnvironmentInputs.assets`. Defaults to
   * `true`, and is read only while `network` is on.
   *
   * Separate from `network` because the observation does four things and this is
   * one of them: it also freezes animated GIFs, serves the blanking rules, and
   * retains the bytes a `portable` document ships. A build whose asset URLs
   * already contain their own content hash wants the redundant digest gone and
   * the other three kept, and `network: false` is the setting that takes all
   * four.
   */
  readonly hashAssets?: boolean;

  /**
   * Emit documents that carry the bytes they need, not just references to them.
   * Defaults to `false`.
   *
   * On, each collected document is resource-closed: a renderer paints it with
   * every network channel blocked, which is what lets the pixels be made on a
   * machine that has no route to the asset origin — a pinned renderer, a queue,
   * another architecture. Off, a document names its assets by digest, which is
   * enough to notice one changed and not enough to reproduce it elsewhere.
   *
   * Requires `network` — the bytes come from the wire, because the wire is the
   * only party that saw them. A resource that cannot be closed fails its route
   * and names itself rather than shipping a document that claims more than it
   * carries; see ADR-0044.
   *
   * The cost is size. A document grows by its assets, and a report holding a
   * hundred of them holds their bytes too.
   */
  readonly portable?: boolean;

  /**
   * Read the framework wiring of each node — props, context, hook cells, keys.
   * Defaults to `true`.
   *
   * On because a run that has a React adapter in it already paid for the fiber
   * walk, and wiring is the dimension that says *a prop moved* about a node whose
   * markup did not. It is a band of its own rather than part of `rendering`, so
   * a subject that never had it read still hashes to what it hashed before.
   *
   * Off is for a page this project's adapter cannot read anyway — a non-React
   * host mounted into the same route table — where the walk buys an absent band
   * at the price of visiting every node.
   */
  readonly wiring?: boolean;

  /**
   * Read the held state behind each node — the digests of the application values
   * a component was rendered with. Defaults to `false`.
   *
   * Opt-in rather than symmetric with `wiring`, because it changes what a
   * `structureHash` is: a node carrying a holding suppresses the inert-wrapper
   * collapse, so the same page read with holdings and without produces two
   * different structures. Both sides of a comparison must therefore be read the
   * same way, which is a decision a project makes rather than one a default
   * makes for it.
   */
  readonly holdings?: boolean;

  /**
   * Stabilization tricks to hold each page still with, by id. Defaults to
   * `COLLECT_RECIPE`, which is almost certainly what you want.
   *
   * The knob exists for two callers. One is a page whose own determinism story
   * is better than ours — a suite that already freezes its own clock and its own
   * animations, where a second `!important` sheet is damage buying nothing. The
   * other is this repository's own test for what happens *without* it, which
   * needs to be able to ask for nothing and get nothing.
   *
   * `[]` means observed untouched, and is recorded as such: the environment key
   * carries no stabilization digest, so an untouched baseline and a held-still
   * one are two baselines rather than a diff nobody can explain.
   */
  readonly stabilize?: readonly string[];

  /**
   * The instant `Date` reads on every page, as an ISO 8601 instant with its
   * zone. Defaults to `DEFAULT_NOW`, noon UTC on 15 June 2024.
   *
   * Applied by the `freeze-clock` trick, so a `stabilize` list without it
   * leaves the clock running and this unused. A time with no zone is refused
   * before a browser opens: it names a different instant on every machine.
   */
  readonly now?: string;

  /**
   * Milliseconds to wait for a route's Suspense boundaries. Defaults to 5000.
   *
   * Separate from `readyTimeoutMs` because it answers a separate question. A
   * ready selector is a promise the *page* makes about itself; a boundary is
   * React's own record of work that has not landed, and a route can satisfy the
   * first while a panel inside it is still a skeleton. Paid only by pages that
   * are actually waiting: a subtree with no boundary returns on the first read.
   */
  readonly suspenseTimeoutMs?: number;

  /**
   * Record what each page executed and showed, into the shared test-selection
   * index, so a later `--since` run photographs only the pages an edit reached.
   *
   * Off unless asked for. What it records comes from three places, and each
   * asks something of the application rather than of this package:
   *
   * - the browser's code, when the client was built with
   *   `testSelectionProbes()` from `@variance-authority/sense/journal`;
   * - the server's code, from each head named in `heads`: a service started
   *   with `VARIANCE_AUTHORITY_JOURNEYS=1` that runs `collectJourneys()` from
   *   `@variance-authority/sense/journey`. Every page is read under a journey of
   *   its own, carried to the server as a cookie;
   * - the files a page showed, from the `data-variance-reads` attribute on its
   *   root and inside it — repository paths, space-separated — which
   *   `@variance-authority/reads` spreads.
   *
   * A page is its own owner in that index: its crossings and its files belong
   * to it and to nothing else.
   */
  readonly tests?: boolean | RouteExecutionOptions;

  /**
   * Subjects whose *loading* state is the subject, as id globs.
   *
   * The escape hatch, and the only one. A route left showing a fallback is
   * otherwise refused, because a subject that records a skeleton on a slow
   * machine and content on a fast one is a flake nobody wrote — so a skeleton
   * somebody *does* want a baseline over has to be said out loud.
   *
   * Checked in both directions: a subject named here that turns out to settle is
   * refused too. A declaration that outlived its subject is the same
   * nondeterminism arriving from the other side.
   */
  readonly loading?: readonly string[];
}
