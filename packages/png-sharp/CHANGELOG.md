# @variance-authority/png-sharp

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

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

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

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

First release.
