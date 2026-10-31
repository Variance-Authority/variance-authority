# @variance-authority/react

## 0.22.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.21.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.20.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.19.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.18.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.16.0

### Minor Changes

- dc7bb11: A route's components are read after React has hydrated it, and a route read before says so

  The route collector waited for hydration by watching the number of nodes
  carrying a fiber until it held still. A shell that suspends during hydration,
  on a promise read outside any `<Suspense>`, leaves fibers on the nodes rendered
  before it while the root is still uncommitted, so the wait ended there and the
  nodes past it came back with no component. On a loaded machine hydration
  finishes later, and a changed region named no component on one run and its
  component on the next.

  `awaitHydration` now reads React's record of each root on, above (up to the
  `Document`, for an app that hydrates the whole page), under and behind the
  subject, and waits until every one has committed. It returns `state`:
  `hydrated`, `hydrating` or `unrooted`, with `roots`, `pending` and `waitedMs`;
  `hydrated: boolean`, `fibers` and the `confirmations` option are gone.

  A route that stops hydrating with roots uncommitted is refused with their
  number, as a route still showing a Suspense fallback is:
  an effect that runs after hydration can paint a different image. A route with
  no React root is collected with a `react-root-absent` warning, so a region with
  no component says why. A run with `wiring: false` waits for nothing and says
  nothing.

  `resolveProvenance`, `wiringOf`, `holdingOf` and `componentFiberOf` read
  nothing off a node whose root has not committed. `resolveProvenance` returns
  the new `UNCOMMITTED` sentinel, reason `'uncommitted'`, for it, where it used to
  resolve the component of a render React had not committed. A root that
  committed `null` now reads as committed. An Eyes archive accepts a target
  recorded with that reason.
- 0d280fc: A route waits for hydration only while something can still finish it, and says when hydration changed it

  No clock decides how long a route waits for React to hydrate it: the route
  collector's `hydrationTimeoutMs` option and its two-second default are gone. React's own record decides: the collector
  waits while a root has a render React can do or a commit has effects React has
  not run, and, while React is stuck on a promise or has no root yet, for as long
  as anything the page requested is still arriving. A route React stops
  hydrating with nothing left arriving is refused at once, and the refusal says
  React had no work it could do and nothing was arriving to give it some. A slow
  route is waited for however long its responses take; a route held on a timer
  or on a promise nothing settles is refused without waiting.

  A route React never loaded on is read once no script it requested is still
  arriving, because only a script brings a renderer, so a long poll on such a page
  holds nothing: the route agent taps React's commits from before the page's first
  script, so it knows no React came, and its `react-root-absent` warning says
  React had not loaded and suggests `wiring: false`.

  A route that hydrates is now compared. The commit tap copies the markup in
  React's hydration commit, inert, and it is compared with the markup once React
  has nothing left to do, so a fast machine and a slow one give the same answer.
  A difference is reported as a `hydration-changed-markup` warning that quotes
  the markup at the hydration commit and the client's around the change, and
  names the components that committed after hydrating in the roots that reach
  the subject. The route is
  still read as it ended.

  `awaitHydration` takes `tap`, a `tapCommits` tap, and `outstanding(of)`, a
  function that resolves `true` once something the page requested has arrived and
  `false` when nothing is in flight. `of` is an `AwaitedArrival`: `'script'` when
  the tap saw no React load, so only scripts count, and `'any'` otherwise; without it, a root stuck on a promise is returned as
  `hydrating` at once. Its `timeoutMs` option is gone. Its settlement carries
  `loaded: false` when the tap saw no React load, and `changed`, a
  `MarkupChange`, when the markup moved. A `tapCommits` tap gains
  `effectsPending(root?)`, true while a commit's passive effects have not run on
  that root, or on any without one, and `hydration(root)`, a `RootHydration`: the
  markup copied at that root's hydration commit and the commits since. The tap
  reads React 18's passive-effect flags as React 18 sets them, so a React 18 root
  is no longer held busy by flags React 18 never clears. `detectReactVersion`
  reads the hook through the same reader as the tap.

  `watchArrivals(page)`, exported by the Playwright package, answers
  `outstanding` from the page's own requests, leaving out event streams,
  WebSockets and media, which are open by design, and fonts and images, which
  React waits on neither and the asset stages wait for and name. The Playwright harness installs
  it, and its page agent by init script before the first navigation, so the first
  document gets the agent ahead of its own scripts, as every later one already
  did. A page agent that fails while a request is still arriving fails naming
  that request, with Playwright's error as the cause.
- a68bd0f: A story names React objects by React's own word

  Add `@variance-authority/react/story` to a suite's setup files, and a story
  shows a context, a memo or an element it was handed as `react.context`,
  `react.memo` or `react.transitional.element`, read from the `$$typeof` mark
  React gave it. Without it, each is an `Object`.

  Sense's story tap knows no framework. It asks the functions a realm puts in
  its `Symbol.for('variance-authority.story.kind')` array what an object is, the
  first that answers a word names it, and one that throws is passed over.

### Patch Changes

- 8d1bcc1: A link in a doc comment opens from `node_modules`

  Doc comments linked to documentation by repository paths such as
  `../../../../docs/flakiness.md`, which resolve to nothing in an installed
  package. They now link to the page on variance-authority.dev, or to the file on
  GitHub when the site does not publish it, so the link works on hover in your
  editor and in what `variance ask symbol` prints.

  The MCP server's instructions and its observability answer linked to
  `/start-cli` and `/presentation`, which the site does not serve. They now link
  to `/start/cli` and `/docs/presentation`, and the `@variance-authority/cli`,
  `@variance-authority/help`, `@variance-authority/mcp` and
  `@variance-authority/vitest-browser` READMEs link to the guides where the site
  publishes them.

  `variancePrecondition`, `wiringOf`, `tapCommits` and `provenanceOf` carry an
  `@see` link to the section of the guide that documents them.

## 0.15.0

### Patch Changes

- ef496ad: READMEs name what the program does

  The package READMEs, and the `@variance-authority/vantage` and
  `@variance-authority/playwright-test` descriptions, no longer write a test, a
  record or a run as something that says, asks or knows. Each sentence names what
  the program does: a command prints, a record holds a field, a test runs or
  covers. Where a value is filled in from configuration or a default rather than
  recorded, the README says so. Four renamed headings change their anchors:
  `help`'s "Where the declaration is undocumented", `playwright`'s "Where a
  component is declared, read from the engine", `storybook`'s "What a pass sends
  the preview" and `sense`'s "Correct what a file's text declares it imports".

## 0.14.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.13.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.12.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.11.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.10.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.9.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.7.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.6.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.10

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.9

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.8

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.7

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.6

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.5

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.4

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.3

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.2

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.3.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.2.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

### Minor Changes

- 26ae9ed: Distinguish the React component instance that initiated a commit from every
  component whose render body ran because of it.

  The commit tap retains `memoizedUpdaters` as bounded structural component paths,
  and Eyes records those commits in the authored test chronology. The MCP testing
  surface places update initiators inside or outside the component paths a test
  addressed while keeping whole-test source execution separate.

  Export bounded read-only Fiber subtree, parent-chain, component-path, and source
  location helpers for diagnostics that already hold a Fiber.
- 5c34e6d: Say which input moved, not just which tag did

  `partingOf(baseline, candidate)` climbs from a set of deltas to the component
  boundary that owns them and names the input that carried the decision:
  `Cart chose differently — useState #0 moved`, with `Summary` reported as having
  been handed a different `expanded` and hanging under that line as a
  manifestation rather than as a second finding. `explainParting` renders that
  as lines. Two runs of one page that differ in a `<p>` where the other has a
  `<span>` previously produced a structural delta and nothing to say about it;
  the tag is now the symptom and the hook cell is the report.

  `holdingOf` from `@variance-authority/react` supplies the evidence — props,
  context values and hook cells as digests, per boundary, including
  `useSyncExternalStore` snapshots so a store that moved outside React is
  distinguished from a component that decided differently on its own. Values are
  never carried, only digests, and a holding reaches no hash: `renderHash`,
  `structureHash`, `styleHash`, band-exact component digests and
  `componentInstances` are all unmoved by it, the same bargain `styleProvenance`
  makes. `collect` in `@variance-authority/dom` takes `holdingOf` as a
  caller-supplied reader, opt in separately from `wiringOf`, and `capture` in
  `@variance-authority/unit-test` now accepts `provenanceOf`, `wiringOf` and
  `holdingOf` so a unit test can read one.

  A boundary whose own input could not be read is reported as `unread` and never
  as nondeterminism: `undetermined` is reserved for a component whose every input
  was read and agreed. A wrapper that roots a component boundary no longer
  collapses, because collapsing it discarded the holding — the cost is that a run
  reading holdings keeps wrappers a run without them removes, which is why both
  sides of a comparison must be read the same way.

  A component that ran no hooks is read as having run none, rather than as
  unreadable. React writes `_debugHookTypes = null` on every fiber and fills it on
  the first hook call, so the property's absence is the only silence — and
  collapsing the two reported the one shape most worth calling nondeterministic, a
  component with no props and no hooks that renders differently twice, as
  something nothing could be said about.

  `PartedBoundary.moved` names the properties the owned deltas named — `color`,
  `padding-top`, `width` — and `explainParting` spends them on the delta line.
  That is the last joint of the chain the rungs climb: a hook cell moved, a prop
  carried it down, and this is what the prop turned into on the page. A count and
  a band stop one link short of what somebody chasing a visual regression is
  trying to name.

  `Parting.slice` answers the question asked before which input moved: is this
  worth opening. Three facts are read independently — did the component tree
  move, did any input move, did the output move — and the combinations collapse
  to six sentences. `refactor` is the one that pays for the rest: a component
  tree that moved while the page did not is the receipt a refactor never gets,
  since a pixel differ can say the screenshots match and nothing about what was
  rewritten underneath. `flake` is `settled`'s opposite number and is refused on
  silence — a run that read no boundary reports `unread`, never `flake`.

  `explainParting` leads with that line, and stops enumerating manifestations
  past three: one input at a fork can put a boundary on every component beneath
  it, and nine lines carrying one decision bury the one line worth reading.

  The whole layer is documented in `docs/parting.md`: the six slices, the seven
  rungs, what a holding carries and what it deliberately does not.
