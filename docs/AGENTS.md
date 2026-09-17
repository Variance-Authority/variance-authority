# Working on documentation

## What this file governs, and how to check it

Public pages are the top-level `docs/*.md`, excluding this file and
`docs/visual-guidelines.md`. Publication is decided by explicit import in
`site/app/content/product-docs.ts`: every other top-level `docs/*.md` is
imported there, those two are not. Everything in a subdirectory of `docs/` is
internal — repository history and specification notes — and is never published
and never linked from a public page. Package `README.md` files are public and
may be linked.

Run the rules from the repository root: `yarn check` runs all of them,
`yarn check tools/docs-entrypoints.check.ts tools/docs-links.check.ts` runs the
two that read the rules below. A failure names the file and the line:

```
 ❯ tools/docs-entrypoints.check.ts (71 tests | 1 failed) 19ms
   × every public page introduces project vocabulary through its owner > docs/metrics.md 3ms
     → docs/metrics.md:320 → Distill should link to docs/distill.md
```

## Every page is an entry point

Link every concept at its first introduction on a page to the public explanation
or reference that owns it. Readers may land directly on any page; never assume
they have read earlier pages or know the project's vocabulary. Use specific
section links when they answer the immediate question.

The owner of a concept is one named page, not a judgement call. The `CONCEPTS`
registry in `tools/docs-entrypoints.check.ts` holds the owner of every name this
project defined — read it before linking, and extend it when you introduce a
name. Names outside that registry stay under the same human rule: spelling alone
cannot tell whether a sentence means the product concept or the ordinary
engineering word, so link the first mention that means the product concept.

Link owners by relative path, and let the path be the one the checker resolves:

- a page beside this one — `[the comparison](comparison.md)`, with a section
  anchor where it answers the question: `[test order](flakiness.md#test-order-and-shared-state)`
- a package README — `[Sense](../packages/sense)`, which resolves to that
  directory's `README.md`, or `../packages/sense/README.md` written out

An absolute `/docs/<slug>` target fails, because the rule resolves it on disk
and there is no such file. A `https://variance-authority.dev/...` URL fails
differently and more quietly: the entry-point rule ignores http targets
entirely, so the concept reads as never linked. Neither is a substitute for the
relative path.

Public pages must not link to internal ADRs, repository history notes,
specification notes or other context documents. This never collides with the
rule above: every owner in the registry is a public page or a package README, so
the owner is always linkable. When a concept's only written explanation is
internal, the move is to write that explanation into the public page that should
own it — and add it to the registry — or to cite the package README that owns
the detail. Never link inward instead.

## Foreground the difference

A reader recognizes familiar machinery quickly and may stop before reaching the
capability that changes the decision. When a page depends on a distinction the
incumbent does not make — the screenshot-diff tool the reader already runs,
which reports that pixels changed and not what drew them — state that
distinction in the lead or in the first sentence of the section that owns it,
before explaining the mechanism.

Name the difference in the reader's terms first: changed lines, the reviewed
candidate, response bytes, the test that reached the code. Introduce blocks,
graphs, the Eyes journal and other internal representations after the
consequence is clear. That journal is a product representation and is written
about freely; it is unrelated to the internal context documents above, which are
never linked. Use bold sparingly to mark the decisive phrase. Do not manufacture
novelty; a reference remains a reference, and a page whose opening already
carries its uncommon claim needs no slogan added to it.

## Visual support

Use visual form deliberately. Lists and tables help only when their structure
makes a relationship easier to scan. A diagram or illustration carries one
claim: a simple mental model of the page's structure, tradeoff or movement,
given before the prose develops it. If the figure asserts nothing the prose does
not already state plainly, it is decoration — cut it.

Reserve figures for those conceptual hinges. Say less and let the visual render
more of the thought. Use the fewest objects and labels that can carry the idea.
Follow [the visual guidelines](visual-guidelines.md) for the mark, palette,
geometry and figure conventions every page shares.
