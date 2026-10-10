# @variance-authority/vitest-browser

## 0.15.0

### Patch Changes

- 9bb6f47: An `incomparable` verdict names what differs, and a recipe change can be re-baselined

  The reason now names only the identity fields that differ between the baseline
  and this run, and says whether they are the machine (renderer, engine, platform,
  scale, fonts) or only variance-authority's recipe (the stabilization or
  rasterization digest). It used to print both identities in full and blame the
  machine either way. A refusal no longer says pixels are machine-bound and
  the two not comparable: it says nothing was compared because this tool
  compares images only within one identity, and that nothing measured whether
  another machine paints the same pixels. `incomparableBecause` and its `IncomparableSides` wording,
  whose `replaceable` says whether the reason may offer a re-baseline, are
  exported from `@variance-authority/raster` for a caller that writes the same
  sentence.

  When only the recipe differs, which an upgrade or a changed renderer option does
  on an unchanged machine, the run still paints each subject. The reason says
  whether the document is the one the baseline was painted from. If it is, only
  the recipe moved: review the images and adopt them with `variance accept --all`,
  or with `--update-snapshots` in Playwright or `--update` in Vitest. If the
  document changed too, the new image is a change no comparison has read, and the
  reason says so. Before, the run left no image, so `accept` had nothing to
  promote and the old baselines had to be deleted by hand.

  The refusal stands for another machine's baseline, for a side that recorded no
  recipe digest, and for an identity that differs in a field this version does
  not name: in each, nothing shows the machine is the same. `settle` takes the
  run's identity as an optional third argument, as before, and refuses a recipe
  re-baseline when it is absent.

  `variance accept --all` skips an `incomparable` subject unless its
  `signals.document` is `unchanged` and its `signals.identity` is `recipe`, names
  the command that adopts it alone, and
  exits non-zero as for any refusal; `variance accept <subject>` adopts it. A
  report written before the signal was carried is skipped too. In
  `@variance-authority/report`, `promotionOf` takes a `PromotionOptions` with
  `bulk` for that rule, `bulkSkips` answers the rule alone, and the refusal for a
  subject with no image now says the baseline is another machine's or cannot be
  shown to be this machine's. In `@variance-authority/playwright-test`,
  `--update-snapshots=changed` skips the same subject and `=all` adopts it;
  `VarianceRun` carries `overwriting`, set under `=all`.
  `@variance-authority/playwright-test` now depends on
  `@variance-authority/report` and asks `bulkSkips`, so the two cannot adopt
  different images. Deferred capture paints against an older recipe, so both flags
  have an image to adopt. In-place mode's `=changed` now also skips another
  machine's image, which it used to write over the baseline; `=all` still writes
  it, as naming the subject does.

  An incomparable observation from `@variance-authority/observe` carries
  `signals.document`, saying whether the document is the one the baseline was
  painted from, and `signals.identity`, `recipe` when only the recipe digests
  differ and `machine` otherwise, as `recipeOnly`, now exported from
  `@variance-authority/raster`, answers it. `signals.pixels` is optional,
  since no pixels were compared.
  TypeScript code that reads `Observation.signals.pixels` must now handle it
  being absent.

  `@variance-authority/vitest-browser` asks `bulkSkips` too, and now depends on
  `@variance-authority/report`: Vitest's `--update` reaches every selected test,
  so it skips the same `incomparable` subjects. It used to promote every candidate
  it painted, including another machine's image and a re-painted recipe whose
  document moved. A plugin declared `accept: true` still adopts them.

  `variance ask summary` prints a reason that several subjects share once, with a
  count, and lists the subjects under it, so an upgrade that leaves every subject
  `incomparable` reads as one line rather than one per subject. It groups the
  same way the pull-request comment does, through `byReason`, exported from
  `@variance-authority/report`.
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
- 55f1bc9: The Playwright and Vitest integrations keep the render cache out of the baseline directory

  The store the `variance` fixture opens, the store `createVariance` and `observe`
  open, and the store the Vitest plugin opens all paint into `renders/` in the
  checkout's cache, where `variance run` paints. Each one prunes that directory by
  the rules `variance run` applies: the fixture when a worker tears down, a
  `createVariance` session when it closes, once per process, and the Vitest
  plugin when the run closes. The baseline directory holds baselines only, so the
  `.variance/baselines/**/by-document/` line in `.gitignore` and a store built only
  to set `cacheRoot` are no longer needed: delete any `by-document/` directory
  left under your baseline root, since nothing prunes it there. A `store` you pass
  in is unchanged. Finding the cache reads the root `variance.config.json` the
  way `variance run` does, so a file that is not JSON, or a `cacheRoot` that is
  not a path, now fails the fixture and the plugin as it fails the CLI.

  `renderCacheIn(cache)` from `@variance-authority/store/durable` returns the
  `renders` directory inside a cache directory, so a store you build can share
  that cache and its bound. `cacheRootFor` from the new
  `@variance-authority/sense/cache-root` entry finds the checkout's cache without
  loading the rest of Sense. `@variance-authority/vitest-browser` now depends on
  `@variance-authority/sense` for it, which installs Sense's parser and resolver
  with the plugin; the plugin does not load them.

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
