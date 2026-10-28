# @variance-authority/unit-test

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

### Patch Changes

- 8bab581: A refusal names what is missing instead of asking you to run the suite again

  Running a whole suite again to refresh a record is rarely yours to do, so no
  message tells you to. Where something can still be answered, it is:

  - `variance_composition {subject}` against a report with no per-subject
    structure lists the components the census holds in that subject and the
    renderings it shares, and says the report holds no order, depth, mount or
    count within it.
  - `variance_locate` with `under`, `above` or another spatial relation, against
    a run that resolved no layout, prints where the anchor is on each surface that
    says it, and says the run cannot tell what sits in that relation to it.
  - `variance_composition` against a report merged from shards says each shard's
    report still holds its composition, and the suite index the build composes
    from every shard's part holds the census across them.

  Where nothing can be answered, the refusal stays and names the condition, not a
  rerun: shards that started from, or chose their tests from, different records
  are not combined, and the record before the build stands; shards written by
  another version, or of which only some kept cases, are not combined;
  `variance shards --unrecorded 0` says a matrix of none starts no job; a Vitest
  run whose `--reporter` replaced the recording reporter says the record is as it
  was; a distill reading withheld for an incomplete coverage row, and a missing
  unit-test capture directory, name what is missing.
- 0b6af81: A changed region is joined against the baseline's nodes as well as this render's

  A change that replaces an element paints over the old element's box and the new
  one's, and `attributeRegions` read only one snapshot. On todomvc's broken toggle,
  71% of the changed region is inside the checkbox that left and 88.75% inside the
  div that arrived. Neither reaches the 0.9 containment, so the region named the
  row around both.

  `AttributionOptions.before` is now required: the snapshot of the revision the
  pixels are compared against, or `undefined`. Each node is joined against the
  area its own box and the box of the node the differ's matcher pairs it with in
  `before` cover together: the two places, not the rectangle that holds both.
  A box that left is placed by where it was in its own image, whose corner is the
  new `AttributionOptions.beforeOrigin`: by default the before snapshot's root, so
  a subject the page moved between two clipped shots joins where its pixels are.
  A call that states `origin` with a `before` snapshot and no `beforeOrigin`
  throws, since a corner guessed from the other image is right only when the page
  did not move.

  A baseline keeps that snapshot. `Raster.snapshot` is a `PackedSnapshot`, the
  tree gzipped and in base64, written by the Playwright fixture, its promotion,
  the Vitest browser provider and the CLI's image sidecars. `packSnapshot` and
  `unpackSnapshot` are exported from `@variance-authority/observe`. Every store
  carries it as text: `sidecarFrom` keeps it, `variance push` forwards it, and
  tribunal stores it in new `baselines.snapshot` and
  `build_subjects.candidate_snapshot` columns (schema 21, migration
  `0019_baseline-snapshot.sql`) and promotes it on approval. On
  `cases/storybook-case` it adds 3.2–5.4 KB to each sidecar.

  A baseline without a snapshot says so. When a changed verdict has regions and
  its baseline kept no snapshot, or one that will not unpack, the reason ends
  *the baseline records no snapshot of its nodes, so regions were joined against
  this render's boxes alone: an accepting run records one on a revision where
  this subject is unchanged*. An accepting run — `--update-snapshots`, Vitest's
  `--update`, `variance accept` — now re-stamps an unchanged baseline that kept no
  snapshot, as it re-stamps one painted under another identity, and the
  observation marks it `signals.snapshot: 'unrecorded'`; `restamps` in
  `@variance-authority/core/judge` is the one rule all three ask. Every other
  verdict the mark is on ends *the baseline records no snapshot of its nodes, and
  an accepting run records this one*. Two images
  compared directly get the same clause, naming the before image, without the
  remedy, and are never marked.

  A subject whose document has not moved settles on its digest and builds no
  observation to mark, so `settle` now renders a pictured baseline that kept no
  snapshot when this run collected one, with the reason *the baseline records no
  snapshot of its nodes, so this run renders it for an accepting run to record
  one*. A suite of baselines accepted before this release renders them on every
  run until an accepting run re-stamps them. Tribunal records one on ingest
  instead: a pushed candidate's snapshot is written onto a baseline that has an
  image and kept none, when it was painted from the same document under the same
  identity, and never over one it kept, so such a subject renders once. The
  snapshot's runtime fields (`provenance` and its `createdBy`, `wiring`, `holding`,
  `styleProvenance`, `styleTokens`, `ignoredBy`) are then the recording run's: the
  first push, from a build on any branch, that drew that document, as they are the
  accepting run's on a re-stamp. `Described.keepsSnapshot`
  is the new required field it reads:
  the durable, LFS and tribunal stores derive it from the sidecar with
  `keepsSnapshot` from `@variance-authority/core/format`, and the remote store
  refuses a description without it. A packed snapshot now opens with a `v1:`
  header naming its format version, `PACKED_SNAPSHOT_HEADER`, and a snapshot
  without it counts as not kept. `unpackSnapshot` reads one as not recorded
  unless every node in it is one, with `isSemanticSnapshot`, new in
  `@variance-authority/core/format` beside `isRenderDocument` and
  `isSubjectRef`: the checks `@variance-authority/unit-test` already made of a
  capture file's snapshot, document and subject, which it now asks. Tribunal serves API 6, which describes a
  baseline with `keepsSnapshot`; `variance push` against an older deployment names
  the refused descriptions when the project's `remote` baselines are stored there,
  and the remote store's refusal names tribunal before API 6 and a
  `serveRasterStore` from an earlier `@variance-authority/remote`: upgrade the
  server, tribunal or your own, before the client. `settle` takes this run's snapshot as a
  fifth argument. `variance accept` and the MCP changelog call these subjects
  *unchanged and re-stamped* rather than re-stamped under this run's identity,
  which was untrue of them. The render cache no longer hands on a snapshot an
  entry kept.

## 0.15.0

### Patch Changes

- 8dbc834: The components a module declares are read from its code. A declaration written
  in a block comment, a JSDoc example or a template literal no longer names a
  component, so a commented-out `function Retired()` no longer makes its file
  the one that declares `Retired`. A name is declared by a statement of the
  module itself: a function, class or binding inside a function body belongs to
  that function and no longer counts. An `export async function Page()`, an
  abstract class, a generator, a second name in `const A = 1, B = 2`, and a name
  that starts with a non-ASCII capital or carries a `$` are now declared too.

  `variance run`, `variance collect`, the Storybook collector and the route
  collector resolve a component to its `file:line` from the same reading, through
  `indexDeclarations`, which `sense` now exports. What that changes in the index
  they build from `source.dirs`:

  - The line is the first line of the declaring statement. A decorated class
    sits at its first decorator, or at its `export` when the decorator is written
    above the `export`, and a second name in a multi-line `const` at the line of
    the `const`.
  - `.d.ts` files, and test, spec and story files your own `exclude` lets
    through, declare nothing.
  - A file the parser cannot read declares nothing, where the text scan found
    the components in it. That covers a Flow-annotated `.js` file, and a `.vue`,
    `.svelte` or `.mdx` file you add to a collector's `extensions`, which is
    parsed as TSX and fails. The index built from `source.dirs` or a collector's
    `source` does not say so: the file's components are missing, and nothing
    names the file. Only `sense`'s source index, for a file it records, names the
    parse error in that file's record.
  - Building the index needs `sense`'s native addon, which ships for macOS on
    arm64, Linux on x64 and arm64 with glibc, and Windows on x64. On any other
    machine, including an Intel Mac, an Alpine image and Windows on arm64, a
    configured `source.dirs` fails at its first file and names why the addon did
    not load, where the text scan ran anywhere. The route collector depends on
    `sense` for it.

  `indexSource` is removed from `@variance-authority/core/attribute`. Build a
  `SourceIndex` with `indexDeclarations` from `@variance-authority/sense`, or
  write one as plain data: a map from component name to `{ file, line, via }`.
  `SourceRef['via']` loses `'declared'`, which nothing produced, and
  `readCapture` in `@variance-authority/unit-test` refuses a capture whose source
  index carries it.

  The source index format moves to version 18, so an index written before this
  release is rebuilt once instead of keeping the names it read from comments.
- 1eed290: A form filled in after mount is painted and compared filled in

  Text a play function or a test typed into an `<input>` or `<textarea>`, the
  option it chose in a `<select>` and the box it ticked now reach the render
  document and the snapshot. Before, the document painted the form as the server
  sent it and the snapshot did not move for typed text or a chosen option. A
  password field's value is carried as one `•` per character, and a file input's
  value is not carried. A form nobody filled in reads exactly as before.

  This is part of `RULESET_VERSION` `r2`. A subject whose form was filled in
  after the server sent it has a new render document, so after this upgrade its
  image shows the form filled in and reads `changed` against a baseline painted
  empty; `variance accept --all` adopts it. A Playwright test painted its form
  filled in before this change, so it does not move there.
- b065364: `::before` and `::after` are read as children of the element they hang from

  Restyling or rewording a `::before` or `::after` box used to repaint the page
  and move no hash: the rules written for it were matched against the element,
  failed, and were dropped from both the snapshot and the render document. A
  generated box now enters the capture as a child node tagged `::before` (first)
  or `::after` (last), carrying the rules written for it. In a browser it carries
  its computed style, projected onto the allowlist, and the text its `content`
  says as a `#text` child; a box whose `content` is `none` or `normal`, or whose
  `display` is `none`, is not in the tree. Strings are joined and `attr()` reads
  the element's attribute; a part such as `counter()` or `open-quote` is carried
  as written.

  Under JSDOM, which computes no generated content, the declared rules answer,
  picked by the same cascade order normalization uses: a box is in the tree when
  the winning `content` gives it one and the winning `display` is not `none`, with the rules that style it and no computed style.
  When that `content` is strings and `attr()`, the box says its words as a
  `#text` child, as in a browser, so rewording it moves the snapshot. When it
  holds a `counter()`, a quote, a `var()` or a `url()`, the box has no text and
  carries `unread` on `RawNode` and `SemanticNode`, naming the parts it could not
  resolve; `unread` is outside every hash. JSDOM's own parser drops a `content`
  that is a single `attr()` or `counter()` and nothing else, so no box is read
  for one.

  This is part of `RULESET_VERSION` `r2`, the same `r2` that keeps the served
  port out of a render. A subject with a `::before` or `::after` box has a new
  render document, so after this upgrade its image shows the box and reads
  `changed`; `variance accept --all` and Playwright's
  `--update-snapshots=changed` adopt it.
- d5cc0c3: A baseline painted under another identity is compared, and the identity is the cause

  There is no `incomparable` verdict: a subject with two images is always
  compared, and reads `unchanged`, `changed`, `new` or `ignored`. When the two
  were painted under different identities, such as another browser version,
  platform, scale factor, font stack or recipe of this tool, the observation
  carries `signals.identity` (`recipe` or `machine`) and `signals.moved`, each
  moved field with both values, and its `because` opens with that cause. A
  `changed` subject fails the gate whatever its cause, and `variance accept --all`,
  Playwright Test's `--update-snapshots` and Vitest's `--update` adopt it like any
  other change. An `unchanged` subject under a moved identity is re-stamped
  under this run's identity by the same three, so an upgrade is named once rather
  than on every later run. A re-stamp approves nothing: `variance accept` counts
  it in `restamped` and its summary, not among the accepted subjects or the
  commit message, and the `variance_changelog` preview says so. A durable store's
  `put` moves a baseline along its line, one engine family on one platform at one
  scale: the line's older copy is removed, so a lookup never compares against a
  superseded image, while a matrix of engines or machines keeps one baseline
  each. A lookup that misses its own identity reads its line first. `variance_explain` names the moved identity as the
  cause of a change, and the tribunal no longer counts or lists an
  `incomparable` verdict. `@variance-authority/raster` exports `identityCause`,
  which says whether two identities differ in the recipe alone or in the machine,
  with its `IdentityCause` and `ComparedSides` types. `variance doctor` reports a
  store painted by another machine as `PAINTED ELSEWHERE` and exits `0`: the run
  compares it. Its `baselines.comparable` field is now `baselines.paintedHere`.
  The pull-request comment groups these
  subjects under "Painted under another identity", one line per identity that
  moved. Its section for subjects with no image to point at is headed "Nothing to
  point at", which was "Not compared".
- d432339: A page reads its clock in UTC and formats for en-US, not for the host

  The harness the route and Storybook collectors open, and the pages the renderer
  paints, took their timezone and locale from the machine. A date the page
  formatted read one way on a laptop in Sydney and another on a runner in
  Virginia, from one build, and the two compared against one baseline as
  `changed`.

  Both are pinned: `timezoneId` to `UTC` and `locale` to `en-US`. Declare either
  in `variance.config.json` (`"timezoneId": "Europe/Berlin"`, `"locale":
  "de-DE"`) and the collectors and the renderer pin that instead; an unknown
  timezone or a malformed language tag is refused by its field.
  `createHarness` and `createPlaywrightRenderer` take the same two options.
  `@variance-authority/core/format` exports their type, `PageRegion`, and
  `@variance-authority/playwright` exports `pinnedRegion`, which fills in `UTC`
  and `en-US` for a field left out.

  Both are part of the environment key, and the renderer's pair is part of
  `RenderIdentity.rasterization`. A capture read in another timezone or language
  is another environment, and an image painted in one is compared with a
  baseline painted in another, with `rasterization` named as the cause of
  whatever moved.

  `@variance-authority/playwright-test` paints each test in the timezone and
  locale its page runs in: whatever the Playwright project or `test.use` sets.
  When neither sets a `timezoneId`, `varianceFixtures` opens the page in `UTC`
  rather than the host's, so a laptop and a runner in UTC read it under one key;
  Playwright Test already opens it in `en-US` when nothing sets a `locale`. That
  reaches every test of a suite extended with `varianceFixtures`, including tests
  that never call `variance`, so a test that asserts a date formatted in your
  machine's timezone reads it in `UTC` after this upgrade; set `timezoneId` in
  `use` to keep your own. A page
  you hand to `createVariance` is read and painted in whatever its own context
  opened it in, which is the host's timezone when that context set none: open the
  context with `timezoneId: 'UTC'` to match. `varianceRenderer` is now a test fixture, chosen
  by the page, and `varianceRenderers` is the worker's set of renderers, one per
  timezone and locale; a project that overrode `varianceRenderer` at worker scope
  overrides it at test scope instead.

  **Every image painted by the Playwright renderer is compared under a moved
  recipe once after this upgrade**, because its recipe now carries the timezone
  and locale. Each subject names `rasterization` as the cause of what it reports,
  and one whose pixels moved is `changed`:

  - With `variance run`: the run exits `1` for each `changed` subject. Review
    them in `variance report --format html` and adopt them with
    `variance accept --all`. A rerun reports `unchanged`.
  - With `@variance-authority/playwright-test`: the suite fails each `changed`
    test, and `--update-snapshots=changed` adopts them.
  - With `@variance-authority/vitest-browser`: `vitest --update` adopts them, as
    `variance accept --all` does.

  `@variance-authority/vitest-browser` reads no `variance.config.json` and takes no
  timezone or locale, so it paints in `UTC` and `en-US` whatever its tab ran in,
  and neither it nor `@variance-authority/unit-test` writes a timezone or locale
  to the environment key.
- 28b52e7: A run before the unit tests names the step it needs

  `variance run` over a capture directory that does not exist exits 2 with an
  operator error that says what is missing and what writes it:

  ```text
  capture directory test/.variance/captures does not exist, so there is no capture to compare. Your unit tests write it through `writeCapture`: run them first, then run variance again. If they have run, none of them wrote a capture to this directory.
  ```

  It used to exit 2 with `cannot read capture directory` under a banner that
  called it a defect in the tool. A capture directory that cannot be read for
  another reason, such as a path that is a file, is an operator error too, with
  the system's reason.
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
- 754d04c: The port a build is served on is no part of a render

  The route and Storybook collectors serve a build on a free port, and that port
  reached three identities. An asset the page loaded was keyed by its absolute
  URL, a `url()` in a computed style was the absolute URL the engine resolved,
  and the document digest read both. One build served twice therefore read as two
  environment keys and two documents: each run missed the render cache, painted
  again, and read its document as changed against its own baseline.

  An asset the page's own origin serves is keyed by its path, and the page's
  origin is dropped from a `url()` before it is hashed. An asset another origin
  serves keeps its absolute URL. A capture carries the page's `baseUrl` so core
  knows which origin is the page's, and the renderer resolves a path-keyed asset
  against the document's `baseUrl`. `documentDigest` reads the page's own base
  and resources as paths, so one build served on two ports addresses one render
  and the render cache hits; the document keeps them absolute for the renderer,
  and a resource another origin serves stays absolute in the digest too.

  A `@variance-authority/unit-test` capture keys its assets the same way, so a
  `@variance-authority/vitest-browser` observation, which captures through it on
  the port the runner had free, keeps the port out of its environment key.
  `readCapture` reads back a capture whose asset is keyed by path, resolving the
  key against the document's `baseUrl` as the renderer does; `assetUrl` in
  `@variance-authority/core/format` is that one resolution.

  **The document of every page served over `http` moves once after this
  upgrade.** `documentDigest` now reads a document's base and resources without
  the page's origin, so the digest of every document served over `http` or
  `https` changes: every route, every story, every Vitest browser page, and every
  Playwright page opened by URL. A moved document misses the render cache once,
  and its image is still compared with the baseline: a page whose pixels did not
  move reads `unchanged`, and one whose pixels did reads `changed`, which
  `variance accept --all` and Playwright's `--update-snapshots=changed` adopt.
  `RULESET_VERSION` moves from `r1` to `r2`. The ruleset is part of a snapshot's
  environment key, not of the render recipe, so no image names it as a moved
  identity; a snapshot diffed against one recorded under `r1` names the ruleset as its
  environment root.

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

### Minor Changes

- 740f2af: The tab reads, and the run judges

  A Vitest browser-mode test has already done the expensive half of a visual
  observation. It mounted the component in a real engine with the real
  stylesheets, and the locator it awaited is the evidence the thing arrived. What
  it cannot do is judge: the baseline is on a disk the tab cannot reach, and
  painting a document is a browser the tab cannot launch.

  `@variance-authority/vitest-browser` is those two halves either side of Vitest's
  command protocol. In the tab, `variance(subject)` settles the subject's Suspense
  boundaries, holds animation still, and reads the mount once — markup, applicable
  CSS, component provenance, framework wiring, and the bytes of every resource it
  references, fetched with the page's own `fetch`. In the Vitest process,
  `variancePlugin()` registers the command, holds one renderer and one store open
  for the run, paints the captured document, and answers with the verdict and the
  sentence a failing assertion prints.

  The document is painted rather than screenshotted, with the tab's own browser
  sitting right there. A live screenshot carries no render identity — nothing that
  can say which machine, which scale, which font stack — so a baseline made from
  one is reproducible on no other machine, starting with the CI runner that judges
  it next.

  Media queries resolve against the tester iframe rather than the browser tab,
  because that is the frame the subject was laid out in.

  `@variance-authority/unit-test` publishes `capture` on its own entrypoint,
  `@variance-authority/unit-test/capture`, carrying nothing that touches a
  filesystem. Resource bytes are encoded without `Buffer`, which the subject's own
  realm does not always have; in a browser tab the previous spelling threw while
  closing the first resource a fixture referenced, and arrived as a capture that
  could not see images rather than as a missing global.

## 0.2.0

### Minor Changes

- e546e21: A subject is allowed to reference something that is not there

  A fixture that points an `<img>` at a path nobody serves is testing the fallback,
  and the broken state is the subject. Capture had no way to say so: the resolver
  returned bytes or the capture was refused, so Material UI's CardMedia,
  ImageListItem and Avatar suites — which all reference a deliberately absent
  `/fake.png` — could not be captured at all.

  `resolveResource` may answer `{ absent: true }`. The resource is recorded with
  its status, and the renderer answers that status instead of counting the request
  as one the document failed to carry.

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
