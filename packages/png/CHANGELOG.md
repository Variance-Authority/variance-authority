# @variance-authority/png

## 0.22.0

### Minor Changes

- 659925c: An accepted baseline is kept as a lossless WebP, in about a quarter of the bytes of the PNG it was captured as. It is encoded once, on the machine that accepts, by `keepImage` in `@variance-authority/png-sharp` — sharp's libwebp at effort 2 — which decodes its output back and throws unless every pixel with any opacity matches in all four channels and every fully transparent pixel stays fully transparent. The colour under a fully transparent pixel is not kept; no comparison sees it. `@variance-authority/store/keep` exports `keptRaster`, which every accept calls before `put` and which loads sharp only then, so a run that accepts nothing never loads it, and an accept where sharp does not load fails and names why. A durable store's `put` encodes nothing: it refuses any image but a lossless WebP, naming what it was given, so a remote store receives the WebP and runs no codec. A read checks the image's header against the sidecar and refuses a `.webp` holding a PNG or a lossy WebP, or an `image` format it does not know, as damage. Captures and the render cache stay PNG; a report's before image is the baseline as it was kept, so `.before.webp` beside a WebP baseline, attached as `image/webp`. The sidecar records `"image": "webp"`; a baseline kept as a `.png` before has no such field, stays readable, and its next accept replaces it. A WebP holds at most 16,383 pixels on a side, so an accept refuses a larger image and writes nothing. A `sharp` upgrade that brings a new libwebp can write different bytes for the same pixels, so a baseline rewritten after it shows in git as a changed file whose pixels did not. `createLfsStore` tracks `*-*.webp` by default and leaves an existing `*-*.png` entry in place; a `pattern` you set yourself must end in `.webp` or `*`, or the store refuses to open. `doctor --baselines` and the carried pathspecs count both extensions. `@variance-authority/png` reads WebP without an addon through libwebp's WebAssembly decoder and adds `decodePortable`, `imageFormat`, `refuseUnkept`, `isLosslessWebp`, `refuseOversize` and `KEEP_LIMIT`; its decoders read either format by the bytes' header, `imageSize` replaces `pngSize`, `diffImage` is now async — it resolves to its PNG, since either side may be a WebP — and takes an optional decoder, `changeImages` takes decoded images rather than bytes, and `@variance-authority/png/header` reads a header without loading a codec. `@variance-authority/store` exports `KEPT`, `KeptAs` and `isKeptImage`, and a path template that ends in `.webp` is refused like one ending in `.png`. The tribunal worker labels each image by the format its bytes declare.

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

- 4c2e4a7: A colour change of more than 1% is a change

  The default policy counted a pixel only when its colour changed by more than 10%
  of the largest difference `pixelmatch`'s YIQ metric measures, which is
  `pixelmatch`'s own default. At 10%,
  a border colour changed from `#2f3437` to `#3a4043`, or an accent from `#ff4a19`
  to `#ff6a19`, reported `unchanged` on every story it painted. `DEFAULT_POLICY` now
  uses `threshold: 0.01` and still forgives antialiasing. A subject whose colour
  changed by between 1% and 10% since its baseline reports `changed` on its next
  run. Stored baselines are not re-keyed.

  The reason for a green verdict now gives the pixels the default policy forgave,
  when the strict policy counted any: *no pixels differ beyond the tolerance of the
  default policy, which forgave 37 pixels as antialiasing or as a colour change of
  at most 1%*. The same clause follows the reason for every `ignored` verdict. It
  replaces `; 37 pixels differ with antialiasing counted`, which named
  antialiasing for pixels that the colour threshold had forgiven.
- 4aa7b16: Content inserted into a page is the inserted rows, not everything under them

  Two images of the same width are compared row by row after their rows are
  aligned: each row is hashed, runs of equal rows are one token, and Myers finds
  the shortest edit between the two sequences. Each after row is then compared
  with the before row that shows the same content, and `pixelmatch` still judges
  every pairing; a row that moved, came or went is a change in itself, so no
  pairing makes a page read as unchanged. A section added to a long page marks that
  section, and the content it pushed down matches. A pairing is kept only when it
  leaves fewer pixels differing than position does, a row it leaves unpaired
  charged in full, so a line that changed in place is not shifted against its
  neighbours. The rows a gap grew by are inserted, as the rows it lost are
  removed, so a button whose padding grew has a region where it grew. Images of
  different widths, or an edit longer than 2,000 runs of rows, are compared
  position by position on the union box, as before.

  An inserted row is marked edge to edge, since nothing says where its content
  begins, so a region inside one is joined by its rows rather than its area: to
  the tightest box whose rows span it. `attributeRegions` takes the inserted rows
  as `inserted`. Joined by area, every such band went to the subject's root, and
  a card whose button grew named the card rather than the button.

  `RasterComparison.alignment` carries the pairing as `RowAlignment`: the after
  rows `inserted`, the before rows `removed` with the after row they left from,
  and the rows `shifted` with how far. A comparison without it was not aligned.

  Content that moved is a change. A gap that grew in one place and shrank in
  another moves what lies between them and leaves the page as tall as it was, and
  every moved row matches the row it came from; such a subject reports `changed`,
  never `unchanged` or `ignored`. The reason names the edit:
  *120 pixels differ across 1 region; 3 pixel rows inserted in 1 place, moving
  the content under them by up to 3 rows, and the subject resized from 40×5 to
  40×8*. The Playwright fixture's evidence now writes a diff for a subject that
  resized, drawn on the after image.
- 27ab269: The change image shows before beside after, labelled, the change marked on both

  The change image stacked before, after and a red pixel difference one under
  the next, so a reviewer had to find a reflowed paragraph by comparing panels a
  screen apart, and the red covered every line the paragraph pushed down.
  `changeImages` now lays each window out as its before beside its after, row for
  row through the alignment, with striped filler opposite rows only one side has.

  The sheet reads as one picture. Every window is cut as wide as the widest,
  framed, on a neutral canvas with a margin around and between the windows. A
  window's top and bottom move out of any line of text they would cut. Each column
  is labelled `Before` or `After`, beside a red or a green dot, and a new optional `labels`
  argument sets the subject over both and where each side came from beside its
  label; the CLI passes the subject's id, `baseline` and `this run`. The text is
  Inter, drawn from glyphs the package ships, under the SIL Open Font License 1.1
  in `glyphs/inter-LICENSE.txt`.

  What changed is washed in red on the before and green on the after, with an
  edge of the same colour just outside it, widened to the space either side of
  the words it starts and ends in, so it covers no neighbouring letter. Rows that
  only moved are not marked on the panels: a blue arrow in the gutter runs beside
  them, its head the way they went. A run of identical rows — a blank gap, or the plain inside
  of a box — that grew or shrank by more than a row gets a window while the changes leave one free, and a blue line across the
  gutter instead of a mark; one that changed by a single row is rounding and is
  left out.

  `AlignedRows`, exported from `@variance-authority/png/mask`, carries two more
  required spans for this: `grown`, the inserted rows that only repeat a run of
  identical rows that got taller, and `shrunk`, the removed rows such a run lost.
  Code that builds an `AlignedRows` itself has to supply both.
- 4aa7b16: The pull-request comment shows each change at full size

  The comment showed a changed subject as its whole before and after images side
  by side at half the comment's width, so on a long page the change was a few
  pixels tall. `changeImages` in `@variance-authority/png` cuts a window around
  each changed region and each removed span, with 32 rows and 48 columns of
  context and at least 320 pixels wide, and lays the three heaviest windows out as
  before, after and the difference, one window under the next. The before panel is
  read through the row alignment, so it shows what the after rows replaced,
  removed rows included.

  `variance run` writes it beside the before, after and diff images as
  `<subject>.change.png` and names it in the report as `images.change`. The comment
  embeds that one picture at its own size when the report names it, and the whole
  before and after pair otherwise; the image refs carry the same picture, and the
  comment's text does not grow.

### Patch Changes

- 18c70d3: A run collects in parallel by default, and the report says where each subject's time went

  Without `workers` in the config, a run collected in one browser world, so a
  route suite read its pages one after another on any machine. It now collects in
  half the machine's logical cores, at least one and never more worlds than there
  are files: two on a 4-vCPU CI runner, eight on a 16-core laptop. A `concurrency`
  you set holds it lower, since every world keeps a page and a subject in flight.
  A `workers` you set still wins over both. Set `workers: 1` for a server under
  test that cannot take concurrent pages. A collector with no `openWorker` still
  collects in one world, and the run warns about it only when you set `workers`. Verdicts and the order
  of observations do not depend on the count, and the report's new `workers` field
  records it. `variance collect` takes the same width.

  A changed subject read in a second world is now run alone like one read in the
  first. A worker opens no clean world of its own, so the run asked the worker and
  reported "not re-run alone: collector has no `collectAlone`"; it now asks the
  collector that can open one.

  The `alone.limit` budget now goes to the first subjects to change in the order
  the run takes them. It went to whichever changed subjects reached it first, so
  with more changed subjects than the limit, which ones carried `again` and
  `alone` evidence depended on the number of worlds and on timing.

  Each observation in the report also carries `steps` beside `costMs`: every
  phase the subject went through, in the order it ran, with its wall time. The
  collector's phases are named `collect.*` (`collect.navigate`,
  `collect.wait-for-fonts`, `collect.capture`), the run's own are `compose`,
  `inspect`, `settle`, `baseline`, `cache.get`, `cache.put`, `decode`, `compare`,
  `write`, `again.collect` and `alone.collect`, and a painted subject adds the
  renderer's under `render.*`. The report's `steps` sums each phase over the
  subjects that ran it and counts them. A phase a subject skipped is absent, not
  zero. Timings are part of no digest, so images, records and baselines do not
  move when only timing does.

  `settleRecipe`, `stabilizeForObservation`, `compareRasters` and the raster
  `Renderer.render` take an optional step clock and report the steps they ran on
  it. The route page agent and `readRoute` always return the steps they took.
  `stepClock`, `timeOn` and `totalsOf` are exported from
  `@variance-authority/core/format`.

  A run that is not sharded now reads the mainline's subject costs at every
  width, as a sharded run always did, and takes its slowest files first. One
  world takes its subjects in the same order as several, so the budget above
  reaches the same subjects.

  `concurrency` is split evenly across the worlds and rounded up, at least one
  per world, so by default the raster tier is as wide as the number of worlds.

  The frame above a subject carries its classes in code-unit order. Storybook
  swaps its layout class on a page it reuses, so their order said which story the
  page showed before, and a run in parallel lanes gave the same story a different
  document, and a render-cache miss, with the same pixels.
- 665cb38: Rows under a long edit pair with the rows they moved from

  The row alignment gave up when the shortest edit between the two pages passed
  2,000 runs of rows, and the comparison fell back to position: every row under
  the edit sat against whatever used to be at its height. The edit counts every
  change on the page, not only the largest, so a section rewritten and lengthened
  on a 28,519-row documentation page, with a few lines reflowed further down,
  went past it. The comparison reported 2,766,418 pixels, and the crops showed
  the before and after panels holding different sections of the page.

  Past that bound the two row columns are now split where they agree on a run of
  identical rows that occurs once on each side, as patience diff does, and each
  stretch between two such runs is aligned alone. The rows an edit only moved pair
  with their shifted partners and the crops show the same content on both sides.
  A stretch that shares no such run, or that the split reaches after spending as
  much work as the search may, is compared by position within it, and the pairing is
  still kept only when it leaves fewer pixels differing than position does.

## 0.15.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

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

### Minor Changes

- faec91c: The difference mask is computed on the review page, not uploaded

  A mask is new bytes by definition whenever anything moved, so it is the one image
  content addressing can never deduplicate: `before` is always a hit and an
  unchanged `after` is a second copy of a baseline, but a mask matches nothing and
  never will. `variance push` now leaves it at home. The review surface holds both
  captures and makes its own when a reviewer opens the difference — through the
  same function, at the same policy, so the two cannot disagree about a threshold,
  an anti-aliasing rule, or what a grown capture does to the union box. Builds
  pushed by earlier versions kept a mask and are still served it.

  Runs are unchanged: the report still writes a diff PNG, because that is the
  picture a developer opens without a deployment, and a deployment is optional.

  `@variance-authority/png` gains a `./mask` subpath — the padding rule and the
  difference, over pixels somebody else decoded — so a caller holding RGBA reaches
  the arithmetic without a codec, and a bundler following it finds no `pngjs`.

### Patch Changes

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

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

First release.
