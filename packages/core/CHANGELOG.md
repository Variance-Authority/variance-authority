# @variance-authority/core

## 0.3.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.2.0

### Minor Changes

- e546e21: A collector's complaints travel into the observation

  A finding produced at collection reached the CLI's record and nobody else. A
  suite driving this from its own runner asks the observation what is wrong with a
  subject, and the one diagnostic that explained the moved pixels — the host, not
  the stylesheet, chose the typeface — was produced, carried, and dropped one call
  short of the person reading the failure.

  `mergeDiagnostics` dedupes on every field, so the CLI, which now meets the same
  list twice, says a shared complaint once.
- f4b328b: Mainline's evaluation can travel, so the next machine does not derive it again

  A suite index is bytes addressed by the commit they were written at, which is
  exactly the shape a cache already wants. What was missing was anywhere to put
  them: every checkout that wanted to know what `main` looked like had to run
  `main`, and in CI that is the whole suite, twice, on every pull request.

  `@variance-authority/core/share` is the transport, and it has two backends
  because there are two. A **directory** is what `actions/cache`, `aws s3 sync`, a
  network mount and a laptop all are once the bytes are on disk; an **HTTP
  endpoint** is what a bucket, a presigned URL and a tribunal deployment all are.
  `createDirectoryShare` in `@variance-authority/store/share` is the filesystem
  half, kept out of `core` because `core` takes no platform.

  A share never fails a run. `get` answers `null` and `put` resolves, whatever the
  network did — a share that is down, misconfigured or empty is indistinguishable
  from a cold one, and the run derives its own index and continues. The cost is
  deliberate: a typo in an endpoint is a suite that quietly got slower rather than
  a build that went red, and the `behind` count `variance share` prints is the
  signal that publishing has stopped.

  The CLI gained a `share` section in its config, a `variance share` command that
  says what the share holds for mainline or publishes what this run derived, and a
  line on `variance run` naming where the index went. A lookup walks the lineage —
  `merge-base` with the configured `mainline`, then first-parent — and asks this
  machine's own cache for every commit before it asks the share, because the run
  that just published is usually the one asking.

  `docs/sharing.md` is the arrangement end to end, GitHub Actions first.
- e546e21: A subject is allowed to reference something that is not there

  A fixture that points an `<img>` at a path nobody serves is testing the fallback,
  and the broken state is the subject. Capture had no way to say so: the resolver
  returned bytes or the capture was refused, so Material UI's CardMedia,
  ImageListItem and Avatar suites — which all reference a deliberately absent
  `/fake.png` — could not be captured at all.

  `resolveResource` may answer `{ absent: true }`. The resource is recorded with
  its status, and the renderer answers that status instead of counting the request
  as one the document failed to carry.
- e546e21: A subject with no pixels is a baseline without an image, not a subject that got away

  A wrapper whose only child went to a portal, or a conformance mount with no
  children, occupies nothing. Refusing to photograph it is right; refusing the
  subject was not. On Material UI's unit tier that was 1109 of 4371 subjects
  reported as unobserved while the capture held their markup, their rules, their
  component hashes and their accessibility tree — none of which was in doubt.

  `Raster` makes the image optional: `bytes`, `width` and `height` are absent
  together or present together, and `pictured` is the one place that narrows all
  three. Absent means *this subject has no pixels*, which is a measurement — it
  never means the image was lost. `occupiesPixels` asks the same question of a
  record read without bytes, which is the only form a sidecar takes. `observe`
  gets a second tier in `unpictured.ts`, where the comparison such a subject can
  still take — document digest, component hashes, accessibility — is the whole
  verdict. `promotionOf` promotes the sidecar alone when there is no `after`,
  because the subject reached a verdict and the only missing half is the one a
  camera would have produced.

  The file-backed store carries the same nullable pair, and with it the split of a
  baseline's two halves into two path prefixes. `identities` scans the record root,
  because a subject with no pixels has no image directory to be found in and the
  sibling scan would otherwise call another machine's baseline new.

  Capture stops handing this to Playwright to fail on. Both screenshot paths used
  to refuse a zero-area subject in terms of their own arguments — the clip path
  with `Expected options.clip.height to be greater than 0`, the element path by
  spending the full actionability timeout and then complaining about visibility —
  so a reader had a component that rendered nothing and a sentence about a
  rectangle. `captureSubject` decides it now, and the renderer names the subject.

  **Operators:** this is schema **18**. `baselines` and `render_cache` drop
  `NOT NULL` from `width` and `height`, shipped as `0016_pixel-less-baselines.sql`.
  Apply it before pointing a CLI of this version at the deployment; `GET /version`
  reports the schema a build expects.
- f4b328b: A run leaves behind what its suite looked like, in bytes another checkout can read

  A run report answers about *this run*. Nothing answered about the suite from
  somewhere else: which components exist, which subjects hold them, which of them
  has an example of its own, and every name the run indexed. A branch asking any
  of that against `main` had nothing to ask, because `main`'s answers were computed
  on a machine that has since gone away — which is why *this component is not
  covered anywhere* was a question with no reader, and why a second run could only
  re-derive what the first already knew.

  `@variance-authority/report/suite-index` is that artifact. `suiteIndexOf` takes
  the baseline-bearing half of a report — the census, the subject denominator it is
  counted against, and the lexicon — and `encodeSuiteIndex` writes it as one
  segment, with `readSuiteIndex` and `writeSuiteIndex` beside the report's own file
  functions. The other half of a composition does not travel: `movements` is what
  moved since a comparison nobody else made, and `divergences` and `echoes` are
  readings of one commit's snapshots. None of the three is a fact about the suite.

  It carries the commit it was written at and nothing else about where it is, which
  is the rule the selection index already settled — a commit answers *what changed
  since this was written* exactly, and a timestamp says when a machine was rather
  than where a tree was. An index that cannot name itself is the honest record of a
  run that could not, and a reader holding one has nothing to diff.

  It is not JSON. A lexicon is the same few thousand strings written once per
  subject that holds them, and in JSON the repetition *is* the payload. Interned
  once and referenced by number it stops being one, and equal facts encode to equal
  bytes — a sorted dictionary, so a cache that keys on content actually hits.

  `@variance-authority/core/segment` is the arithmetic underneath: named columns,
  alignment, interned strings, and the validation a decode performs before it
  believes a file. A column's width comes from the array's own type, so a mismatch
  is a compile error rather than a decode against the wrong stride, and a malformed
  reference rejects the whole file — a segment is a cache or a baseline, both of
  which may be rebuilt, and half of either is worse than neither. The source index
  now reads and writes through it and keeps its own bytes; what it still owns is the
  part that is about source.
- e546e21: Two readings of two places are not a flake

  `flake` is an accusation — *this reading is not repeatable* — and it was being
  made about a comparison that never claimed repeatability. Lifting two instances
  out of two subjects at one commit and parting them produces a case where every
  input agrees, the tree holds, and the output moved; the old table had exactly one
  row for that.

  Where a component sits is decided by the boxes around it, and no component
  receives its own position as a prop. Two instances that agreed on everything they
  were handed and landed at different coordinates have contradicted nothing.

  `partingOf` takes a `PartingPlace`: `same` for one subject read twice, across
  revisions or across two moments of one scenario, and `elsewhere` for two
  instances at one commit. It decides only between `flake` and the new `placed`
  rung and slice, and it defaults to `same`, which is what every comparison across
  revisions is. `divergencesOf` is the one caller that says `elsewhere`. The
  sentence points outwards, at what put the component there, rather than at the
  component.

### Patch Changes

- e546e21: Four ways a large unit tier lost subjects, none of which said so

  **The styling was gone before the capture looked.** A capture taken from a setup
  file runs in the outermost `afterEach` a run has; every hook registered inside a
  `describe` has already finished, and `onTestFinished` runs later still. CSS-in-JS
  teardown lives in exactly those inner hooks — emotion's test renderer removes each
  `<style>` tag it inserted — so the capture read the page with the styling taken
  back off it. The class names were all still in the markup, they matched nothing,
  and every subject captured, compared and passed against a photograph of unstyled
  DOM. Measured on Material UI's unit tier: 399 of 400 captures carried no CSS at
  all, and 1201 subjects laid out to zero height because nothing was sizing them.
  `retainStyles` records style elements as they are inserted and puts the removed
  ones back, in insertion order, for the length of one capture. The next test still
  gets a clean page.

  **A subject id can be longer than a filename.** A suite that names subjects after
  the test that produced them — a file path and a full test name — passes 255 bytes
  on ordinary tests, and the point of that convention is that the id says where the
  subject came from. `fileNameFor` in core is now the one rule: a readable prefix,
  plus a digest of the whole id when the id does not fit, because truncation alone
  merges two tests into one file. The baseline store, the capture archive, the
  CLI's image directory, the Playwright evidence directory and the Eyes journal all
  use it; before this, each was one long subject id away from a raw `ENAMETOOLONG`
  that never mentions a subject. `@variance-authority/eyes` declares
  `@variance-authority/core` directly rather than reaching it through `react` — the
  host stacks it keeps optional are Playwright and Testing Library, and a filename
  rule is not one of them.

  **An inline `url()` is spelled in entities.** `style="background-image:url(&quot;/a.png&quot;)"`
  reaches the scan through HTML serialization, and reading it literally asked the
  caller for bytes at a URL that exists nowhere but in the escaping. The HTML half
  is scanned with the attribute's entities undone; the stylesheet half, which was
  never escaped, is scanned as before.

  **A stubbed `getComputedStyle` is not a broken asset scan.** Replacing
  `window.getComputedStyle` with a map of the two properties a component reads is
  the only way to drive some layouts in jsdom. The scan called `getPropertyValue`
  on the plain object it got back, and every test in the file died on a `TypeError`
  raised four frames below anything you wrote. There is nothing to scan and nothing
  to complain about — whatever those styles would have named, the stub already
  removed from the page. The attributes on the element are still read.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

### Minor Changes

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

### Patch Changes

- e8fee66: Refuse a value whose state is not in its own enumerable keys.

  `shapeValue` documented a `Date` as refused and encoded it instead. `typeof`
  answers `object`, `Object.entries` answers empty, and the canonical text came
  out `{}` — so a snapshot holding a timestamp addressed to the digest of an empty
  object, and a later run comparing a different timestamp reported unchanged. The
  same hole swallowed `Map`, `Set`, `URL`, and `RegExp`.

  An object with no own enumerable keys and a prototype other than `Object`'s is
  now refused by name at its pointer. A genuinely empty object is still a value,
  and an instance carrying its own fields still serializes them.
