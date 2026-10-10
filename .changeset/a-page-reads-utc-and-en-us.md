---
'@variance-authority/core': minor
'@variance-authority/dom': minor
'@variance-authority/playwright': minor
'@variance-authority/playwright-test': minor
'@variance-authority/route-collector': minor
'@variance-authority/storybook-collector': minor
'@variance-authority/cli': minor
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

Both are part of the environment key, and the renderer's pair is part of
`RenderIdentity.rasterization`. A capture read in another timezone or language
is another environment, and an image painted in one is `incomparable` against a
baseline painted in another, with the reason naming `rasterization`, rather
than `changed`.

`@variance-authority/playwright-test` paints each test in the timezone and
locale its page runs in: whatever the Playwright project or `test.use` sets, and
the host's when neither does. `varianceRenderer` is now a test fixture, chosen
by the page, and `varianceRenderers` is the worker's set of renderers, one per
timezone and locale; a project that overrode `varianceRenderer` at worker scope
overrides it at test scope instead.

**Every image painted by the Playwright renderer reads `incomparable` once
after this upgrade**, because its recipe now carries the timezone and locale. A
subject whose render document is the one its baseline was painted from is
adopted in bulk; one whose document moved as well is not, and is named:

- With `variance run`: the run exits `1` with each such subject `incomparable`.
  `variance accept --all` adopts every subject whose document held. A subject
  it refuses, exiting `2`, is adopted with `variance accept <subject-id>` once
  you have looked at its image in `variance report --format html`. A rerun
  reports `unchanged`.
- With `@variance-authority/playwright-test`: the suite fails each
  `incomparable` test. `--update-snapshots=changed` adopts the ones whose
  document held; rerun any it skipped alone with `--update-snapshots=all` once
  you have looked at its image.
- With `@variance-authority/vitest-browser`: `vitest --update` skips what
  `variance accept --all` skips. Run a skipped test once with the plugin's
  `accept: true` and take the option out again.

`@variance-authority/vitest-browser` reads no `variance.config.json` and takes no
timezone or locale, so it paints in `UTC` and `en-US` whatever its tab ran in,
and neither it nor `@variance-authority/unit-test` writes a timezone or locale
to the environment key.
