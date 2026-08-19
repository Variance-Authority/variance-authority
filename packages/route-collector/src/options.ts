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
   * silently. Mutually exclusive with `routes`; a config naming both is asking
   * two lists to be one, and quietly merging them is how a run watches a page
   * nobody listed ([`docs/selecting.md`](../../../docs/selecting.md)).
   *
   * A sitemap *index* is not followed. Fetching what a fetched document points at
   * is a crawler, and a crawler is a different product with a different failure
   * mode.
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
   * and what makes pruning affordable — the 1007-rules-to-1 ratio is a property
   * of a bounded subject. `body` is the caller saying the page is the subject.
   */
  readonly roots?: readonly string[];

  /**
   * Subject id to a selector that says the page is ready.
   *
   * Per route, not per project. `load` fires when the document is parsed, which
   * for anything that fetches after mount is *before the page exists* — and a
   * project-wide default would be a guess about every route to solve a problem
   * some of them have. A route that declares a marker and never attaches it
   * times out saying which selector it waited for; falling back is how you
   * photograph a spinner.
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
