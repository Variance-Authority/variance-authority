---
'@variance-authority/core': minor
'@variance-authority/dom': minor
'@variance-authority/playwright': minor
'@variance-authority/playwright-test': minor
'@variance-authority/route-collector': minor
'@variance-authority/storybook-collector': minor
'@variance-authority/cli': minor
'@variance-authority/vitest-browser': patch
'@variance-authority/unit-test': patch
---

A page reads its clock in UTC and formats for en-US, not for the host

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
