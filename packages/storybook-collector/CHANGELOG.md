# @variance-authority/storybook-collector

## 0.21.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.20.0

### Patch Changes

- f0284c4: Include the configured loader chain in Rspack and Webpack source-map refusals, and explain how upstream transforms preserve their input maps.

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

- 402ce9f: A story's parameters are read when the story is reached, so no story file is imported before its story comes up

  Your Storybook run used to read every story's `parameters.variance` before the
  first story, through the preview's `extract()`. That imported every story file
  up front: on a large Storybook you paid for the whole build before seeing one
  story, and each file's first story then timed its import as 0 in `collect`.

  The run now plans from `index.json` alone. When it reaches a story, it asks the
  preview for that story's merged parameters, which imports only that story's
  file, the import showing the story would have made anyway. That import is
  charged to the story's `collect`, so the first story of each file carries what
  its file costs. A story that excludes itself is still skipped and listed in the
  report with its reason, and a story whose parameters cannot be read is read at
  your run's `viewport` with a warning naming it. A preview too old to read one
  story's parameters says so once per run, not once per story.

  A story that declares `widths` is still read as `<story id>@<width>` at each
  width, with its own baseline, and all its widths are read on the same page in
  one visit: nothing is opened, booted or loaded again for a second width. A
  run that does not read such a story, because `--subjects`, `--since` or a shard
  left it out, because its visit failed, or because its parameters could not be read, still counts its width baselines as
  planned rather than naming them as baselines your plan no longer holds. A
  story that excludes itself when it is reached holds no subject of the run, so
  every baseline it left, under its own id and at each width, is named. A
  shard prices the story at the sum of the widths its last visit read.

  If you write a collector, `collect` may now return a `Visit` instead of a
  `Collected`: every subject the visit to the planned one produced, each with its own
  result, each id the planned id or the planned id at a width (`<id>@<width>`),
  and any warnings the visit raised. A visit that could not learn every subject
  it realizes, such as a story read without its parameters, says `incomplete: true`.
  A visit that produced no subject is
  reported as a failed one, and so is a visit that produced any other id. The run and `variance collect` report each subject
  at the position the plan gave the planned subject, and evidence parts record
  the planned id as `of`; a merge refuses a part whose subject is neither. A
  `--subjects` glob that names one width, such as `*@375`, now reaches the story
  it comes from, and only a width suffix extends a story id: `button--primary`
  no longer reaches `button--primary-large`.

  `@variance-authority/core/format` exports `atWidth`, which writes a subject's
  id and name at a width, and `widenedFrom`, which reads the planned id back
  from a width id, and `realizes`, which says whether a visit to one id may
  produce another.

  `readParameters(page)` is now `readParameters(page, storyId)` and returns one
  story's parameters; the up-front read of every story is gone.
- d7f8b72: A story's execution record now says where the browser spent it, timed by the page: `prepare` for the preview's load, paid by the first story read on a document and 0 for every later one; `collect` for importing the story's file and unmounting the story before it; `cases` for the render through `afterEach`. `collectStory` returns them as `timing`, and `watchStoryTiming` starts the page's watch; the collector's page agent runs it.
- bd4243a: An image, font or media request still unanswered when the network wait runs
  out refuses the subject, naming the URL. The subject used to be read without
  it, with a `network-not-quiet` warning. `NetworkObservation.settle()` now
  resolves that refusal, or `undefined` once nothing is in flight; a caller that
  ignores it reads a subject whose bytes nobody hashed.
  Only the requests a subject started count against it: one still open from an
  earlier subject on the same page was named in that subject's refusal.
  One the read itself asks for and never gets makes `acquireFromAgent` throw
  `UnansweredAssets`, which both collectors turn into that subject's refusal.
- 8b189b9: Place the probes ahead of your transforms with `placement: 'before-transforms'`

  The probes go in after your transforms by default, so a compiler that reads
  syntax never reads one. That costs a second parse and the map back to each
  file. A unit-test run whose transforms only strip types or JSX can skip both:
  `placement: 'before-transforms'` places the probes in the file as read, with
  one parse and no map. It means the same on the Vitest, Jest and Rstest
  `withTestSelection`, on `testSelectionProbes` and `testSelectionRule`, and as an
  option of the Storybook addon. With Compiled, React Compiler or another compiler
  that reads syntax in the run, keep the default: nothing detects them for you.
- 7ff6d4b: Record what each story executed under Rspack and Webpack too

  Add `@variance-authority/storybook-collector` to your Storybook's `addons`, and
  the preview build carries the probes `tests` reads, whichever builder runs it:
  `testSelectionProbes()` under Vite, the `testSelectionRule()` loader under
  Rspack and Webpack 5. The probes go in after every compiler the build runs, so a
  Storybook built by Rspack with `@compiled/react` records its stories. The
  addon's options are the probes' own: `root`, `mode`, `include` and `placement`.

  The addon probes only the builds the collector records: `storybook build
  --test` and a dev server. Any other `storybook build`, the one a team
  publishes, gets nothing from it, so build the recorded Storybook with `--test`.
  The collector's `tests` is read in a later process, after the build, so the
  build cannot ask it; Storybook's own `--test` is how a build says it is for
  testing.

  Under Rspack and Webpack, where the build writes no source map the loaders can
  read, as `storybook build --test` does, the addon hands the loaders their maps
  and the build still writes no `.map` file. `devtool` stays as you set it.

  Storybook runs an addon's builder hooks before the ones in your `main.js`, so
  the addon places the rule from a plugin, once the config is final: a post
  loader your own `webpackFinal` or `rsbuildFinal` adds still runs ahead of the
  probes. If you added `testSelectionProbes()` or `testSelectionRule()` to the
  Storybook's builder config yourself, remove it and add the addon instead: a
  second one stops the build with "remove your testSelectionRule(); the addon
  places it", or the same of `testSelectionProbes()`, wherever the rule sits,
  in `oneOf` or nested `rules` too, and whether it names the loader by its path
  or as `@variance-authority/sense/probes-loader`. One your `vite.config` lists is
  kept, and the addon adds no second one; if the addon was also given a `mode`,
  `include` or `placement` that differs from it, the build stops and names the
  option. The Vite config `@storybook/addon-vitest` loads your presets for,
  inside Vitest, gets nothing from the addon. Under Rsbuild, an `rsbuildFinal` of
  yours that assigns `tools.rspack` outright, rather than adding to it, drops the
  addon's plugin, and the build runs unprobed.

  When `tests` is on and the preview has no probes, the run's stderr now says to
  add the addon and build with `storybook build --test`, where it named
  `testSelectionProbes()`. The `tests` option's documentation says the same.

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
- 0e77166: A Vite Storybook with a `.storybook/preview` file builds with the addon

  From Storybook 9.1 on, Storybook rewrites each `sb.mock(import('../lib/api'))`
  in the preview file to `sb.mock('../lib/api')` by printing the whole file
  again, with no map back to your lines, so `storybook build --test` stopped at
  the probes on any preview, whether it mocked a module or not. The addon now has
  that rewrite edit the file in place: `import(` and its closing parenthesis
  become spaces, every other character keeps its line and column, and the
  preview's decorators are recorded where you wrote them. Storybook 10 builds the
  same way. A Storybook that rewrites more calls than the edit in place makes
  stops the build with an error that names `storybook:mock-loader-preview` and
  the preview, rather than shipping a mock that no longer mocks.
- c3c8e61: An absolute `source.dirs` entry is walked

  Both collectors joined every `source.dirs` entry onto the working directory, so
  an absolute path such as `/repo/packages/ui/src` was looked for under that
  directory, matched nothing, and the run was refused for having no source files.
  An absolute entry is now walked as written, and a relative one is still resolved
  against the working directory. File names in the index stay relative to that
  directory either way. When no entry matches any file, the refusal lists each
  directory by the absolute path it walked, in place of the entries as spelled
  followed by `(from <root>)`.
- 52d87e4: A run starts one Chromium. Harnesses and the renderer lease one browser per launch recipe and the last to close it closes it, so a Storybook or route run with four workers launches one browser instead of five. A Storybook run's workers also share one browser context, and with it the HTTP cache: a worker's preview boots from what the first page fetched instead of downloading the bundle again (at four workers on the storybook case, 75 fetches and 29 MB became 17 fetches and 6 MB).

  New options: `createHarness({ warm })` opens the page in a context shared with other warm harnesses, `createHarness({ isolated })` launches a browser of the harness's own, and `observeNetwork(page, { cache })` watches the wire through the DevTools protocol with the HTTP cache left on (Chromium only). The `alone` reading in both collectors stays in a browser of its own.
- e6afc58: One recorder for every visual subject

  `@variance-authority/sense/journal` exports `createSubjectRecorder`, which keeps
  one row per subject of a visual run with the page and every head joined, and
  `driveJourneys`, the driver's listener, cookies and settling wait. The
  Storybook collector records through the first, the Playwright fixture through
  the second, so a story, a page and a test file record their journeys the same
  way.

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
- 3e6a370: A run's cases travel in its record

  The case index, the cases a run replaced and the run that replaced them are
  sections of `coverage.bin`, no longer a `coverage.bin.cases.bin` beside it. The
  one file is landed, layered, seeded, repinned, sharded and shared by the same
  rules and under the same lock as the coverage it was recorded with, so the two
  always answer for the same runs. A share, a seed or a fetch carries the index
  and drops the replaced cases and the run that names them, which belong to the
  machine that ran.

  A record that carries cases is format 10, and a reader that knows only coverage
  refuses it rather than misreading it. A record without cases keeps format 9. A
  `coverage.bin.cases.bin` left from an earlier run is not read; the next run
  writes its cases into the record.

  The `executionFile` option is removed from `withTestSelection`, the Jest and
  rstest seams, `startRecording`, the Playwright reporter and the Storybook
  collector, along with the JSON it could write. `decodeExecutionIndex`,
  `readExecutionIndex`, `variance covering --against`, `variance review` and
  `distill --execution` read the index out of a record; JSON stays readable as
  the spelling a foreign tool supplies. `landCaseIndexes` is replaced by
  `landCases`, which returns the sections for the record you write, and
  `lastCaseRunOf` reads the run they name. `caseLayerFiles` and
  `executionIndexBytes`, which named and read the file beside the record, are
  removed. `CaseSections`, `caseSectionsAt`, `caseSectionsOf`, `caseIndexOf`,
  `recordedCases`, `withCaseSections`, `keepsCases` and `sharedRecord` read and
  write the sections.
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
- 4799688: The checkout says what the probes meant: no build writes module records

  A probe names the file it was placed on and the digest of that text,
  `path@digest`. When a run is folded, each module the journals name is cut again
  from the file in the checkout. A file whose text still matches is read on its
  own regions; a file that has moved on since the build reads as one whose reach
  is not known, which selects every test that entered it; a file that is gone
  counts the same way. Nothing is written beside the build, and nothing under the
  cache's `test-selection/<key>/<label>/` is read.

  Breaking:

  - `testSelectionProbes()` takes no `cacheRoot`. Its `label` names the journey
    head and nothing else.
  - `recordExecution()` takes no `label` and no `heads`.
  - The Jest journeys options (`withJourneyCoverage`) take no `heads`.
  - `jestStore` is removed from `@variance-authority/sense/jest`.
  - `instrumentModule(code, file)` takes no options: call it first, on the file as
    it is on disk.
  - A journal names a module by `path@digest`. A driver that writes its own
    journal builds the id with `moduleId(path, code)` from
    `@variance-authority/sense/journal`.

## 0.14.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.13.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.12.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.11.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.10.0

### Minor Changes

- 486caa3: Declare the test suites your repository runs, each with its kind, under `suites` in the root `variance.config.json`: `{ "suites": { "unit": { "kind": "unit" }, "stories": { "kind": "visual" } } }`. The kind is one of `unit`, `integration`, `e2e` and `visual`. Each declared suite records on its own, under `suites/<name>/` in the cache, with its case index and runs log beside it, so a run of one suite never replaces what another recorded. A worktree seeds each suite from the same suite in the primary checkout.

  Every recording integration takes a `suite` option: the Vitest, Jest and Rstest seams, `startRecording`, `recordExecution`, the Playwright reporter and `varianceExecution`, and the Storybook collector's `tests`. Once `suites` is declared, a run that names no suite, names one the file does not declare, or names both a suite and a `coverageFile` stops before it starts. A repository that declares no suites keeps its one record. `testCoverageFile` and `readableTestCoverage` take `{ suite, cacheRoot }` as their second argument, where they took a bare `cacheRoot` string, and `declaredSuites`, `parseSuites`, `recordFileFor`, `SUITE_KINDS` and `SuitesError` are exported from `@variance-authority/sense/test-selection`. The CLI refuses `suites` in a config file below the repository root.
- 3d15479: A Storybook run's recording times each story with the time the run spent on it

  The run hands its collector the time it spent on each subject, from the first collection to the decision, as the collector closes — `close(costs)`, where `costs` maps a subject id to whole milliseconds. The Storybook collector records that figure as each story's duration, on the story's row and on its case, so `variance ask slowest-tests` ranks stories by the same time `variance ask costs` reports and the next run shards on. A story read more than once is timed once, and a story the run did not time has no duration.

## 0.9.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.0

### Minor Changes

- 4250eda: Every run records which case entered each region. The `cases` option is removed
  from `withTestSelection` for Vitest, Jest and Rstest, from the Playwright
  recorder and reporter, and from the Storybook recorder: each writes
  `<coverage file>.cases.bin` beside the file-level snapshot, or `executionFile`
  when you name one. A test file that runs in a page is still recorded per file,
  and says so.

  Without `continuations: true`, a file whose cases overlap no longer fails the
  run. It is recorded as a whole, so a change it reaches runs every case in it, and
  the run names the two cases that were open at once.

### Patch Changes

- e4ee0da: The repository names its cache. Set `cacheRoot` in the `variance.config.json` at the repository root, for example `".variance/cache"`, and every command, every test runner integration and every function that takes a `cacheRoot` option uses that directory. The path resolves against the repository root. Without the key the cache is `$XDG_CACHE_HOME/variance-authority`, or `~/.cache/variance-authority`, as before, so an existing recording stays where it is. The key is read before the environment, so a sandboxed agent that sets `XDG_CACHE_HOME` to a temporary directory no longer splits the recording away from your own runs. [The cache](https://variance-authority.dev/docs/cache) page describes the location, what is in it, worktrees and CI.

  `@variance-authority/sense` exports `cacheRootFor(root)`, which returns that answer, and `CACHE_CONFIG`. `defaultCacheRoot` is removed; call `cacheRootFor(root)`. A `cacheRoot` option now names the variance-authority directory itself, and `test-selection/` is created under it. `testCoverageFile`, `seedTestCoverage`, `readableTestCoverage`, `moduleNamesFile`, `openModuleNames`, `recordStore`, `recordStores` and `repositoryLayers` take an optional `cacheRoot`. An empty or relative `XDG_CACHE_HOME` is ignored rather than resolved against the working directory. A root `variance.config.json` that is not JSON, or whose `cacheRoot` is not a non-empty string, is an error.

  `@variance-authority/cli` accepts `cacheRoot` in the config and in the schema, and refuses it in a `variance.config.json` below the repository root. `variance run`'s render cache and suite indexes are under it. `renderCacheRoot` and `suiteIndexPath` take the config.

## 0.7.0

### Patch Changes

- 8ae7195: A relative `coverageFile` or `executionFile` is read from `root`

  The Vitest, Rstest and Jest integrations resolve these two paths from their own
  root. The Playwright reporter and the Storybook recorder resolved them from the
  root of the repository instead. In a workspace, where `root` is a package
  directory, that caused two problems:

  - The Playwright workers staged their results beside one coverage index, and the
    reporter merged them into a different one.
  - A run where the fixture merged for itself, without the reporter, wrote its
    execution index to a third place.

  Both paths are now read from `root`, as the fixture already read `coverageFile`.
  An absolute path is unchanged.
- 17d7f7e: A story file is recorded under its path in the repository

  Storybook writes each story's `importPath` relative to the directory it ran
  in, with a `./` in front. The recorder resolved that path against the
  repository root. In a workspace, where Storybook runs in a package directory,
  this had two effects: the story file's precondition read a file that does not
  exist and was dropped without a message, and the per-story index named a path
  no diff contains. So a commit that edited only a `.stories` file selected none
  of its stories.

  The recorder now resolves `importPath` from `tests.root`, which defaults to the
  current directory, and records the path relative to the repository root.

## 0.6.0

### Minor Changes

- 16f6dd6: Recorded file names are relative to the repository root

  The Jest, Vitest and Rstest wrappers, the Playwright reporter and the Storybook
  collector now name every file relative to the root of the git checkout the run
  starts in. Before, when the config was inside a package, file names were
  relative to Jest's `rootDir` or Vitest's `root`. A recording made from
  `packages/cart` said `src/cart.ts` where a diff says `packages/cart/src/cart.ts`,
  and the two never matched. `rootDir` and `root` still resolve the config and the
  relative paths in its options. Outside a git checkout, names are relative to the
  directory the run starts in.

  A recording that an earlier version made from a package-level config uses the
  old names, so record it again. `repositoryRoot`, exported from
  `@variance-authority/sense/test-selection`, returns the directory that file
  names are relative to.

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

- 8efba76: A run that changed ten files stops rewriting the whole selection index

  Every run after the first reads the selection index, lays its own recording over
  it, and writes it back. At a repository's scale almost all of that was spent
  making objects nobody reads: a run that re-records ten modules of twenty thousand
  decoded six hundred thousand regions into a model, merged ten of them, and
  encoded the model back — the other 99.95% of the index materialized and
  re-serialized to arrive at the bytes it was read from.

  `layerTestCoverage` does the merge and the encode as one pass over the columns
  the previous snapshot is already stored in. A module the run did not touch is
  never made an object: its rows are copied column to column as integers, its
  strings blob to blob as bytes, and the only thing that happens to either is the
  renumbering the new dictionary implies. Objects are made for what the merge has
  to reason about — the tests, the modules this run re-recorded, and the carried
  modules whose text moved on disk. Over twenty thousand modules that is 1855 ms to
  616, and it is byte for byte the same file, which a gate asserts across every
  case the merge distinguishes.

  The columns are now zstd rather than brotli, at two levels, because the runs are
  two kinds of data. A varint run is a dense stream of small integers and answers
  to a long search; a run of the string blob is file paths and hex digests, which
  zstd finds most of at level 1 and nothing more of above it. Against the brotli
  quality 4 it replaces, over the same snapshot: 319 ms to compress became 120, and
  the file got 86 KB smaller.

  `zlib.zstdCompressSync` arrived in Node 22.15, so that is the floor these
  packages declare. The snapshot's layout version moved with the codec, which means
  an index written by an earlier build is refused at its header and rebuilt — one
  full run, and nothing a reader has to think about.

### Patch Changes

- e546e21: Where the JSX settings live under Vite 8

  Vite 8 transforms with oxc, so `esbuild: { jsx, jsxDev, jsxImportSource }` becomes
  `oxc: { jsx: { runtime, development, importSource } }`, and `esbuild.keepNames`
  becomes `build.rolldownOptions.output.keepNames`. A config keeps whichever keys it
  is given and reads only the ones its own major knows, so the wrong block is not an
  error, not a warning and not a log line: the plugin installs, the bundle runs,
  every subject renders, and every report names the line a component is declared on
  instead of the line that wrote the element. It fails in the direction that looks
  like it worked.

  The `jsx-source` README carries a table of where the two settings live per
  transform, both spellings on every copyable snippet, and the reminder to read
  `provenanceOf`'s result rather than the config — the config cannot tell you.
  `storybook-collector` gets the same for `keepNames`, on the symptom it produces: a
  confident report naming a component that appears nowhere in your source.

## 0.1.1

### Patch Changes

- db08866: Keep the run when the execution journal cannot be recorded.

  `close()` already held the position that a journal is not the artefact under
  review: a recorder that declines to record is written to stderr and the run
  continues, because failing the run over it would cost every subject in it the
  baselines it just captured. Only the declining half was handled. A throw out of
  the same call — `duplicate test coverage observation` was the one reached in
  practice — went straight up through `close()` and took the run down with it.
  Both outcomes now end the same way, in a sentence on stderr and a run that keeps
  its images.

## 0.1.0

First release.
