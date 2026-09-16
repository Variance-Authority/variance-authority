# Reading the source

To skip work, a run has to know what a change could have reached, and it has to
know it before anything renders. That answer is a graph of the
repository, and this is the part of the system that builds one: a walk that reads
files, resolves what they point at, and hands back one record per file.

It is a *reader*, not a builder. Nothing here executes the code it reads, loads a
config that a bundler would load, or asks a package manager anything. The whole
mechanism is a parse, a resolver and one [source index](source-index.md) — which is why a cold scan
of a thirty-thousand-file repository takes three seconds, every scan after it a
fraction of that, and neither of them the minutes a build costs.

The package is [`packages/sense`](../packages/sense), and it is named for what it
is for: sensing what is there. The graph it feeds lives in
[`packages/core`](../packages/core), which never touches a disk.

Two questions come out of it:

| question | what answers it |
|---|---|
| what could this change have reached? | the file graph, walked backwards from a diff |
| what did this run actually cross? | the transform, which marks every region a run entered |

The first question belongs to [`selecting.md`](selecting.md), which covers
`--since`, what it over-includes, and what a scan costs on a real monorepo. This
page is the mechanism underneath that one.

## A request is not a name

Nothing in the reader resolves a specifier. `readModule` in
[`packages/sense/src/read.ts`](../packages/sense/src/read.ts) turns a file's text
into **requests** — specifiers exactly as written — with **bindings** hanging off
each one, and where a specifier points is a separate question, answered further
down, against the disk.

```ts
import { Card, type Props } from './ui';
// one request: './ui'
// two bindings: Card (value), Props (type)
```

Collapsing those loses something in both directions. One edge per statement makes
`Props` stop being type-only, because a statement is type-only or it is not, and
makes `Card` stop being a name at all — so nothing downstream can ask which file
declares it. One edge per *name* turns a barrel republishing fifty exports into
fifty edges to one file. So the specifier survives resolution: a bare specifier
that resolves to nothing is the package this file depends on, and that question
has no answer once the string has been thrown away for a file id.

**It reads the module record, not the tree.** `oxc-parser` returns a lazily
deserialized result: the full AST sits behind `.program` and is the expensive
half, while `.module` is the ES module record the parser has already computed —
every static import, every re-export, every `import()`, with the imported, local
and exported name of each binding. Touching it materializes no node, so a scan
pays for a parse and not for a tree.

Stylesheets get a second reader, and it is a deliberate text scan, not a
CSS parse: `@import`, `@use`, `@forward`, `url()` and CSS Modules' `composes …
from`. A stylesheet request is a whole-file dependency, so there is nothing to
bind and no tree worth building.

### What it refuses to guess

A missed edge is not a smaller answer, it is a wrong one — a file whose imports
nobody could enumerate may import the file that just changed, and treating "I
found no imports" as "it imports nothing" produces a green run over a surface
nobody looked at. So the reader widens instead, by setting `unknown`:

| shape | why |
|---|---|
| the parser reported an error | the record may be truncated at the error |
| `import(x)` where `x` is not a literal | the target is a runtime value |
| a `require(…)` that could not be read as a literal | same, and invisible to the module record |

A literal `require('./x')` is deliberately not in that table — it is read and
becomes an edge, which keeps a CommonJS corner from widening every run it appears
in. Neither is `export * from './x'`: the *edge* is known, it is right there.
What is unknown is this file's export set, which is a fact about names and is
carried as one — an export with no exported name. Treating it as an unknown edge
list would widen every barrel in the repository to depend on everything, which is
most of them.

## Where a specifier points

[`packages/sense/src/resolve.ts`](../packages/sense/src/resolve.ts) is the
configured half, and it is separate because none of what it knows is allowed to
change what counts as an import. It decides one thing: where a specifier the
reader already found points.

Three resolvers, because one set of options cannot answer all three questions:

| resolver | for |
|---|---|
| modules | `.js` → `.ts` rewriting on, so `nodenext` source resolves at all |
| styles | stylesheet extensions only, so a `@import` cannot find a `.ts` |
| exact | no extension rewriting, for the one request where the rewrite is the bug |

Conditions default to `source, import, require, default` — source before built
output, because a package that publishes both is worth more as source. Sass's
partial convention is tried as a second spelling, since `./colors` finding
`_colors.scss` is a naming rule, not a resolver option. `tsconfig: 'auto'`
discovers the nearest config per file, which is what a workspace of many packages
needs.

**It stops at the repository edge.** A builtin, a package in `node_modules`, a
path above the root: all three come back as nothing, because nothing in a diff of
this repository can be that file and an edge to it could never carry a change.
The directories it never descends into are fixed —
`node_modules, dist, build, coverage, .git, .next, .turbo`.

**It stops at the package boundary too, and that gap has a name.** In a workspace,
`@scope/other` resolves through a symlink into that package's *built output*
unless it publishes a `source` condition, and built output is not what anybody
edits. An edge into `dist/` could never be reached by a diff, so it is dropped
rather than drawn — which leaves a real gap at every package boundary, and it is
the gap `nx` and `turbo` already fill. Their project-level answer joins this one
as additional seeds ([`selecting.md`](selecting.md)).

On a case-insensitive filesystem a resolution is rejected when it matched only by
case, and every accepted one is spelled as the disk spells it. One node per file,
on every platform, or a diff reaches nobody.

## What a scan produces

One record per file, sorted by path and compared by code unit, so two scans of
one tree produce byte-identical input to the graph:

| field | |
|---|---|
| `file` | repository-relative, and the key |
| `digest` | the content digest, when one was available |
| `edges` | `to` and a kind, deduped and sorted |
| `declares` | the component names this file declares |
| `unresolved` | specifiers that resolved to nothing, as written |
| `unknown` | why this list is not the whole list |

The seed directories are a starting point, not a boundary: a component
under `src/` importing `../design/button.css` pulls that stylesheet in, and the
stylesheet's own `@import` pulls in the next one, because a scan that only knows
the files it was pointed at cannot answer the question it exists for.

`declares` is the index a component name is resolved against later. It skips the
files whose declarations are not components — anything matching `.test.`,
`.spec.`, `.stories.` or `.d.ts`.

**A relative specifier that resolves to nothing widens what the file reaches.** A
bare one that fails is a package this scan has no business finding; a *relative*
one names a path inside this repository and could not be identified, which is a
hole in the edge list rather than an absence of one. It lands in `unknown`, and everything
downstream treats an unknown file as reaching everything
because absent evidence is not evidence of an empty dependency set. A file that
cannot be read is the same case, and produces a record with a reason rather than
an empty one.

## What a second scan costs

Three things can arrive already known, and each one removes a layer of work.

**Git already named every file's content.** `ls-tree -r` hands over the whole file
list with a blob hash attached, in one subprocess, having opened nothing. The
working tree is not the commit, so the porcelain status is read too and every path
it names is re-hashed from disk by `hash-object`; a file edited back to its
committed contents lands on its committed digest and costs nothing. Those digests
carry a `git:` prefix, because this project's own digests are `v1:` and comparing
the two schemes as though they were one must be impossible, not unlikely.

**A digest names what parsing produced.** The parse cache holds exactly what a
file's bytes said — requests, exports, declarations — and nothing about where the
file sits, because that is what makes it cacheable forever.

**A digest plus the shape of the tree names the whole record.** An edge is not a
function of bytes alone: where `./button.css` points depends on the directory the
specifier sits in, on which files exist around it, on `tsconfig` paths and on
what is installed. A record is a function of exactly four things, and
[`packages/sense/src/reuse.ts`](../packages/sense/src/reuse.ts) names the last
two:

| | named by |
|---|---|
| the file's bytes | its content digest |
| where the file sits | its path, which is the key |
| how resolution is configured | the config digest |
| which paths could have answered it | its witnesses |

The config digest folds in the contents of the files that decide where *other*
files resolve — every `package.json`, `tsconfig*.json`, `jsconfig.json` and
lockfile — plus the requested `tsconfig` and the condition names, so a `paths`
edit that redirects every `@/` specifier in the repository rebuilds the
repository.

A record's **witnesses** are the directories its own specifiers could have been
answered from. A resolver asked for `./button` from `src/panel` looks in
`src/panel` for a name it can extend and in `src/panel/button` for an index, and
nothing else in the tree takes part in that question. They are derived from the
specifier rather than from what it resolved to, because resolution is decided by
absence as much as by presence: `./button` finds nothing today and finds
`button.tsx` tomorrow, and only a lexical reading of the request is watching when
it does. Where a request did resolve, the directory holding the answer is a
witness too — that is where a `package.json` `main` can send a lookup.

So a path appearing costs the records that were asking about its directory, and
nothing else. The exception is a repository whose configuration cannot be read,
where a bare specifier has no bound at all and the whole path set goes into the
config digest instead. The scanned directories are deliberately in neither, since
they decide which records a scan produces and never what any one record contains
— so a narrow run can reuse a wide run's work and neither invalidates the other.
What all of this is worth in milliseconds is measured in
[`performance.md`](performance.md).

Reuse is off without digests, and that is not a policy: a record that names no
bytes cannot be checked against the bytes on disk, so there is nothing to reuse it
against.

The two layers are stored as one versioned binary generation. Its exact
container, columns and invalidation rules are described in
[`source-index.md`](source-index.md).

## From records to a graph

The records are I/O; the graph is not, and it lives in
[`packages/core`](../packages/core) with no disk under it. Nodes are interned to
integer ids, edges are stored compressed-sparse-row, and both directions are
materialized, because the traversal that matters runs *backwards* — from a
changed file to everything that rests on it.

Six edge kinds are kept because they explain a finding. One of them also
decides a walk:

| kind | |
|---|---|
| `imports` | a value import |
| `reexports` | an import that also republishes |
| `dynamic` | `import()` with a literal specifier |
| `type` | erased before anything renders, and not walked unless asked |
| `asset` | a stylesheet's `@import`, or a `url()` reaching a font or an image |
| `declared-in` | a component to the file that declares it |

`type` is the one worth stating: every compiler erases it, so a change behind
a type-only import runs no test and moves no pixel, and the default traversal
leaves it out. A caller whose question is about source rather than a runtime, a
docgen reading prop types for instance, passes `through: EDGE_KINDS` and walks
it.

`movedBy` walks the changed set backwards and returns four things: the files and
components it reached, the changed paths the graph holds no node for, the files
seeded because their own edges are unknown, and a breadth-first trail per node.
The trail is what lets a report say *why* a subject was included, one hop at a
time, instead of asserting that it was.

## The transform that records the path

The graph answers what a change could reach. Execution selection records what a
test or driven subject actually entered, because a file graph sees both sides of
every fork.

`@variance-authority/sense/instrument` supplies the pure transform:
`instrument(source, id)` parses source, chooses execution boundaries, and
splices a recording call in front of each one. The Vitest adapter applies that
transform and records crossings at test-file granularity. A Vite-compatible
application build uses `testSelectionProbes()`; Storybook and Playwright
recording drain its page journal and persist the crossings for selection.

Two properties make the emitted code explicit about its runtime:

- **Lines are preserved exactly.** Every insertion is single-line, so a stack
  trace, a `sourceMappingURL` and a coverage tool reading the same file all still
  agree about line numbers. Probes are spliced at UTF-16 offsets rather than
  re-printed, so the output stays diffable.
- **The runtime is a required global.** The header resolves `globalThis.__VA__`
  on first use. An instrumented module without a collector throws at its first
  probe, so a runner cannot silently omit collection.

A source it cannot parse returns nothing instead of throwing, because a file
whose blocks are unknown is *not instrumented*, never *not executed*.

The transform alone does not select tests. The runner records crossings first;
`selectTestFiles` then joins the persisted coverage data to a diff and returns the
test files whose recorded regions intersect it. Missing or indeterminate
coverage widens selection rather than reading absence as no reach. See
[`selecting.md`](selecting.md) for the decision boundary.

## What this refuses to conclude

**An edge list does not claim to be complete.** `unknown` is the honest answer and
it widens rather than narrows, everywhere it appears: an unparseable file, a
computed `import()`, a relative specifier that resolves to nothing, a file that
could not be read.

**A resolution is not a build.** Conditions, `paths` and extension order are read
from configuration a bundler also reads, and a build that rewrites specifiers in
a plugin resolves somewhere this does not follow. That shows up as an unresolved
bare specifier, which widens.

**A digest from git is not a digest of a read.** The two schemes never meet: a
closure computed from `git:` digests and one computed from read contents differ at
every node, which costs a whole run and cannot cause a missed one.

**A file git cannot see does not move a directory.** The directory map is built
from the digest map, which comes from the object database, so a generated file under a
`.gitignore` can never appear in a diff and can never carry a change — but it
can, in principle, shadow a resolution. That is the one gap, it is bounded by
`git add`, and turning digests off turns the whole mechanism off.

---

**Further:** [`selecting.md`](selecting.md) for what a run does with this graph ·
[`source-index.md`](source-index.md) for the persisted binary format ·
[`source-structures.md`](source-structures.md) for the keys, lookups and
costs of every structure the scan builds ·
[`packages/sense`](../packages/sense) for the API ·
[`attribution.md`](attribution.md) for the other direction, from a
changed pixel back to a line.
