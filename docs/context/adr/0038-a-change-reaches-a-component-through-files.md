# ADR-0038 — a change reaches a component through files, and the tools that know better are seeds

**Status:** accepted
**Date:** 2026-08-13
**Relates to:** [ADR-0006](0006-host-free-core.md),
[ADR-0018](0018-a-component-hash-covers-its-own-nodes.md),
[`packages/core/src/relate/graph.ts`](../../../packages/core/src/relate/graph.ts) (the structure),
[`packages/oxc`](../../../packages/oxc) (the scan),
[`packages/cli/src/commands/affected.ts`](../../../packages/cli/src/commands/affected.ts) (the decision),
[`packages/cli/src/commands/changes.ts`](../../../packages/cli/src/commands/changes.ts) (nx and turbo),
[`docs/selecting.md`](../../selecting.md)

## Context

Selection asks two questions and this project had only ever answered one.
*Which subjects render component X* is a fact the last run established, because a
baseline records what its document actually painted (ADR-0018). *Which components
could this diff have moved* was answered from the component index alone: a
changed file was interesting if something in it declared a component, and any
other changed file under the scanned roots made the whole suite run.

That second rule is the entire cost of selection in practice. `src/tokens.css`
declares nothing. Neither does `theme.ts`, `useMedia.ts`, `icons/index.ts`, or the
`.css` file beside every component in the repository. A design system's most
consequential files are precisely the ones that name no component, so the
selector surrendered on exactly the diffs it was bought for.

Every product in this category answers this from a **bundler dependency graph** —
Chromatic's TurboSnap traces a change through webpack's or Vite's module graph and
runs the stories it reaches. That is a second build to configure, a stats file to
keep, a plugin that goes stale when the bundler is upgraded, and an answer scoped
to what the bundler happens to build. It is also unavailable to the surfaces this
project supports that are not a Storybook.

The information is not the bundler's, though. It is in the source: `Button.tsx`
imports `./button.css`, which `@import`s `tokens.css`. Reading it needs a parser
and a resolver, not a build.

## Decision

**A file graph, scanned from source, folded in `core`, walked backwards from the
diff.** Four parts, and the split between them is the load-bearing bit.

**The structure is data and requires nothing.** `Relations` is CSR adjacency —
`offset`/`target`/`kind` typed arrays over interned node ids, with the transpose
materialized so *what depends on this* costs the same as *what this depends on*.
It lives in `core`, which opens nothing (ADR-0006), so the fold from records to
structure is a pure function. A repository that already computes its own graph can
produce `FileRecord`s from it and every answer downstream is identical.

**The direction convention is one sentence: `A → B` means A depends on B.** A
component depends on the file that declares it (`declared-in`), never the reverse.
That is what makes one walk against the arrows from a changed file reach every
importer *and* every component in a single pass, instead of a file traversal
followed by an index lookup.

**A missed edge is a wrong answer, not a smaller one.** A file whose imports could
not be enumerated — a computed specifier, a `require` that is not a literal, a
parse that did not finish — carries the *sentence* saying so, and every consumer
seeds its traversal with that file as though it changed. The sentence travels with
the node rather than a flag, because the paragraph this exists to produce has to
name a cause and not a count. A **relative** specifier that resolves to nothing
widens; a **bare** one does not, because no package is in a diff of this
repository.

**The graph never rules a subject out.** It answers which components a change
reached; the decision to skip still requires that subject's own baseline to record
none of them. And it refuses in three places rather than answering: a changed file
under the scanned roots that is not in the graph, a diff entirely outside the
graph, and a diff that reaches no component at all — the last because a file that
genuinely affects nothing and a file declaring a component the scan failed to
recognise produce the same empty answer.

**`nx` and `turbo` contribute seeds, never a selection.** A specifier scan stops
at the package boundary: in a workspace, `@scope/design-system` resolves into that
package's built output, and built output is not what anybody edits. Both tools
compute that edge already, from the manifests, in every repository that has one.
Their answer enters as **more changed input** — every file under an affected
project is treated as though the diff named it — and the graph narrows outward
from those seeds like it does from any other change. The two answers union;
neither overrules the other. A tool that fails is fatal, because an empty project
list is a legitimate answer meaning *this diff crosses no package boundary*, and a
missing binary must not be able to produce it.

## Consequences

**It is off by default.** `source.relations: true` costs a scan of the source
tree, and a repository with no scanner configured keeps the declaration-only
selector and its whole-suite row. The cost is what ADR-0040 is about.

**The over-inclusion arrangement is unchanged, and that was the constraint.**
Every uncertainty the graph introduces resolves the same way the existing ones do,
which is why the graph could be added under `affectedSubjects` without revisiting
what a skip means.

**Component nodes are declaration-level.** A component is a name and the file that
declares it; there are no component-to-component edges, so *which components does
`Card` render* is not a question this can answer yet. That is the half named in
[`docs/specs/0025-component-relations.md`](../../specs/0025-component-relations.md),
and the node kind exists in the structure precisely so adding it is an edge kind
rather than a rewrite.

**The package boundary stays a hole, at project granularity.** What `nx` and
`turbo` return is coarse by construction, and using it means every subject in an
affected package is observed unless the graph narrows it. That is the price of
not shipping a second workspace resolver whose answer would have to agree with
theirs.

**A repository with no `git`, no `nx` and no bundler still selects.** The scan
needs a readable checkout and nothing else.

## Alternatives

**Consume a bundler's stats file, as TurboSnap does.** Rejected. It requires a
second build to configure and keep green, it describes what the bundler *could*
include rather than what the source says, it breaks on a bundler upgrade, and it
is unavailable to every surface that is not a Storybook. The source is the same
information one step earlier and with no build in the way.

**Take `nx` or `turbo` as the selection.** Rejected. A project is hundreds of
subjects; a one-line change to a leaf component marks the whole package affected,
which gives back most of what selection is for. They know one edge the scan
cannot see, and that is what they are asked for.

**Compute the workspace edge ourselves from the manifests.** Rejected. It is a
second workspace resolver whose answer must agree with the one the repository
already has configured, and disagreeing silently is worse than not asking.

**`tree-sitter` rather than `oxc`.** Rejected. The question is imports and
exports, and `oxc`'s ES module record answers it without walking a syntax tree —
the tree is available behind the same result and is the expensive half. A grammar
that produces a full parse for every file pays for a structure this never reads.

**Attribute changed files to components by convention** — `Button.module.css`
belongs to `Button.tsx`. Rejected. It is a guess that holds until somebody names a
file differently, and it fails silently in the direction that skips a subject.
