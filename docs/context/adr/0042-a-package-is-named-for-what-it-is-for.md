# ADR-0042 — A package is named for what it is for, never for what it imports

**Status:** accepted
**Date:** 2026-08-14
**Amends:** ADR-0013 (a package is what it needs), ADR-0023 (a service is named
for what it is)

## Context

[ADR-0013](0013-packages-are-named-for-their-requirements.md) says a package is
named for its requirement, and its rule 3 says what a requirement is: **what the
manifest cannot state.** A browser binary an install does not fetch, a directory
this process can write, a service already running, a tree `react-dom` has
rendered. A line in `dependencies` is the opposite of that — machine-readable, and
already checked by rule 2.

But rule 3 is written as a rule about the **Requires:** paragraph of a README, and
`tools/boundaries.check.ts` enforces it exactly there. Nothing closed the short
step from *named for its requirement* to *named for what it depends on*. The two
are not the same sentence, and the second one is wrong.

`playwright` is the package that makes the step easy. It is named `playwright`
because it is **for** Playwright suites, and the requirement it carries is a
browser binary. Read backwards the same name says "this is the package that
imports `playwright`" — also true, and it generalizes into a rule this repository
never made.

It generalized. `packages/oxc` was named for `oxc-parser` and `oxc-resolver`: two
lines in a manifest, one implementation of one step, and the answer to a question
no adopter asks. What the package is *for* is saying what a change reaches and
what a run crossed, by reading source. A parser is how it does that, and a reader
who wants to know which parser can open the manifest.

[ADR-0023](0023-a-service-is-named-for-what-it-is.md) already refused this move
from the other side. `@variance-authority/cloudflare` named a host, and the
objection was that a name describing the environment tells a reader nothing about
the thing — and that the name was not even accurate, because nothing in the
package was Cloudflare-specific. Both halves hold here unchanged. Nothing in the
scan is oxc-specific: it wants an ES module record and a resolver, and
[ADR-0004](0004-defer-native-acceleration.md) contemplates the very swap that
would leave the name describing something no longer present.

## Decision

**A package is named for what it is for. Never for a library it imports.**

Three sources of a name are legitimate, and all three are already in use:

1. **A requirement the manifest cannot state** — `dom`, `react`, `store`,
   `remote`, `server`, `session`, `jsx-source`.
2. **What the thing is** — `core`, `raster`, `report`, `history`, `observe`,
   `cli`, `tribunal`.
3. **A target, format or protocol it serves** — `playwright`, `playwright-test`,
   `storybook`, `storybook-collector`, `route-collector`, `mcp`, `png`.

The third is where the deformation entered, so it is the one worth stating
precisely. **A format and a protocol are public interfaces; a library is not.**
`png` would still be `png` if `pngjs` were replaced tomorrow, because the name
describes the bytes rather than the decoder. `mcp` would still be `mcp` under a
different SDK, because the name describes the wire. Replace the library a package
was named after and the name describes something that is not there any more.

So `packages/oxc` becomes **`@variance-authority/sense`**: what this project can
tell about a codebase by reading it rather than by running it. Both entrypoints
answer that one question — `.` says what a change could reach, `/instrument` says
what a run actually crossed — and neither is about a parser. `oxc` stays in the
prose, where a dependency belongs, exactly as Cloudflare does in `tribunal`'s.

**`png-sharp` is the exception, and it keeps its name on its own argument.** Its
requirement is a runtime that can load a compiled native addon *on a platform
somebody has published binaries for*, and the second half is not a property of
native addons in general — it is `sharp`'s published matrix specifically. A
consumer opting into this package is opting into that matrix, so here the vendor
**is** the requirement, which is the one thing that was never true of `oxc`.

**The rule is enforced.** `tools/boundaries.check.ts` fails any package whose name
shares a hyphen-separated word with one of its own third-party dependencies unless
that package appears in `SERVES` with the sentence saying what it serves. The list
is the point. It makes a vendor name cost an argument at the moment somebody
reaches for one, which is the only moment that argument is cheap to have.

## Consequences

**Every reference moved, including the ones in finished documents.** Journals and
ADRs written before this decision now say `packages/sense`, because a path in a
document is a pointer and a dead pointer fails `tools/docs-links.check.ts`. What
those documents *claimed* is untouched; only where to look changed.

**`sense` sits beside `observe`, and the two words are near-synonyms in English.**
They are not near in this repository and the distinction is worth stating once:
`observe` compares images this system painted, and needs a renderer and a store to
do it; `sense` reads source this system never ran, and needs only a checkout.
One is about output, the other about text. If a third perception word is ever
proposed, that is the seam it has to justify itself against.

**An allow-list is a place a bad name can hide.** `SERVES` is exactly the shape
that rotted last time — a rule with an escape hatch, where the hatch stops being
read. It is held to the same standard as the requirement paragraphs it sits
beside: an entry is a sentence about what the package serves, not a name in a
list, and an entry that could be written about the library rather than the target
is the entry that is wrong.

**The check cannot tell a target from a vendor**, and does not try. It detects the
*collision* — a package name and a dependency name sharing a word — and hands the
judgement to a person. That is the correct division: the collision is mechanical
and the distinction is not, and a check that guessed would be wrong in whichever
direction it guessed.
