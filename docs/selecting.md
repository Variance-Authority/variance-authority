# Running less of the suite

A 300-subject suite where one component moved pays for 300 collections and 300
comparisons to report two. That is the largest single saving available in this
category, and every product in it has an answer:

- **Chromatic's TurboSnap** traces a change through the *bundler's* dependency
  graph and tests the stories it reaches.
- **Percy** and **Argos** do not select for you; you shard.

This selects too, and from a different place. A stored baseline records the
components the document that painted it **actually rendered**
([ADR-0018](context/adr/0018-a-component-hash-covers-its-own-nodes.md)), so *what
this subject is made of* is a fact the last run established rather than one a
build tool predicts. There is no bundler plugin, no stats file, and nothing that
goes stale when a bundler is upgraded.

A change still has to travel from a file to a component, and for that there is
[an optional file graph](#the-expensive-row-and-what-retires-it) read from the
source itself — a scan, not a build. It answers only that half: a subject is
skipped when its own baseline records none of the components the change reached,
and never because the graph said so.

```bash
variance run --since origin/main
```

```json
{ "source": { "dirs": ["src"] } }
```

The diff is `git diff --name-only origin/main...HEAD` — **three dots**, so the
comparison is against the merge base. Two dots on a branch that is behind `main`
reports every file anybody else merged as changed here, and the selection widens
to the whole suite for a reason nobody can see.

## What it will not do

Everything here is arranged to **over-include**, because the two mistakes
available are not the same size.

A subject observed when it need not have been costs a collection. A subject
*skipped* when it should have been observed produces a green run over an
unwatched surface — and it does so silently, because that subject is not in the
report to be missing from. So every uncertainty resolves toward observing:

| Situation | What happens |
|---|---|
| The subject has no baseline | Observed. It is new; nothing is known about it |
| Its baseline records no component list | Observed. Absent is *unknown*, never *renders nothing* |
| A changed file under `source.dirs` declares no component | **The whole suite runs.** A stylesheet, a token file or a shared helper moves subjects without naming itself in any of them. This is the row [a file graph retires](#the-expensive-row-and-what-retires-it) |
| The diff touched nothing under `source.dirs` | The whole suite runs, and says so |
| `git` could not list the diff | The run refuses. An empty diff read as "nothing changed" would narrow to nothing and report success |
| `--since` with no `source.dirs` | The run refuses, for the same reason |

The last three are **refusals or warnings, never silence**. A run that quietly
declined to narrow looks exactly like a selector that decided nothing was
affected, and those are opposite facts about the next run.

## What a skipped subject looks like

It is in the report, with the sentence that skipped it:

```
[not observed] story:checkout--summary
not affected by the diff against origin/main: its baseline records 4 component(s)
and this diff touched none of them (Button, Badge, Toggle)
```

That is the same `excluded` state a shard filter produces, and it behaves the
same way: it does not gate, and `variance report` over several shards
[promotes a subject every shard excluded to `failed`](../packages/cli#sharding-report-takes-more-than-one-file)
— because a subject nobody looked at is the failure sharding introduces and
nothing else can see.

## Where `source.dirs` matters twice

It names where components are declared, and it is also a **declaration about
scope**. A changed file *inside* those directories is one this scan understands,
so a change it finds no component in forces a whole run. A changed file *outside*
them is one nobody claimed could affect a render, and narrowing past it is your
own statement about where your components live.

That is why a diff touching `README.md` does not widen anything, and a diff
touching `src/tokens.css` widens everything.

## The expensive row, and what retires it

`src/tokens.css` is the file every design system is most afraid of, and so is the
shared helper, the theme provider, the icon nobody thinks about. None of them
declares a component, so each one runs three hundred subjects to report two.

The answer is two hops away, and the hops are written down in the source:

```
tokens.css ← button.css ← Button.tsx ← Button
```

```json
{ "source": { "dirs": ["src"], "relations": true } }
```

That reads what imports what — `import`, `export … from`, `import()`,
`require`, `@import`, `@use`, `@forward`, `url()`, CSS Modules' `composes … from`
— and changes the question from *what does this file declare* to **what reaches
this file**. It is off by default because it costs a scan of the source tree, and
because a graph is only worth selecting on if it is honest about its own holes.

It is arranged to over-include in exactly the same direction, and has three
refusals of its own:

| Situation | What happens |
|---|---|
| A changed file under `source.dirs` is not in the graph | The whole suite runs. The roots are your statement about where renders come from, so a file inside them the scan never read is a gap in the scan, not a file that affects nothing |
| The diff is entirely outside the graph | The whole suite runs. A lockfile, a `package.json`, a CI config: none of them is a node here, and every one of them can repaint the suite |
| The files it did reach declare no component | The whole suite runs. That is also exactly what a changed file declaring a component the scan failed to recognise looks like |
| A file's own imports could not be read — `import('./' + name)`, a `require` this could not read as a literal, a parse that did not finish | It is traversed **as though it changed**, and named in the report with the reason |

The last row is why the report distinguishes *reached* from *widened*. A file
that had to be widened is printed with the specifier that did it, because that
line is the only thing in the run that tells you which file to fix to make the
next run smaller — and a count would tell you there is nothing to be done.

What the scan reads, and where it stops, is
[`packages/oxc`](../packages/oxc). The graph itself is data: fold the records
into it, walk it, ask it things. The traversals live in
[`core/relate`](../packages/core/src/relate) and open nothing, so a repository
that already computes its own dependency graph can feed this from that instead.

## What `nx` and `turbo` know that a scan cannot

A specifier scan stops at the package boundary. In a workspace,
`@scope/design-system` resolves into that package's **built output**, and built
output is not what anybody edits — so a diff inside one package reaches nothing
in the package that consumes it, and every monorepo has exactly the component
library that boundary hides.

Both tools compute that edge already, from the manifests, and every repository
that has one has already configured it:

```json
{ "source": { "changes": { "tool": "turbo", "task": "build" } } }
```

Their answer is **more changed input, never a second opinion**. Every file under
an affected project is treated as though the diff named it, and the selection
narrows outward from there like it does from any other change; the two answers
union, and neither overrules the other. Taken as the selection instead, it would
give back most of what selection is for — a project is hundreds of subjects, and
a one-line change to a leaf component marks the whole package affected.

`turbo` needs the `task` because its filter answers *what would run* rather than
*what changed*; naming it is how you say which pipeline's inputs match what a
render depends on. `nx` answers about projects without being told.

**A tool that fails stops the run.** An empty project list is a legitimate answer
meaning *this diff crosses no package boundary*, so a missing binary and a quiet
diff must not be able to produce the same value — one of them means every
consumer of the changed package is safe to skip, and the other means nothing at
all.

## What selecting costs

A scan runs before every run that selects, so the number that matters is not the
first one — it is the one after a one-line edit. Three things arrive already
known, and each removes a layer:

- **`git` names every file's content without opening one.** A blob's name *is*
  the hash of its bytes, so `git ls-tree` plus `git status` is the entire walk.
- **A digest names the parse.** The parse cache is keyed by content, so it can
  never go stale: two files with one digest had one content, on any machine, in
  any branch, in any year.
- **A digest plus the shape of the tree names the whole record, edges and all.**
  Edges are not a function of the bytes alone — resolution also depends on which
  paths exist and how resolution is configured — so that cache is additionally
  keyed by a digest over the path set and the resolver settings. Any file
  appearing, disappearing or moving costs one full scan. Every run that only
  edits files costs the diff.

30,500 files and 40,479 edges, one Mac:

| | cost |
|---|---|
| Naming every file's content | 95 ms, and nothing opened |
| A cold scan | 3002 ms |
| Parses remembered | 657 ms |
| Records remembered too | 236 ms |
| The run after a one-file edit | 236 ms — the edit is inside the noise |

Both caches live under `XDG_CACHE_HOME` (or `~/.cache`), keyed by repository
root, outside the work tree — so nothing here is committed and `git clean` will
not take it. Both halves are content-addressed, which is what makes their
location a cost decision rather than a correctness one: a stale entry, a cache
from another branch, or no cache at all costs a slower scan and can never produce
a different graph. Deleting them costs one cold scan and nothing else.

## What this does not reach

**A component imported but never rendered.** The graph answers *which components
a change reaches*; the subject side of the question is still what the last run
painted. So a subject that would **newly** render `Button` after this change — a
conditional branch nothing has ever taken — is not selected by a change to
`Button`, with `relations` on or off, because no baseline records a component
that has never appeared. A bundler graph over stories catches that case and this
does not. What holds the line is the row above it: a change the selection cannot
attribute runs everything, and a new branch usually arrives with an edit to the
file that renders it.

**A first run.** Nothing has baselines, so nothing can be ruled out, and the
whole suite runs. That is correct and worth expecting: `--since` pays from the
second run onward.

---

**Further:** [`flows.md`](flows.md) for where baselines live ·
[`packages/oxc`](../packages/oxc) for what the scan reads and where it stops ·
[`packages/cli`](../packages/cli) for the rest of the command line ·
[`comparison.md §2`](comparison.md#chromatic) for what TurboSnap does that this
does not.
