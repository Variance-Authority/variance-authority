# @variance-authority/route-collector

## 0.15.0

### Minor Changes

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

### Minor Changes

- fc59417: A subject id is what you type back, not what the build wrote

  Discovering routes from a directory of files gave `cart/empty.html` the id
  `cart/empty.html`, while the `index.html` beside it became `cart/`. A subject id
  is the name an operator types at `--subjects` and `variance accept`; carrying a
  file extension on one sibling and not the one next to it is a difference nobody
  asked for, and it made the ids depend on how the build chose to write the page
  rather than on which page it is.

  `.html` is now dropped from the id. The URL keeps it — that is what the server is
  actually asked for — and only the id changes. The root `index.html` still takes
  the id `/`.

  **Ids that move are baselines that no longer match.** A subject discovered this
  way under a previous version was stored under its `.html` id and will report
  `new` against the id without it. Accept the ids you meant and it stops happening;
  nothing is compared wrongly in the meantime, because an id with no baseline has
  never been a diff.

  **Two files that would answer to one id are now refused by name.**
  `cart/empty.html` and `cart/empty/index.html` both reduce to `cart/empty`, and
  whichever sorted last silently owned the baseline — the collector watched one page
  and reported the other. It exits `2` naming both files, and asks you to rename one
  or list the routes explicitly.

## 0.2.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

First release.
