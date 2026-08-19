---
id: TASK-10
title: Review pass and second de-bullshit over every stated claim
status: In Progress
assignee: []
created_date: '2026-08-20 08:30'
updated_date: '2026-08-20 08:30'
labels: []
dependencies: []
priority: high
type: chore
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Phases 7 and 8 of the reshape: read everything the repository says about itself,
correct what disagrees with the code, and leave the highest-density claim surface
with an owner that is not a person re-reading it.

`gates.md:17` is the specimen. It reports sitemap discovery as **no** while
`sitemap.ts` ships with tests, `options.ts` documents the option in full, and
`index.ts` exports `locationsIn`, `routesFrom` and `subjectIdFor`. Nothing caught
it because `docs-claims.check.ts` verifies commands, file counts and config
examples — not capability rows. A claim that rots toward understatement is
invisible in exactly the same way as one that rots toward a lie.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every doc and README claim that disagrees with the shipped code is found and classified as rot, position, or missing limb
- [ ] #2 Rot is corrected; positions are stated as positions; limbs are recorded at their site rather than in prose
- [ ] #3 Capability rows naming a package, export, or option key have a mechanical owner that fails when the named thing does not exist
- [ ] #4 `yarn verify` is green and the new check demonstrably fails on a planted false claim
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Carry-the-load increment (frozen before edits)

Value: a reader of `docs/` and the package READMEs can trust every capability
claim, because each one is either true of the shipped code or mechanically
checked.

Current flow: docs are hand-written present-tense product material.
`tools/docs-claims.check.ts` verifies the command table against the binary, file
counts against `git ls-files`, and config examples against the real parser.
Capability claims — the gates.md fit columns, the surface.md placement table,
comparison.md's rows, the README option tables — are verified by someone
re-reading them.

Constraint: nothing ties a capability claim to the code implementing it, so a
claim that becomes false is invisible until a human re-reads 9,700 lines.

Increment: sweep every doc and README for disagreement with the code, correct it,
and give the claim surface a mechanical owner in `docs-claims.check.ts` so the
next pass is a test run. Maximum scope: `docs/**`, `README.md`,
`packages/*/README.md`, `cases/*/README.md`, `examples/*/README.md`,
`tools/docs-claims.check.ts` and its helpers.

Misfire: the sweep converts a deliberate position into a false yes because a
reviewer read the code and not the product boundary; or the new check is strict
enough that honest prose fails it, and the next person weakens the check instead
of the doc.

Containment: reviewers report, they do not edit; every finding is classified
before prose is touched; the check anchors on machine-readable references —
package names, exported symbols, option keys — and never attempts to parse an
English capability claim.

Readback: the new check fails on a planted false reference and passes on the
corrected docs; every finding is fixed or recorded at its site; `yarn verify`
green.

Learning owner: the new check in `docs-claims.check.ts`.

Scope amended, recorded before the edit it authorises: source docblocks that are
the *origin* of a documentation claim are in scope. `packages/route-collector/src/index.ts:57`
states "Not a crawler and not a sitemap reader" under a "What it is not" heading,
written when it was true; `discover()` was built afterwards and wired 140 lines
below it. `gates.md:17` is downstream of that sentence. Correcting the gate while
leaving the comment it came from regrows the rot on the next reader, so the
increment cannot deliver its Value inside the original boundary.

Also found before any edit, and it is mine: `yarn check` reads `git ls-files`, so
staging changes the gate's input. TASK-9 was verified before `git add` and
committed three failures — a stale workflow file count and two stale markdown
counts. The file-count rule's own docblock already names this exact failure
("measured *mid-transaction*"). The gate must be run after staging, not before.
<!-- SECTION:NOTES:END -->
