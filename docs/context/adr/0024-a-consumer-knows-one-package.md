# ADR-0024 — A consumer knows one package

**Status:** accepted
**Date:** 2026-08-04
**Amends:** ADR-0013 (packages are named for their requirements), rule 1

## Context

ADR-0013's rule 1 said a third-party requirement has **at most one owner**:
`playwright` is a production dependency of exactly one package, and so is each of
`pixelmatch`, `pngjs`, `react`. The reasoning was that two owners means a
consumer who wants one installs both.

It held for fourteen packages and then stopped answering the question anyone
actually had. Two adoption surfaces landed on 2026-08-04 —
`playwright-test`, where an existing Playwright suite's own test body plays the
collector's part, and `storybook-collector`, which ships the mounting half for a
built or served Storybook. Both are compositions. Both need a browser. Neither
declares `playwright`, so rule 1 was satisfied throughout and said nothing about
the only thing that had changed: **how many boxes an adopter now has to know.**

Asking rule 1 that question produced a taxonomy argument instead of an answer —
whether a composition is named for what it needs, what it does, or what it serves;
whether two collectors are two packages or two exports. Every branch of it was
about the package graph's internal tidiness, and none of it was about the person
adopting.

The evidence that the wrong question was being asked is in what the shipped
collector actually deleted. `cases/storybook-case/collector/index.mjs` imported
**five** variance packages — `core`, `dom`, `react`, `storybook`, `playwright` —
plus `playwright` and `esbuild` directly, and was 234 lines. It now imports one
and is five. Nothing about that improvement is expressible in rule 1; rule 1 was
green before and after.

## Decision

**Adopter-facing code names one package.** The Law of Demeter, applied to the
package graph: a consumer talks to its immediate neighbour and not to its
neighbour's collaborators.

Concretely, code an adopter writes or copies may import:

- **one surface** — `@variance-authority/playwright-test` for a Playwright suite,
  `@variance-authority/storybook-collector` for a Storybook;
- plus `@variance-authority/core` and `@variance-authority/cli`, which are the
  next step rather than a reach-through: types the surface's own signatures use,
  and the workflow the verdict feeds into.

Everything else is a collaborator. A surface that leaves an adopter importing
`playwright`, `dom`, `react` or `storybook` has not finished being a surface —
the reach-through is the defect, and re-exporting or wrapping is the fix.

Enforced by `tools/boundaries.check.ts` against the two kinds of adopter-facing
code this repository holds: the examples in each surface's README, and every
`collector/` directory, which is adopter code by definition.

**Rule 1 of ADR-0013 is retired, not weakened.** Its concern — a consumer paying
for a requirement they did not ask for — is better served here, because a
consumer who knows one package cannot acquire a second package's requirements by
accident. What rule 1 additionally forbade, two internal packages both declaring
`pngjs`, is a tidiness constraint on boxes no adopter imports, and ADR-0013's
rules 2 through 4 still hold every one of them to declaring exactly what it uses.

The one part worth keeping is kept, as its own rule: `core` and `raster` have no
third-party dependencies at all, because every argument about cheap tiers rests
on it.

## Consequences

**It finds work immediately, which is the point.** `packages/cli/README.md`'s
library example imported `createPlaywrightRenderer` from
`@variance-authority/playwright` to fill in `deps.renderer` — so the documented
way to use the CLI as a library required knowing about the browser package. That
example was also, by 2026-08-04, quietly wrong: it ignored the `browser` and
`renderer` config fields, so a reader following it got a local Chromium no matter
what their config said. `rendererFor` is now exported and the example imports one
package. One rule, one run, one real defect.

**A surface is a commitment, not a label.** Adding a package to the surface list
is a promise that an adopter never has to look behind it, and the check turns
that promise into a red test rather than a paragraph.

**It does not say what a composition is named for, and deliberately.** That
question produced the argument this ADR exists to end. `storybook-collector` is
named for the thing an adopter arrives with, which is the only name they can
guess, and that is now sufficient justification.

**What it cannot see.** Adopter-facing code outside a README fence or a
`collector/` directory — a snippet in an issue, a copied test file — is not
checked, so the rule is enforced where this repository can observe it and trusted
everywhere else.
