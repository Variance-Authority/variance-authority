# @variance-authority/dom

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
- 4aa7b16: A page styled with Tailwind v4 renders at the height the browser laid it out at

  The capture keeps only the style rules that can match the subject, and five
  ways of losing one, or its place in the cascade, made the render shorter or
  taller than the page. On this project's own site the home page painted 1,486
  pixels short and reference pages up to 7% tall; every page now paints within
  a pixel of its live height.

  - A rule written inside `:where()` or `:is()` reaches the element it names. Each
    rule was filed under the last compound of its selector, and for
    `:where(.docs-content h2)` that compound was read inside the arguments, as
    `.docs-content`, so the rule was never tested against an `h2`. A rule is now
    filed by the compound outside any arguments or attribute values, and an
    escaped character in a class or id, `\+`, the hex escape in `.\32 xl\:p-4`
    or the `\#` in `.accent-\[\#ff4a19\]`, is part of the name.
  - A shorthand whose value holds a `var()` is carried under the name it was
    declared with. Chromium leaves such a shorthand's longhands empty until the
    value is substituted and answers only for the shorthand, and the capture
    recovered only shorthands from a fixed list, which held neither
    `padding-block` nor `padding-inline`: Tailwind v4's `py-*` and `px-*`.
  - A rule keeps its cascade layer. A rule read out of `@layer base { … }` was
    ranked by specificity alone, so the preflight's `h2 { font-size: inherit }`
    beat an unlayered `:where(.prose h2) { font-size: 1.65rem }`. The render
    document now declares the page's layer order and writes each rule back into
    its layer.
  - The values the subject inherits no longer override the root's own rules.
    `assemble` placed them on `:root`, where they beat a carried
    `html { line-height: 1.5 }` with its computed `24px`, and every line below the
    root that set only a font size was laid out 24 pixels tall. They now sit in a
    cascade layer of their own, below every rule the document carries.
  - A body the page styles in a cascade layer keeps its padding, and the subject
    is as wide as the box it sat in. The render's reset of the page margin was
    unlayered, so it beat a layered `body { padding-inline: 20px }`, and the
    container width carried was the parent's border box, so the subject painted
    40 pixels wider than it was laid out. The reset now sits in the inherited
    values' layer, and the width carried is the parent's own `width`, written
    back on the same box in its own box sizing.

  A document captured from a page styled any of these ways changes its digest
  once, and its baseline renders again on the next run.
- 81e77b6: An image shown through an object URL is painted, and acquired the same way twice

  A page that computes an image (a canvas encoded to a blob, a dropped file, a
  response read as a blob) shows it through a `blob:` URL, which names memory in
  that page alone. The render document carried the URL, so the deferred renderer
  painted a broken image where the page showed a picture. The URL's uuid is new on
  every load, so one picture was also two documents, and a settled subject was
  painted again on every run.

  `acquireDocument` now reads each `blob:` URL the document carries, in an
  attribute that names a file (`src`, every `srcset` candidate, `poster`, `data`
  on `<object>`, `href` on SVG's `<image>` and `<use>`) or in a `url()` of an
  element's `style`, a `<style>` in the subject, a rule the subject is painted
  with, a value it inherits, or a box it sits in, and writes its bytes into the
  document as a `data:` URL. An object URL that cannot be read, such as one
  revoked after the image loaded, keeps its URL and is reported as an
  `unreadable-object-url` error, which holds the run open. Under a host that
  paints nothing, such as jsdom, it is a warning, since no page there showed the
  picture.

  A `srcset` is now read by HTML's rule, where a URL is a run of anything but
  ASCII whitespace and a descriptor's parentheses close at the first `)`.
  Splitting on every comma cut a `data:` candidate in two, and `referencedAssets`
  listed the second half as a file next to the page; a no-break space inside a
  URL, and a comma after a parenthesised descriptor, are now read as HTML reads
  them too, so the asset key of such a `srcset` changes.
- 98d19d2: A subject set in a web font is painted in it, and a change to the font file changes its key

  Pruning kept only the rules that match an element, and an `@font-face` matches
  none, so a render document named a family it never declared and every render
  painted the fallback. `acquireDocument` now carries each face whose family
  appears in a computed `font-family` inside the subject or in a box its
  frame generates, such as `body::before`, with its `url()`s
  rewritten against the page, and `referencedAssets` adds the face's files to the
  asset key. A face the subject is not set in is still pruned. Under jsdom, which
  drops a face's `src`, the face is not carried and `acquireDocument` reports
  `unreadable-font-face`.

  The Playwright renderer paints a document on `about:blank`, where a face its
  page served from its own origin is a cross-origin font that the browser refuses
  without CORS headers. For a document that is not resource-closed and carries a
  face, the renderer now fetches font requests itself and answers them with
  `access-control-allow-origin: *`, as it already does for a closed document.

  Baselines of subjects set in a web font move on the first run after upgrading:
  the image is painted in the face rather than the fallback, and the key holds
  the face's file. Review them and accept them once.

## 0.15.0

### Minor Changes

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
- 1a0b845: A subject is read with nothing hovered, nothing focused, motion reduced and `Date` fixed

  Every layout and raster baseline made before this release is compared under a
  moved recipe once; a semantic baseline, read in jsdom, does not move. The
  default recipes gained tricks, so the stabilization digest every reading records
  has changed, and each subject names that recipe as the cause of whatever it
  reports. Review the changes and adopt them with `variance accept --all`, as for
  any recipe change.

  The standard collection recipe now also holds:

  - `no-hover`: the pointer is moved to `(-1, -1)`, off the page, once per page
    before it loads. On the `variance` fixture's page it is moved again before
    every observation, a frame each, and not put back: a menu a script opened on
    hover is closed for your test's next step.
  - `no-focus`: whatever holds focus is blurred before the subject is read,
    including an element inside a shadow root. On a page your test or agent goes
    on using, focus goes back to that element once the reading and any screenshot
    of it are taken, so a test types where it left off. The blur still ran the
    page's blur handlers, and what they did, such as a validate-on-blur error,
    stays.
  - `reduced-motion`: the browser reports `prefers-reduced-motion: reduce`, which
    stops the script animations of a page that honours it, and the reading
    declares the same preference among the conditions its `@media` rules are
    resolved against. A `prefers-reduced-motion` condition you declare through
    `createHarness`'s `features` wins, and the browser is asked for that value;
    a declared `no-preference` is not recorded as `reduced-motion`. Rules under
    `@media (prefers-reduced-motion: no-preference)` are not read by default;
    leave `reduced-motion` out to read them.
  - `freeze-clock`: `Date` reads one instant. A script added before the page's
    own replaces `new Date()`, `Date()` and `Date.now()`, and gives the same
    instant to `Intl.DateTimeFormat`'s `format()` and `formatToParts()` called
    without a date. Timers, animation frames and `performance.now()` are the
    browser's own, so a page that settles on a timer still settles. No Playwright
    clock is installed, so `page.clock` stays yours, and a clock your test
    installs replaces the fixed `Date`; the reading still records `freeze-clock`,
    so leave it out of the list when your test owns the clock. `Temporal.Now` and
    `Date` inside a worker are not fixed. The default instant is in the past, and
    the browser's cookie store keeps real time: a cookie your page's script sets
    with an expiry counted from `Date.now()` is already expired and is not
    stored, so a dismissed consent banner can come back after the next
    navigation. Set `varianceNow` or `now` near today, or leave `freeze-clock`
    out.

  The render and layout recipes gain `no-focus` alone, because a painted document
  still honours a collected `autofocus`. The other three have nothing to act on
  there: the date the page printed is already text in the document, and its
  `@media` rules were resolved when it was read. A `<script>` inside a subject
  root is carried into the render document and runs there under the real clock.
  Every document is painted under the render recipe, so a reading taken without
  `no-focus` is still painted blurred.

  The instant defaults to `DEFAULT_NOW`, `2024-06-15T12:00:00.000Z`, exported
  from `@variance-authority/core/format`. `routeCollector` and
  `storybookCollector` take a `now` option to choose another. It must be an ISO
  8601 instant with its zone; anything else is refused before a browser opens.
  An instant other than the default is spelled in the clock's id,
  `freeze-clock@<instant>`, so it is part of the environment key, and a baseline taken at one instant is compared
  with a run at another with the moved instant named as the cause.

  To read a subject hovered, focused, animated or at the real time, pass your own
  `stabilize` list without that trick: `DEFAULT_STABILIZE`, the ids of the
  default recipe, filtered, as in
  `DEFAULT_STABILIZE.filter((id) => id !== 'freeze-clock')`. It is exported from
  `@variance-authority/core/format`, `@variance-authority/route-collector`,
  `@variance-authority/storybook-collector` and
  `@variance-authority/playwright-test`. `storybookCollector` and `observe` in
  `@variance-authority/playwright-test` now take `stabilize`, as `routeCollector`
  already did.

  A trick needs a browser driver to apply it, and is recorded only where one did.
  The collectors apply all four. So does the `variance` fixture in
  `@variance-authority/playwright-test`: it sets `reduced-motion` and
  `freeze-clock` on the `page` it hands your test, before the test body runs, and
  takes the pointer off the page and releases focus before every observation,
  giving focus back after it. Two new fixture options, `varianceStabilize` and
  `varianceNow`, choose what it sets and the instant, and are set with
  `test.use`; `varianceDriven` holds the ids it set. A fixed `Date` stops code
  that times itself with `Date.now()`: a debounce or a throttle, such as lodash's
  `debounce`, sees no time pass and never fires, so a test that types into a
  debounced search box can stop getting results after this upgrade. A loop that
  waits for `Date.now()` to pass a mark hangs the page, an animation timed by
  `Date`, such as jQuery's `animate`, never calls its `complete`, and a client
  that checks a token's `nbf` or `iat` against `Date.now()` can refuse a token
  issued today. None of these failures names the clock. Leave
  `freeze-clock` out for such a test, and for one that sets `page.clock` itself:

  ```ts
  import { DEFAULT_STABILIZE } from '@variance-authority/playwright-test';

  test.use({ varianceStabilize: DEFAULT_STABILIZE.filter((id) => id !== 'freeze-clock') });
  ```

  On a page the fixture never handed your test,
  such as one opened from your own browser context, call the new
  `driveBeforeTest(page)` before `page.goto()` to set the same two; `observe` and
  `createVariance` there apply `no-hover` and `no-focus`.
  `@variance-authority/vitest-browser` reads from inside your page and has no
  driver; `@variance-authority/presentation` reads through the Playwright `Page`
  you hand it, a test's or an agent's live browser, and does not drive it. Both
  apply `no-focus` only, giving focus back once the reading is taken. A trick left out is absent from the
  reading's ids and digest, as a trick a tier cannot reach already is.
  `stabilizeForObservation` in `@variance-authority/dom` takes `driven`, the ids
  your driver applied, and returns `refocus()`, which gives focus back to the
  element the reading released. `stabilizeAsRequested` takes the recipe by id, as
  a page agent receives it. `createHarness` in `@variance-authority/playwright`
  takes a `stabilize` recipe to drive its page before the first navigation, and
  reports the ids it applied as `driven`. `createObservedHarness` opens one with
  `observeNetwork` started before its first navigation, as both collectors do.

  `createPlaywrightRenderer` no longer couples `no-focus` to `waitForFonts`:
  `waitForFonts: false` turns off the waits alone.

  `@variance-authority/core/format` exports `DEFAULT_STABILIZE`, `DEFAULT_NOW`,
  `driveBeforeLoad` and `driveBeforeRead`, which apply the driver tricks to a
  Playwright `Page`, `forDriver`, which drops the ones a host did not apply,
  `featuresOf`, which declares the motion preference a recipe drove, and
  `recipeToDrive`, which resolves a `stabilize` list and checks `now` before a
  browser opens.
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

### Patch Changes

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

- f800342: Ask a stylesheet's owner optionally, so a DOM that answers `undefined` instead
  of `null` is indexed rather than thrown at. jsdom below 26 leaves `ownerNode`
  unset on every sheet it parses, and the stabilization-sheet check dereferenced
  it behind a `!== null` guard — so the first page carrying any stylesheet failed
  with a TypeError out of a private module instead of returning a snapshot.
