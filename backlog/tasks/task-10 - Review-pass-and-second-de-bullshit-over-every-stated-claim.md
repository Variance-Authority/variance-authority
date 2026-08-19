---
id: TASK-10
title: Review pass and second de-bullshit over every stated claim
status: Done
assignee: []
created_date: '2026-08-20 08:30'
updated_date: '2026-08-20 09:45'
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
- [x] #1 Every doc and README claim that disagrees with the shipped code is found and classified as rot, position, or missing limb
- [x] #2 Rot is corrected; positions are stated as positions; limbs are recorded at their site rather than in prose
- [x] #3 Capability rows naming a package, export, or option key have a mechanical owner that fails when the named thing does not exist
- [x] #4 `yarn verify` is green and the new check demonstrably fails on a planted false claim
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
Gate readback — PASS

`yarn build`, `yarn lint`, `git add -A`, `yarn check` (4278 passed, 1 todo) and
`yarn test` (175 files, 2250 passed, 23 todo) are green. Staged before checked,
which is the ordering the amendment above names.

Three reviewers swept `docs/**`, `README.md`, `packages/*/README.md`,
`cases/*/README.md` and `examples/*/README.md`; every finding was verified
against source before anything was edited, and three were rejected as wrong —
`composition.md:98` omits `(unattributed)` because `packages/core/src/attribute/composition.test.ts:97`
drops that bucket; `attribution.md:18` points at a module that exists; and the
stabilization "last four" was a bullet-count disagreement, not a miscount.

**Rot corrected.** The two highest-value catches were not overstatements.
`gates.md:21` reported hosted review as **no** while `tribunal` ships a
self-hosted review surface with per-subject decisions — **partial**, matching
what `flows.md:25` already said. And `storybook-case/README.md` printed
`ds.jsx:51` in its sample output: the exact line `cli.chromium.test.js:322`
asserts must *not* appear, because the whole claim is that the report names the
line an element is written on rather than the line its component is declared
on. A reader following that README would have concluded the feature was broken.

Both directions of rot showed up, and understatement was the more common one:
`history/README.md` and `server/README.md` both claimed `variance run` records
no observations, which `run.ts:197` and `accept.ts:256` contradict.

**Positions stated as positions.** `ignores.md` said the project has no
threshold; it has exactly one — `DiffPolicy.threshold`, pixelmatch's YIQ
distance — reported under both `default` and `strict`, and the sentence now says
which claim is being made. The `**no**` rows for hosted comments, managed branch
baselines and non-engineer review stay `**no**`: "hosted" means vendor-hosted,
and that is accurate.

**Limbs recorded at their site.** The Storybook wire test stated in prose in
`stabilization.md` is now an `it.todo` in `cli.chromium.test.js`, where
`unrun.check.ts` makes it name its price. `tapCommits` carries a `FIXME` saying
no collector composes it and why the ordering constraint is the blocker —
`examples/todomvc` reaches it only by owning its own entry.

**Option surfaces.** A reader could not discover `waitForFonts`, `retainResources`,
`resolveResource`, `cacheRoot`, `PROJECT` or `clearContainer` from any README.
Ten adopter-facing packages now carry option tables: `playwright` (renderer,
harness and the whole `observeNetwork` surface), `playwright-test` (the
`toBeUnchanged` matcher path), `unit-test`, `store`, `session`, `remote`,
`history` and `tribunal`'s six environment names.

A blanket "every option key appears in its README" gate was designed, probed and
deliberately not landed: it found 179 of 240 keys undocumented, and a gate that
fails on 179 real things gets disabled, which is worse than no gate. The
existing ratchet stands — `docs-claims.check.ts` enforces the rule over
`packages/*/src/options.ts`, and adding that file is what opts a package in.

Deferred, named rather than done: the remaining internal option surfaces
(`core`, `raster`, `dom`, `cli`, `sense`, `react`, `mcp`), and padding removal in
`metrics.md`, `architecture.md` and `visual-guidelines.md`.
<!-- SECTION:NOTES:END -->
