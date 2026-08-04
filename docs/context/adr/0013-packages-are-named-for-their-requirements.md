# ADR-0013 — A package is what it needs, not what it does

**Status:** accepted
**Date:** 2026-08-02
**Extends:** ADR-0001 (toolchain and layout), ADR-0006 (host-free core)

## Context

ADR-0006 keeps one package free of every host requirement. It says nothing about
how the rest are cut, and left to itself the obvious cut is by feature: a pixel
package, a Storybook package, a browser package.

Feature grouping puts unrelated requirements in one box. A `raster` package that
covers the pixel tier ends up holding a Playwright renderer, a `pixelmatch`
comparator, a filesystem-backed store and an HTTP client, because all four are
about pixels. The consequence is paid by every consumer of any part of it: a team
extending their own Playwright tests, who want comparison and attribution and
already have a browser, install a second one. A team whose baselines live
somewhere this project has never heard of install an image codec to keep them
there. Neither asked for what they got, and nothing in the code says why they
got it.

The same failure at a smaller scale: a Storybook adapter that imports a `Page`
type makes a browser a requirement of reading `index.json`. A report format that
lives with the agent protocol makes an agent protocol a requirement of writing a
report.

## Decision

**The first cut between packages is what a consumer must supply. What the code
does is the second cut, made inside a package with entrypoints.**

A package is named for its requirement — `dom`, `react`, `playwright`, `png`,
`store`, `remote`, `server` — and holds only code that has it. Code requiring
nothing goes in a package that requires nothing, however different its subject
matter is from its neighbours.

Four rules follow, and are enforced by `tools/boundaries.check.ts`:

1. ~~**One owner per third-party requirement.**~~ **Retired 2026-08-04 by
   [ADR-0024](0024-a-consumer-knows-one-package.md).** It read: `playwright` is a
   production dependency of exactly one package, and so is each of `pixelmatch`,
   `pngjs`, `react`; two owners means a consumer who wants one installs both. It
   held for fourteen packages and then could not see the only change that
   mattered — two adoption surfaces landing, and an adopter's import list going
   from five packages to one. What replaces it is the Law of Demeter applied to
   the graph: **adopter-facing code names one package.** The half worth keeping is
   kept as its own rule — `core` and `raster` have no third-party dependencies at
   all.
2. **Declared and imported are the same set.** An undeclared import resolves
   inside a workspace, because the hoisted tree hands it over, and fails when the
   package is installed alone. A declared-but-unused dependency is the same lie
   read backwards: it tells a reader the box costs more than it does.
3. **A requirement is what the manifest cannot state.** A browser binary an
   install does not fetch, a directory this process can write, a service already
   running, a tree `react-dom` has rendered. Naming a dependency instead
   duplicates a machine-readable fact rule 2 already checks, and a prose copy of
   an enforced fact only ever drifts away from it.
4. **An entrypoint exists where the halves cost differently.** `store/lfs` needs
   `git`; `history/client` needs a network; `server/sqlite` needs `node:sqlite`;
   `report/file` needs a disk; `playwright/agent` must be importable *without*
   Playwright, because it is bundled into the page.

Structural types are preferred over imported ones when the import would create a
requirement. The Storybook adapter names the three page methods it drives instead
of importing a `Page`; six lines of interface against a browser in the dependency
tree of everyone who reads a story index.

## Consequences

**Packages get small, and that is the intended direction.** `png` was one module when this was written and is three files behind two
entrypoints now, still with one requirement.
A small box with one requirement is more useful than a large one with four,
because the consumer's question is "what does this cost me" and only the small
box can answer it.

**Compositions are visible.** A package that wires an order together inherits the
requirements of everything it wires, so it cannot hide: `observe` depends on a
codec because it compares images, and it is the only package in the repository
where an order is hard-wired. Anything else claiming to be a tool and depending
on four requirements is a composition that has not admitted it.

**Some code moves away from where its subject matter sits.** The ephemeral
baseline store is in `raster` and the durable one is in `store`, which reads
oddly beside each other in a table of retention modes. It is also the honest
statement: one needs a disk and the other does not, and the mode whose argument
is *"no container, no pinned runner, no stored artifact"* now demonstrates it in
the package graph rather than asserting it in a comment.

**Test files are held to a weaker rule.** A test may import across a boundary its
source may not cross, declared in `devDependencies`. The alternative pushes
suites towards mocks, and a mock store cannot produce the failures a real one
does — an unreachable socket, a half-written pair on disk — which are precisely
the cases the stores exist to get right.

**A cycle between two packages' tests is not a cycle.** Project references follow
production dependencies only, because the compiler builds sources and a test edge
is not a build edge.
