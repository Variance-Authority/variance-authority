# 0001 — Kickoff: monorepo, ruleset decisions, core format

**Date:** 2026-08-01
**Cycle:** helix 1, move M1
**Branch:** — (foundation; blocks B1–B4)

## What was asked

Establish the `variance-authority` public monorepo, starting with visual
regression. Support two rendering surfaces: JSDOM (jest, vitest) and REAL-DOM
(playwright, agent-browser). Paper-trail the work. Commit as we go. No push, no
publish.

Mid-session steer, which redirected ADR-0003:

> to use html + css as a cache you need to "clean up cruft" from html/css. remove
> noise, random ids and keep only "applicable" pieces of CSS as it may accumulate
> over time or support non-related pieces, like storybook itself.

## What was done

Repo bootstrap (Yarn 4, `nodeLinker: node-modules`, TS project references,
Vitest), four ADRs, and `@variance-authority/core` — types, canonical
serialization, hashing, ruleset, verdict, band.

## What the steer changed

The spec treats normalization as a list of hygiene rules (§4.2). The steer
reframes it as a *cache-key* problem, and that reframing produced two decisions
that were not in the spec:

**Structural aliasing replaced masking.** The spec says "timestamps, random ids,
and declared-volatile regions are masked per policy". Masking a `useId` value and
masking a broken `aria-labelledby` target look identical afterward — both become
a constant. Aliasing every id to `#a0`, `#a1` in document order and rewriting all
references to match keeps the *relationship* while discarding the *value*, so a
renumbering is a no-op and a broken association stays a `geometry`-band change.
References escaping the subtree become `#extern:n`, flagged rather than hidden.

**CSS applicability pruning became a pipeline stage, not hygiene.** A Storybook
canvas carries Storybook's chrome CSS, the preview reset, the whole design
system, and a CSS-in-JS `<style>` accreting a rule for every story rendered since
page load. Digesting that means an unrelated component's CSS edit invalidates
every baseline in the repo. Pruning to rules that (a) match a node in the subtree,
(b) survive conditional flattening, and (c) win the cascade for an allowlisted
property, deletes all of it.

That in turn adds a **rung to the tier ladder** the spec did not have. Spec §4.1
is `reachability → semantic → raster`. Actual:

```
reachability → structure+CSS digest → jsdom semantic → chromium semantic → raster
    free              ~ms                  ~ms              ~100ms          ~s
```

And it surfaced a soundness condition that is easy to miss: pruning drops rules on
ancestors *outside* the subtree whose inheritable properties still reach in. So
`RawCapture.inheritedSeed` is mandatory. Without it the cheap tier produces false
`unchanged` verdicts — the one failure mode the product cannot have.

## The JSDOM problem, and what it forced

JSDOM has no layout engine. `getBoundingClientRect()` returns zeros;
`getComputedStyle()` resolves only what was declared. A snapshot taken there is
*shaped* like a real one but silently missing the entire `geometry` band.

Two ways that goes wrong, one much worse than the other: compared against a
Chromium baseline it reports every rect as "moved to 0×0" (noisy, obvious), or —
if rects are simply omitted — it reports a real geometry regression as
`unchanged` (silent, fatal).

Hence ADR-0002: the observation profile is part of the environment key, the two
profiles never share a baseline slot, and a band a profile cannot observe reports
`unobserved` rather than passing. JSDOM is not a cheap browser. It is an earlier
gate that decides the token band and structural geometry in milliseconds.

## Design decision worth flagging

**Collectors extract; core normalizes.** `RawCapture` is plain serializable data;
the DOM never crosses into `core`. Two things fall out:

1. One ruleset by construction. If each collector normalized its own capture,
   "both profiles ran the same rules" would be a claim held up by discipline.
   Here there is one normalizer and both profiles enter it.
2. The sub-renderer can be remote. A capture crossing a worker, a pipe, or a
   network hop to a device farm is the same value. No code assumes locality.

`core`'s `tsconfig` sets `lib: ["ES2022"]` with no DOM lib, so a stray
`document.` reference in `core` is a compile error rather than a review comment.

## Answers to open spec questions

- **§11.2 props digest stability** — resolved toward *shape*, not identity:
  functions digest as their name, elements as their type. Accepts a real
  under-invalidation (an anonymous closure rebound to different behavior is
  invisible), tolerable only because the digest decides *who is blamed*, not
  *whether anything happened* — the semantic diff still catches the output change.
- **§11.3 computed-style allowlist v1** — admission test: *can a change to this
  property alone alter what a user sees or how assistive technology reports the
  page?* Longhands only, so that expanding a shorthand is not a mass-invalidation
  event. `transition-*`/`animation-*` excluded: snapshots are taken at a settle
  point, so those describe a journey the snapshot does not contain.

## Verification

```bash
yarn install --no-immutable && yarn build && yarn test
```

`tsc --build` clean. 16/16 tests pass, covering canonical ordering, structural
absence vs. null, non-finite rejection, `-0` normalization, and the props-digest
over/under-invalidation boundary in both directions.

## Readback (move M1)

**Expected:** packages typecheck; `core` has no DOM types available. **Observed:**
both. `core` compiles with `lib: ES2022` + `@types/node` only, and detects React
elements structurally via the `$$typeof` brand rather than importing React —
confirming the no-framework-dependency boundary is workable, not just aspirational.

**Result:** expected. Continue within the observed boundary.

## Not done, deliberately

No normalizer implementation yet — only the format it will produce. No collectors,
no fiber walk, no corpus. Those are B1–B4 and are the next cycle. Native
acceleration is deferred behind measured gates (ADR-0004); no benchmark has been
run, so no claim is made.
