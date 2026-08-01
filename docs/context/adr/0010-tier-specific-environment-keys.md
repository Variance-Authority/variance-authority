# ADR-0010 — The environment key is tier-specific, so semantic baselines cross machines

**Status:** accepted
**Date:** 2026-08-01
**Amends:** ADR-0002 (one key per environment)
**Origin:** direct steer —

> *"Images generated on different machines are different, so everybody ends using
> Docker and that is slow. We need to defer/optimize/offload the rendering in any
> possible way."*

## Context

Rasterization is machine-bound. A different GPU, driver, font stack, or pixel
ratio paints the same page differently, so a pixel baseline is only valid on the
machine that produced it. The industry answer is to pin the whole pipeline in a
container.

That works, and it prices the wrong thing. Docker is paid **per subject, per
build, on every tier** — in order to stabilise the tier that decides almost
nothing. Measured here: a screenshot costs 65.4 ms against 3.4 ms for a semantic
collection on the same page in the same process, and on the corpus the semantic
stage explains every change without taking a single screenshot.

Meanwhile the semantic representation is built from the box tree, and the
measurements in journal 0012 say plainly that the machine-bound inputs cannot
reach it: a device-pixel-ratio change moves 3015 pixels and leaves structure and
style **byte-identical**; a rasterization-mode change moves 177 pixels and does
the same.

So the container was pinning an artifact that did not need pinning — but the
environment key did not know that. It hashed every input into one digest, so a
retina laptop and a non-retina runner produced different keys and therefore
different baselines, for a representation they agree on exactly.

## Decision

**One environment, two keys.**

- `digest` — every render input, including the machine-bound ones. What a raster
  baseline is stored under.
- `semanticDigest` — the inputs that can reach the box tree. What a
  `renderHash` is built from.

They differ in exactly one field: `deviceScaleFactor`. Everything else — engine,
fonts, viewport size, colour scheme, ruleset, allowlist, resolved conditions,
asset hashes — is in both, because each of those genuinely changes layout.

The consequence is the point: **a semantic baseline is valid on a developer's
retina laptop, a non-retina CI runner, and a container alike.** The container is
needed only for the raster residue, which the tiering already makes rare.

## Why this is safe, and the hole it nearly opened

Dropping an input from a key is the exact shape of a false `unchanged`, so it is
only sound if the input's *observable effects* are still covered.

`deviceScaleFactor` has one: `@media (min-resolution: …)`. A rule gated on it
applies on one machine and not the other, so two runs that share a semantic key
would apply different CSS. That is precisely the bug this ADR would otherwise
introduce.

Covered by recording the **outcome** of resolution-dependent conditions in
`conditions`, so the two runs stop sharing a key through the condition rather
than through the input. A gated rule that resolves the same way on both machines
is genuinely not a difference and costs nothing.

The first implementation recorded *every* flattened condition, and the corpus
rejected it within one run: a `@media (min-width: 99999px)` block that matches
nothing began invalidating every baseline, because adding it changed the key. The
recording is now narrow — only conditions depending on the omitted input, since
every other condition resolves from inputs the semantic key still carries and its
outcome is therefore derivable rather than something to store.

It remains slightly over-conservative: a resolution query gating rules that match
no subject still splits the key. That costs a second baseline where one would do,
which is the safe direction.

## What this enables, and what it does not

**Enables:** running the deciding tier anywhere. No container, no pinned runner,
no image pull, on the tier that settles the overwhelming majority of subjects.
Combined with the sub-renderer protocol (ADR-0002), the expensive tier can also
be *offloaded* — a capture is plain serializable data, so raster can be deferred
to a pinned environment reached over a network and consulted only for residue.

**Does not enable:** sharing a *raster* baseline across machines. Pixels are
machine-bound and this ADR does not pretend otherwise; it confines the cost to
the artifact that actually has it.

## What this forecloses

- A single global environment key. Any future dimension must declare which
  inputs it can observe, and adding a dimension means deciding that explicitly.
- Dropping any further input for portability's sake without first showing its
  observable effects are captured elsewhere. Fonts are the obvious temptation —
  they would make baselines beautifully portable and quietly wrong, since a font
  substitution changes metrics and therefore geometry.
