---
id: TASK-9
title: Close resources on collector documents for deferred rendering
status: Done
assignee: []
created_date: '2026-08-20 08:05'
updated_date: '2026-08-20 08:12'
labels: []
dependencies: []
references:
  - 'https://www.browserstack.com/docs/percy/integrate/percy-sdk-workflow'
  - 'https://applitools.com/docs/eyes/concepts/test-execution/ultrafast-grid'
priority: high
type: feature
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A document a browser collector emits is serializable but not resource-closed, so
`gates.md` reports remote rendering as **conditional** on both Gate 1 (Percy) and
Gate 3 (Chromatic): the other machine needs equivalent access to the same URLs.
ADR-0044 already requires that a document advertised for later rendering carry
immutable bytes for every resource it needs, and `@variance-authority/unit-test`
proves the shape. The browser collectors have not adopted it.

The bytes are already in hand. `observeNetwork` reads every image, font, and
media body to digest it, then discards it. Closing over them is retention, not
new acquisition — the wire, which is the axis no competitor in the category
operates on, already sees exactly what the page received.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `observeNetwork` can retain the bytes it already reads, recording what was *served* rather than what was fetched
- [x] #2 A route-collector document can be emitted resource-closed, or refuse and name every resource it could not close
- [x] #3 A resource-closed collector document renders with the network blocked and produces the same pixels as the run that captured it
- [x] #4 Default behavior is unchanged: without the opt-in, documents carry digests and no bytes
- [x] #5 `gates.md` and the surface documentation report the resulting Gate 1 position accurately
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Retain served bytes in the interceptor behind an option; expose a closure result
that is either the resource map or the named reasons it cannot close; let the
route collector request a portable document and fail collection with those names
when it cannot; prove it by rendering the emitted document in a resource-closed
renderer with every network channel blocked; reconcile the gate documentation.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Carry-the-load increment 1 (frozen before edits)

Value: an adopter running the route collector can hand the emitted document to a
renderer on another machine — one with no access to their asset origin — and get
the same pixels the capturing run saw.

Current flow: `observeNetwork` routes `image`/`font`/`media`, calls `route.fetch()`,
reads the body, digests it into `assets`, and fulfills — serving a generated blank
PNG for a blanked image, truncated bytes for a frozen GIF, and the original bytes
otherwise. Both collectors spread `network.assets` into the emitted document as
digests. `document.resources !== undefined` is what marks a document resource-closed,
and the Playwright renderer then blocks every network channel and verifies each
resource digest before painting.

Constraint: the interceptor discards the bytes after digesting, so no collector can
make the portability claim its documents are otherwise shaped for.

Increment: add opt-in byte retention to `observeNetwork` keyed by what was served,
expose a closure result that is either the resource map or the named unresolved
resources, let the route collector emit a resource-closed document behind an option,
and prove the round trip through a real Chromium collection rendered with the network
blocked. Maximum scope: `packages/playwright/src/network.ts`, the route collector's
options and document assembly, their tests, and the gate/surface documentation rows
that state the resulting position. Storybook adoption reuses the same seam and is
explicitly out of scope for this increment.

Misfire: the archive records the bytes that arrived rather than the bytes that were
served, so a blanked image or frozen GIF renders differently later than it did in the
run that observed it; or closure silently omits a resource and the failure surfaces at
render time on another machine instead of at capture; or resources attach by default
and every existing collector document becomes resource-closed, blocking all network.

Containment: opt-in, default unchanged; a resource past the hash ceiling or whose body
could not be read refuses closure at capture and names itself rather than shipping an
unverifiable digest; existing `assets` digests and the non-closed document path are
untouched; the renderer's own digest verification remains the second owner.

Readback: a real Chromium route collection over a served page carrying an image, a
font, and a blanked image emits a document whose `resources` reproduce it; that
document renders in a renderer with every network channel blocked and yields the same
pixels as the capturing run; a resource that cannot be closed refuses and is named;
and the default path still emits digests with no bytes.

Learning owner: the closure result type, the refusal test, and the Gate 1 row.

Gate readback — PASS

`npx vitest run packages/route-collector/src/portable.chromium.test.ts` — 6
passed in real Chromium, over a `node:http` origin serving a page whose image is
referenced relatively. `yarn build`, `yarn lint`, `yarn check` (2563 passed) and
`yarn test` (175 files, 2250 passed) are green.

The decisive case shuts the origin server down and then renders: every weaker
form of the assertion passes while a cache or a live localhost route is quietly
still available.

Two mutations confirm the readback is not vacuous. Forcing `portable` to false
fails the closure and origin-gone tests. Truncating the retained bytes in the
built `network.js` fails three of six, including the archive-versus-origin pixel
equality — which the first mutation could not reach, because with retention off
both renders take the same live path.

Two corrections the implementation needed and the tests found the shape of:

`acquireDocument` never sets `baseUrl`, and the resource map is keyed by the
absolute URL the wire saw while the captured HTML holds the author's `/logo.png`.
Without a base attached, a closed document resolves against the renderer's own
location, requests nothing, trips no missing-resource refusal, and paints a hole.
`baseUrl: page.url()` rather than the planned address, so a redirect is recorded
where it landed. Attached only on the portable path.

A resource that cannot be read refuses at capture and names itself, because the
alternative surfaces hours later on a machine with no way to go and fetch the
missing byte. `portable` without `network` throws up front for the same reason.

Gate 1's deferred-render row moves from **conditional** to **yes**. Gate 3 stays
conditional and accurate: the Storybook collector reuses this seam but has not
adopted it, which was out of scope here.
<!-- SECTION:NOTES:END -->
