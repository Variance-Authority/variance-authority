# Positions

Standing decisions no check enforces, read with the code rules in
[change](change.md). Each is what a change got wrong, or nearly did, and the
reason it holds. A change that needs to break one replaces it here, in the same
pull request, with the new reason.

## Reading a record

- **A recorded line has a frame.** It means something only in the text it was
  recorded over, and a suite usually runs over a dirty tree, so a reader of
  recorded lines first establishes that frame. Reading against the wrong text
  can select nothing and pass green, which is the unsafe direction.
- **A region is changed or carried, and the diff decides.** A hunk touched it or
  none did. Regions are never paired by address and digest or by content: two
  like callbacks in one component would hand the deleted one's cases to the
  survivor.
- **A comparison needs the diff from the base commit.** Without it no comparison
  is made and the answer names the remedy, because pairing by address reports
  motion that never happened.
- **A reader never refuses a record from another build.** It answers what the
  record can, names both identities, and names each question the difference
  leaves open and why. The remedy never says to run the suite locally, which is
  mostly impossible; it names a published newer record only when one exists.
- **Record the original's coordinates.** Instrumentation that reads a source map
  takes the module's name and digest from the same resolution as its lines:
  reason on the emitted shape, record the original. Source lines under a built
  name join to nothing, and every answer comes back silently empty.
- **A walk runs one way and the caller names it.** `from` follows the arrows,
  `to` goes against them, and both are asked only by naming one path in each. A
  closure that reaches a connector file and widens is intended: no hub cut-off,
  fan-out heuristic or folder-only mode narrows it, as [escapes](escapes.md)
  keeps hop narrowing out, because code jumps folders at any real scale.
- **Distance selects and cost ranks.** The two never merge into one number,
  which would hide depth inside a factor. The hop constants match measured
  co-change in this repository's history;
  [`hops.ts`](../../packages/mcp/src/tools/hops.ts) holds the measurement.
- **Text finds the file and the record finds the case.** An orientation answer
  prints the text search's list first, with the record's leads beside it, not a
  fused ranking. No routing rule has beaten always searching text out of sample.
- **Locality is a graph scope, not a score.** A name from your file, folder or
  package wins over a generic one. Candidates are the files defining the exact
  exported name, and a wrapper shadows only when a node in your own package
  imports the other and re-offers that name. Sharing a word or a direct
  dependency is not shadowing: a folder's `i18n.ts` uses an i18n library without
  standing in for it.
- **A static question ends at the definition.** Each question yields a set of
  files and the answer is a set operation over them, not a new resolver. Which
  Provider is mounted above a component is runtime composition, outside the
  module graph.
- **A captured object is a reference.** A primitive is shown as it is, with long
  strings cut; an object is shown as `ref1` with at most a one-word kind, never
  expanded. The question is how objects move, not what they hold, and contents
  come only when an agent asks for a specific ref on a further run.
- **A map is as fresh as the code.** Orientation is projected from the sense
  store on demand, never kept as a written codemap: a stale map is worse than
  none because it looks authoritative. Package relations give the first jumps,
  and journeys are field reports of which code one test really walked.
- **A baseline has one authoritative producer**: the full run on the mainline. A
  local layer sits on a CI baseline that knows its commit, and full runs stay
  off the critical path.

## Speed and size

- **Too slow is never answered with a flag.** An opt-in hides the cost, and most
  users never flip it. Measure where the time goes across the whole answer, fix
  the read, and ask the store that already holds the data.
- **A read never waits for the network.** A matching document digest exits
  early, and waiting or naming what is open happens only on a changed or
  uncertain path. A gap in what was seen is closed by a diagnostic there, never
  by a timeout on every subject.
- **Compress after the difference is verified.** Raster compression is a storage
  step: the compare path keeps the browser's bytes, and an image is compressed
  only when a difference is about to be stored. Most runs change nothing.
- **A figure is never repaired with run time.** Recording has the cost
  `cases.ts` measures and no more: a figure distorted by shared state is
  attributed with a run-level row or note, not fixed by a reload or any other
  time the user's run pays.
- **The coverage record may at most double for a feature**, and tries not to.
  Measure the size, use the exact encoding unless it approaches doubling, and
  still minimise. A spec states the measured cost, never a size gate nobody
  measured.
- **A benchmark that gates counts** the work avoided, or takes a share of one
  run's own clock. A ratio of two timed runs gates on the machine: a stall of
  fixed length lands hardest in the shorter run.
- **Storybook speed is ranked by boots × boot cost.** On an enterprise build a
  document boot costs seconds, and a fresh context starts with an empty HTTP and
  code cache, so one document per worker and no reload come first. A small
  corpus says nothing about boot cost.

## Names and surface

- **Derive before declare.** Read a signal from what the artefact already says
  before asking its author to state it; where a link must be stated, use the
  form the host ecosystem makes natural. A thing is identified by a unique
  descriptive name, never an index.
- **Our namespace, our rules.** Where the project owns a space, state the rule
  and let the edge case follow. A knob or second name that only dodges a
  hypothetical collision is hedging; an override exists only for a real clash
  with a user's setup.
- **A flag is named after the quantity it takes**, and behaves as that reading
  says: `--at-distance` beat `--band`. A borrowed word collides with its other
  meanings.
- **A wrong exported name is renamed and the old one deleted.** No deprecated
  alias or re-export, since a kept alias keeps the wrong word in the published
  surface. Every caller, the docs and the surface baseline (`yarn surface
  --write`) change in one commit.
- **The end state is one `ask`.** `variance-authority-help` is an interim
  surface, and a page presenting the split as deliberate is wrong. A new machine
  format names a consumer that cannot import the package, and findings read as
  prose.
- **A published repository limits its packages and entry points**, because each
  is something an adopter installs and learns. A library is optimized for its
  users, never for its own suite: no new subpath or extraction to make the
  repository's tests cheaper.
- **A new published package earns its place**: somebody installs it for what it
  is for. One that exists only so two packages share a helper is removed, and
  trusted publishing cannot create a package at release.
- **A deployed service may depend on what it needs.** The
  package-per-requirement rule of ADR-0013 governs tools a user installs; a
  service has no consumer who pays for its dependencies.
- **A version is supported while its projects would adopt.** The latest of a
  core package always; an old one only while it is actively used and those
  projects are likely to take variance up. Use alone is not enough: a two-year-old
  jest is in use and out; React 18 and 19 are both in. A route that fails this
  is deleted with its floor.
- **Read a dependency's peers before taking it.** A test must not pull in a
  bundler we do not run: `react-server-dom-parcel` gives the real RSC `cache`
  with no Webpack peer.
- **Never read TypeScript with a regular expression.** oxc owns the syntax.
  Follow a package's manifest to `dist`, then map back through tsconfig, because
  a guessed path answers wrongly in silence.
- **CommonJS best effort covers only what a module declares** (ADR-0097), the
  reading of a format. Modules loaded through `require`, under Jest, a CommonJS
  bundler or a `.cjs` file inside Vitest, are recorded like any other, so a miss
  in what loaded or ran is a bug.
- **Each check is a switch the user composes.** A transformer check gets its own
  switch and the record says which were on; no regime option or policy sits
  above them. Code the user calls, such as Eyes and preconditions, gets no
  switch.
- **Stabilization is a base layer**: on by default, no setup. A knob is an
  escape hatch, what still flakes is a task for an agent, and a mechanism with
  full control beats one that polls or guesses.
- **CI runs like a clock.** Anything unexpected fails loudly and is reported,
  never absorbed by a workaround, which turns a defect into a result that
  depends on the machine.
- **A process is codified in the action or the CLI, never pasted.** The
  owner, 2026-11-12, in the session that wrote this entry: "We avoid any
  imperative code that someone should copy past and rely on codified process in
  action or cli. We pick the abstraction that withstands time." [What we ship
  is installed, never
  copied](../../docs/AGENTS.md#what-we-ship-is-installed-never-copied) covers
  the glue around our steps too. Glue is what an adopter writes around `uses:`
  of the action or a `variance` command to decide what variance does on an
  event, or to compute, move or post variance's data: a branch that runs
  `index` only on a pull request, a cache key, an artifact path, a `jq` over
  our output, a poster for a platform's API. Each is a missing input or
  command. A page never adds glue, and a recipe a page already prints stays
  only until the action or the CLI carries it. The adopter's own steps
  (checkout, install, a build, a browser), which events run their jobs, and
  another service stay theirs. Pasted glue is code every adopter maintains and
  that drifts with each release; a codified step is fixed once, by us. The
  coverage badge was first written as shell in a workflow, and was turned down
  before it merged for `variance coverage --format badge` and the action's
  `badge` input.
- **A collision breaks loudly.** An id clash that only input the test framework
  would reject can produce is not engineered around: the fold throws, naming
  both tests. Silent merging or renumbering hides a broken suite.
- **Tribunal accepts more than one identity.** Keys stay a supported mode for
  adopters. This repository's direction is GitHub identity, an Actions OIDC
  token or a GitHub App, and a missing secret must not be able to turn `main`
  red.
- **A visual change is judged by its area**, never as a share of the frame. A
  ratio shrinks as the image grows, so the same small change vanishes on a large
  page.
- **The change image is side by side**: before and after with changed regions
  outlined, never stacked with a red diff panel. A stacked image hides a
  one-line insertion, and a content shift must read as displacement.
- **Ask the build before building a reader.** A production build decides whether
  a component name survives: `keepNames`, jsx-source and source maps are one
  configuration line each, and a minified name reads as noise.

## Tests

- **Every placement gets a fixture that runs.** A seam that misses a case
  records nothing and warns nothing, so an argument that a mechanism cannot miss
  a placement is not evidence. Assert on what was recorded, and check a fix for
  one host against every other host.
- **A regression test goes through the real seam**, with a minimal fixture of
  the real shape that broke.
- **Mocking is normal.** A report of an unexpected import in an ordinary mocked
  setup is a Variance defect, never a reason to ask the suite to declare itself
  open. Fixtures are one realistic project per runner, combining the mechanisms,
  and they record with zero reports on every run.
- **A port is verified by classifying differences.** Between parsers or grammar
  builds, every difference is note-only or answer-level, and the answer-level
  ones are read to say which side is right. Byte-identical parity rejects the
  better reader.
- **Coverage in use changes a decision**: which test goes red, what the diff
  left unpinned. Selection inside `test:loop` and `verify:near` is a guide rail
  and does not count as using it.

## Findings and examples

- **A finding lands as an abstraction**: an ADR plus a standing rule here, with
  the journal as the evidence underneath. A measurement alone does not transfer
  to the next change.
- **An example a stranger follows lives in its own repository** and installs
  from a registry, because a workspace example resolves through the workspace
  and proves nothing about consumption.
- **Material UI is a check, not a scale proxy.** A change to parting, slicing or
  divergence is re-run against its unit tier: findings keep their count while
  flake headlines stay at zero. It is small and flat, so it says nothing about
  whether a storage format holds up at scale.
