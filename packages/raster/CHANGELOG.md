# @variance-authority/raster

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
