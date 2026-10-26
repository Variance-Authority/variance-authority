# Reviewing `@variance-authority/playwright`

`playwright` is the browser half: a harness on one browser and one page, the
network observation that folds what was served into the environment key, and a
renderer that paints a `RenderDocument` under a `RenderIdentity`. The
collectors, `playwright-test`, `vitest-browser` and the CLI call it.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/playwright/`.

## Contracts

- **An unanswered asset refuses the read, for its own subject only.** An image,
  font or media request still open is named and the read refused, never taken
  without it; the next subject is not blamed, and a request is named only when
  the agent waited on it. Pinned by
  [src/network.chromium.test.ts](src/network.chromium.test.ts) › "refuses the
  read and names the image, rather than reading without it", "refuses only the
  subject that started it, not the next one on the page", and
  [src/acquire.test.ts](src/acquire.test.ts) › "passes on the failure of an
  agent that was not waiting on the wire".
- **No silent hole in the environment key.** Other bytes under one URL move the
  key; above `hashCeilingBytes` an asset is `size:<n>`, never skipped; a blank
  is in the key and the ledger. Written in [README › What the page was actually
  served](README.md#what-the-page-was-actually-served), pinned by
  [src/acquire.test.ts](src/acquire.test.ts) › "notices an asset served
  different bytes under the same URL".
- **What paints is in the identity, its spelling is not.** Engine, launch
  recipe, timezone and locale partition `RenderIdentity`; a recipe spelled
  differently does not. Pinned by
  [src/renderer.chromium.test.ts](src/renderer.chromium.test.ts) › "partitions
  identity by the browser rasterization recipe", "does not key rasterization on
  how a recipe spells a trick" and "serves a cached raster only to a renderer in
  the timezone and locale it was painted in".
- **A resource-closed document never reaches the network.** Pinned by
  [src/renderer.chromium.test.ts](src/renderer.chromium.test.ts) › "refuses queued
  HTTP and WebSocket egress from a resource-closed document".
- **Same content, same bytes.** A shot does not depend on what the page painted
  before, and the harness lays text out under the renderer's raster flags.
  Pinned by [src/harness.chromium.test.ts](src/harness.chromium.test.ts) ›
  "paints the same content to the same bytes after an edit and its revert" and
  "lays text out under the flags the renderer paints it with".
- **A declared engine that is missing throws**, naming it. Written in [README ›
  A run measures what it declares](README.md#a-run-measures-what-it-declares),
  pinned by [src/engines.test.ts](src/engines.test.ts) › "is all or nothing, and
  names what is missing when it is neither".
- **Each width is its own subject id.** Pinned by
  [src/viewport.test.ts](src/viewport.test.ts) ›
  "names each width apart, so a baseline filed by its name is one file per
  width".

## Not this package's

- Which subjects exist and how they mount: the collectors and their callers.
