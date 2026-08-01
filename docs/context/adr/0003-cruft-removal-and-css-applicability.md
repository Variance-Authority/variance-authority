# ADR-0003 — Cruft removal: structural aliasing and CSS applicability pruning

**Status:** accepted
**Date:** 2026-08-01
**Origin:** direct steer during kickoff —

> *"to use html + css as a cache you need to 'clean up cruft' from html/css.
> remove noise, random ids and keep only 'applicable' pieces of CSS as it may
> accumulate over time or support non-related pieces, like storybook itself."*

## Context

We want an **HTML+CSS digest** as a cache tier that sits below full rendering: if
a subject's structure and its applicable styling are byte-identical to the
baseline, the subject is `unchanged` without resolving layout or taking a
screenshot.

Taken naively this does not work, because neither input is stable:

**HTML noise.** React `useId` emits `:r0:`, `:r1:` — allocated in mount order, so
mounting an unrelated component earlier renumbers every id on the page. Storybook
emits story-scoped ids. Headless-UI-style libraries generate ids for every
`aria-labelledby`/`aria-controls`/`<label for>` pair. CSS-in-JS emits hashed class
names (`css-1a2b3c`, `sc-x7f2q`, `Button_root__9dk1`) that change when *any*
declaration in the file changes, including in a sibling rule.

**CSS accumulation.** A document's stylesheets are not the subject's stylesheets.
A Storybook canvas carries Storybook's own chrome CSS, preview reset CSS, the
whole design system's stylesheet, and — with CSS-in-JS — a `<style>` tag that has
been accreting rules for every story rendered since page load. The overwhelming
majority of it does not apply to the subject and never will. Digesting it means a
CSS change in an unrelated component invalidates every baseline in the repo.

Both failure modes push in the same direction: **false invalidation**, which is
precisely the metric M0 exists to measure (`<2% false semantic misses on no-op
refactors`).

## Decision

Two cleanup passes, both part of the versioned normalization ruleset.

### 1. Structural aliasing (replaces masking)

Identifier *values* are volatile; identifier *relationships* are semantic. So we
delete the value and keep the relationship, rather than masking both.

Every distinct id occurring within the subject subtree is assigned an alias
`#a0`, `#a1`, … in document order of first occurrence. Every reference to it is
rewritten to the same alias, across: `id`, `for`, `form`, `list`, `headers`,
`aria-labelledby`, `aria-describedby`, `aria-controls`, `aria-owns`,
`aria-activedescendant`, `aria-details`, `aria-errormessage`, `href="#…"`,
`xlink:href="#…"`, and `url(#…)` inside style values (SVG filters, clip paths,
gradients).

A reference pointing *outside* the subtree becomes `#extern:<n>` — still aliased,
but flagged, because a dangling accessible-name reference is a real defect and
must not be normalized into invisibility.

This means a `useId` renumbering is a no-op for the digest, while breaking a
`label ↔ input` association is a `geometry`-band structural change. Masking could
not distinguish those.

**Class attributes are not in the semantic snapshot at all.** A class name is an
implementation detail of *how* a style was applied; the snapshot records the
resolved value, which is *what* was applied. Dropping the attribute makes the
entire hashed-class-name problem disappear rather than requiring us to guess by
regex which classes are generated. Selector text is preserved only in the
attribution side-channel (below), where it is normalized.

### 2. CSS applicability pruning

The digest input is not "the document's CSS". It is **the subset of CSS that
actually decides the subject's appearance**, computed as:

1. **Enumerate** every rule reachable from the document: `<style>`, `<link>`,
   constructable/adopted stylesheets, and shadow roots intersecting the subtree.
2. **Flatten conditionals** against the declared environment. `@media`,
   `@supports`, `@container` are evaluated for the snapshot's viewport and
   feature flags. A rule inside a non-matching condition is *inapplicable* and is
   dropped entirely; a rule inside a matching one is hoisted, and the condition
   is recorded in the environment key rather than in the rule text. Conditions
   are render inputs, not content.
3. **Match** each surviving rule against the subject subtree. A rule matching no
   node is dropped. This is what evicts Storybook's chrome, the preview reset,
   unused utility classes, dead design-system rules, and every accreted
   CSS-in-JS rule belonging to a previously-rendered story.
4. **Project onto the allowlist.** Within surviving rules, discard declarations
   for properties outside the versioned computed-style allowlist.
5. **Resolve the cascade.** For each (node, allowlisted property) keep only the
   declaration that *wins*. Losing declarations cannot affect the render, so they
   cannot be allowed to affect the digest. A specificity war that changes which
   rule wins but not the winning *value* is correctly a no-op.
6. **Canonicalize.** Colors to one space, lengths to px at fixed precision,
   shorthands expanded to longhands, declarations sorted, identical resolved rules
   deduplicated.

Matching is engine-provided where possible — under Chromium via CDP
`CSS.getMatchedStylesForNode`, which gives the cascade for free. Under JSDOM there
is no such API, so we bucket rules by their rightmost simple selector and run
`Element.matches` only against candidates. Both paths must produce the same
pruned output; that equivalence is a test, not an assumption.

### Soundness condition for the cheap tier

"Same structure + same applicable CSS ⇒ same render" holds **only** with:

- an **inherited-context seed**: the resolved values of inheritable properties at
  the subject root, since rules on ancestors outside the subtree still reach in;
- the environment key covering fonts, viewport, and flattened conditions;
- resource-backed properties digested by asset content hash, not URL, since the
  same `url(…)` can resolve to different bytes.

Without the seed the tier is unsound and will produce false `unchanged` verdicts.
The seed is therefore mandatory, not an optimization.

## Attribution side-channel

Pruning throws away exactly the information attribution needs ("*which rule* set
this?"). So step 5 additionally emits, outside the hash input, a map of

```
(nodeAlias, property) -> { sourceSheet, normalizedSelector, tokenName?, specificity }
```

Selector text is normalized by replacing generated segments with placeholders, so
it can name a root without reintroducing hash churn. This side-channel is what
turns a diff into the sentence the product promises: *"padding 8→12 on `Card`,
source: `tokens.css:41`"*.

## Consequences

- The pruned, canonicalized CSS is small and legible — reviewable output, and
  small enough to store beside the manifest.
- The tier ordering of ADR-0002 gains a rung. Full sequence:
  `reachability → structure+CSS digest → jsdom semantic → chromium semantic → raster`.
- Steps 1–6 are the normalization ruleset. Its version is part of the environment
  key, so any change here is a mass-invalidation event (§7.3).

## What this forecloses

- Digesting raw `document.styleSheets` text. Cheap, and wrong.
- Regex-based "does this look like a generated class name" heuristics. We do not
  classify class names; we drop them.
- Masking volatile ids to a constant. Aliasing strictly dominates it, and masking
  hides real association breakage.
