# ADR-0044 — Capture material and rendering placement are independent

**Status:** accepted
**Date:** 2026-08-19
**Amends:** ADR-0010 (sub-renderer split), ADR-0011 (retention), ADR-0024
(a consumer knows one package), ADR-0043 (an extension does not own its host)

## Context

The engine already has two useful entrances and two useful rendering
placements, but the adopter-facing integrations hide that composition.

`RenderDocument` can be acquired from jsdom or a browser and painted by a local
or remote `Renderer`. `observeRasters` can compare images that already exist.
The Storybook collector always returns a document, however, and the Playwright
Test integration acquires from the suite's page only to repaint the document in
a second browser. The unit-test proof launches that second browser inside the
same Vitest process. Each route demonstrates a block, but none exposes the
choice between them.

That makes the package names look like pipelines: Storybook means collect here
and paint elsewhere; Playwright Test means collect here and paint in another
local browser; Vitest/Jest appears to mean a visual integration even though only
the low-level document acquisition exists. The result is a host-by-topology
matrix instead of one engine.

Established products demonstrate that the axes are independent. Argos composes
Vitest and Storybook lifecycle around one in-place Playwright screenshot
primitive. Applitools Grid and Percy Web acquire a document and resources once,
then render elsewhere. Their product choices differ; their shared lesson is that
the host supplies state and the capture primitive does not take ownership of the
host.

There is a correctness boundary hidden inside the document route. The present
`RenderDocument` is serializable, but its `assets` field contains hashes rather
than bytes and it carries no general resource-resolution context. A self-contained
subject can be painted later. A subject depending on relative, authenticated, or
mutable external resources cannot be called portable until those resources are
closed over.

## Decision

**Acquisition host, capture material, rendering placement, observation,
retention, and reporting are independently composable responsibilities.**

The value crossing the acquisition boundary is a versioned `CaptureArtifact`.
It carries the subject and optional semantic/source evidence once, and exactly
one material:

```text
CaptureMaterial =
  | { kind: "document", document: RenderDocument }
  | { kind: "raster", raster: Raster }
```

The stages have these owners:

1. **Acquisition.** A host adapter discovers or names a subject, reaches the
   intended state, and emits a `CaptureArtifact`. Storybook owns story lifecycle;
   Playwright owns its page and locator; a unit runner owns its mounted jsdom
   tree. An adapter may choose automatic capture policy, but it does not own the
   host's `test`, `expect`, configuration, build, or teardown.
2. **Materialization.** A document needs a `Renderer`; a raster is already
   materialized. A renderer may be local or remote. An in-place browser capture
   is not a renderer pretending to accept a document: it is acquisition choosing
   raster material.
3. **Observation.** Both routes end at one candidate-raster comparison and
   attribution seam. Baseline lookup, comparability, sensitivity, isolation, and
   cause ranking do not depend on where the candidate was painted.
4. **Retention.** A store decides whether the other image is durable or
   ephemeral and a render cache decides whether a document needs painting. It
   does not decide which host acquired the subject.
5. **Reporting and review.** Reports consume observations. Upload, review, and
   CI finalization are policies above capture, not behaviors hidden inside a
   framework primitive.

### The axes are independent, and one cell is empty

Independence is a claim about which combinations are coherent, so it is worth
writing them down. A host qualifies for in-place raster when it already holds a
browser that has painted the subject.

| Acquisition host | In-place raster | Portable document, rendered later |
| --- | --- | --- |
| Playwright Test | coherent — the suite owns a painted page | coherent |
| Storybook runner | coherent — the preview is a painted page | coherent |
| Route collector | coherent — the collector drives a browser | coherent |
| Jest or Vitest with jsdom | **impossible** — jsdom produces no pixels | coherent |

The empty cell is structural, not unbuilt. jsdom implements layout-free DOM; there
is no rasterization to intercept and no screenshot to take. That single asymmetry
is why the unit-runner offering is document-only, and why it is an honest offering
rather than a gap: the deferred column is fully populated, so every host reaches
pixels by some route.

Vitest Browser Mode is not a fifth row. When it drives Playwright it is the
Playwright composition, and naming it separately would reintroduce the
host-by-topology matrix this decision exists to remove.

Coherent is not the same as shipped. Which cells are built is a property of the
current surface and belongs with the surface documentation; a coherent cell that
no one has built yet is a missing limb, recorded where the tests for it would go.

`CaptureArtifact` is the shared envelope, not a new all-purpose service. Host
metadata such as a test attempt, repeat, shard, or story mode may be carried as
optional provenance. It cannot change the meaning of the material or become a
second baseline identity.

### Portable means resource-closed

A document artifact advertised for later rendering must be resource-closed. It
carries the resolution context and immutable bytes for every external resource
needed to paint it, or it refuses capture and names the unresolved resources.
Hashes without bytes prove that an input changed; they do not let another
machine reproduce it.

A self-contained document is the zero-resource case. A lower-level
`RenderDocument` may remain serializable without being resource-closed for
existing same-process and network-capable renderer uses, but an adopter-facing
archive cannot silently make the stronger claim.

### Renderer identity owns rasterization inputs

Every pixel-affecting input controlled by a renderer belongs in
`RenderIdentity`. That includes the exact engine, platform, scale, fonts,
stabilization recipe, and rasterization launch recipe. Chromium's
`--disable-lcd-text` and `--font-render-hinting=none` are part of that recipe,
not incidental CI arguments. Changing the recipe creates a different baseline
lineage or an explicit migration; it never compares silently.

An existing host browser cannot be assigned an inferred identity stronger than
the evidence available. Its integration either receives the launch recipe as a
declaration, obtains it from an authoritative host contract, or reports the
identity field as unrecorded and accepts the corresponding comparability cost.

### Stability is measured before baseline difference

Holding a page still, repeated-render disagreement, and historical recurrence
are distinct mechanisms. Stabilization changes the page before capture.
Repeated capture decides whether the candidate itself is stable. Historical
flake recognition decides whether a stable difference recurs across runs. A
retry that eventually matches cannot replace any of them, because it discards
the evidence that the subject or renderer disagreed with itself.

## Consequences

**Offerings become named compositions.** The optimized Storybook collector
remains an external artifact adapter. Playwright Test remains additive and may
choose in-place raster or deferred document material without changing its host
imports. A unit-test surface captures a mounted jsdom tree and writes an artifact
for a later local or remote render; if Vitest Browser Mode uses Playwright, it is
the Playwright composition rather than a second kind of vanilla unit testing.

**The CLI collector result becomes a sum eventually.** A successful collection
can carry document or raster material with the same semantic evidence. The
document branch uses a configured renderer. The raster branch proceeds directly
to candidate observation. Existing collectors remain valid document producers.

**In-place is not intrinsically cheaper.** It avoids reconstruction and a second
browser, but it inherits the host browser's identity and stability. Deferred
rendering pays transport and reconstruction, but can use one pinned renderer,
cache documents, and fan out across engines. The adopter chooses according to
privacy, latency, repeatability, and coverage; documentation does not rank one
topology universally.

**A document archive has a larger disclosure surface than a raster.** It can
contain DOM text, hidden content, styles, fonts, images, and source evidence.
Remote transport therefore requires an inspectable manifest and explicit
retention/egress policy. A raster-only route remains available for callers that
cannot disclose that material.

**The first unit-runner offering is runner-neutral.** Jest and Vitest already
own test discovery, assertion, retries, and process lifetime. The surface exposes
capture and archive operations usable from either; runner-specific lifecycle
bindings may later add naming or flush policy without replacing `test` or
`expect`.

**Claims follow the strongest completed boundary.** A serializable document is
not called portable, an HTML snapshot is not called visual regression, and a
browser started inside a unit test is not called later rendering. Each stronger
claim needs its own consumer-shaped test.
