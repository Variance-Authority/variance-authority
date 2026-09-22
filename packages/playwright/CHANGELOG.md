# @variance-authority/playwright

## 0.5.4

### Patch Changes

- Updated dependencies
  - @variance-authority/core@0.5.4
  - @variance-authority/raster@0.5.4

## 0.5.3

### Patch Changes

  - @variance-authority/raster@0.5.3

## 0.5.2

### Patch Changes

  - @variance-authority/raster@0.5.2

## 0.5.1

### Patch Changes

  - @variance-authority/raster@0.5.1

## 0.5.0

### Patch Changes

  - @variance-authority/raster@0.5.0

## 0.4.1

### Patch Changes

  - @variance-authority/raster@0.4.1

## 0.4.0

### Patch Changes

  - @variance-authority/raster@0.4.0

## 0.3.0

### Minor Changes

- 3fdec67: The rasterization key stops reading the recipe

  `RenderIdentity` carries two digests over a render's inputs, and they overlapped.
  `stabilization` names the recipe by which tricks are present, so a trick that
  changes how it reaches the page is the same recipe and keeps the same digest.
  `rasterization` was digesting `{ type: 'png', ...recipeScreenshot(recipe) }`,
  which put the recipe's spelling into a second key that has no opinion about
  recipes — and the two then disagreed about whether anything had changed.

  0.2.0 is what that costs. `hideCaret` moved from `screenshot: { caret: 'hide' }`
  to a `caret-color` stylesheet, because the driver's caret switch writes `style`
  back onto every focusable element and the in-place path reads the DOM on both
  sides of a screenshot. Same trick, same id, and the images come out
  byte-identical — verified against a stored baseline from 0.1.1. Every baseline
  went `incomparable` anyway, over a key that moved for a reason no pixel could
  have shown.

  `rasterization` now covers what the machine decides and no recipe asked for:
  which engine, launched headless or not, with which ordered launch arguments,
  photographed into which format. The recipe's contribution reaches the image
  through `screenshot` exactly as before and reaches the identity through
  `stabilization`, once.

  The key therefore moves once more, and stored baselines are `incomparable`
  against this version — `accept` them and it stops happening. A run that reports
  `incomparable` is reporting correctly: an identity it cannot compare has never
  been a diff, and the verdict machinery behaved throughout. What was wrong was
  the key.

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

### Patch Changes

  - @variance-authority/raster@0.1.1

## 0.1.0

First release.
