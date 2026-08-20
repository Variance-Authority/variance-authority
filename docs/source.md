# Reading the source

A run that wants to skip work has to know what a change could have reached, and
it has to know it before anything renders. That answer is a graph of the
repository, and this is the part of the system that builds one: a walk that reads
files, resolves what they point at, and hands back one record per file.

It is a *reader*, not a builder. Nothing here executes the code it reads, loads a
config that a bundler would load, or asks a package manager anything. The whole
mechanism is a parse, a resolver and two caches — which is why a cold scan of a
thirty-thousand-file repository is three seconds, every scan after it is a
fraction of that, and neither is the minutes a build costs.

The package is [`packages/sense`](../packages/sense), and it is named for what it
is for: sensing what is there. The graph it feeds lives in
[`packages/core`](../packages/core), which never touches a disk
([ADR-0006](context/adr/0006-host-free-core.md)).

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
down by a disk.

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
has no answer once the string has been thrown away for a file id
([ADR-0041](context/adr/0041-a-request-is-the-edge-a-binding-is-the-name.md)).

**It reads the module record, not the tree.** `oxc-parser` returns a lazily
deserialized result: the full AST sits behind `.program` and is the expensive
half, while `.module` is the ES module record the parser has already computed —
every static import, every re-export, every `import()`, with the imported, local
and exported name of each binding. Touching it materializes no node, so a scan
pays for a parse and not for a tree.

Stylesheets get a second reader, and it is a deliberate text scan rather than a
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
output, because a package that publishes both is worth more as source. Sass'
partial convention is tried as a second spelling, since `./colors` finding
`_colors.scss` is a naming rule rather than a resolver option. `tsconfig: 'auto'`
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

The seed directories are a starting point rather than a boundary: a component
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
([ADR-0002](context/adr/0002-observation-profiles.md): absent is not empty). A
file that cannot be read is the same case, and produces a record with a reason
rather than an empty one.

## What a second scan costs

Three things can arrive already known, and each one removes a layer of work.

**Git already named every file's content.** `ls-tree -r` hands over the whole file
list with a blob hash attached, in one subprocess, having opened nothing
([ADR-0040](context/adr/0040-git-already-named-every-files-content.md)). The
working tree is not the commit, so the porcelain status is read too and every path
it names is re-hashed from disk by `hash-object`; a file edited back to its
committed contents lands on its committed digest and costs nothing. Those digests
carry a `git:` prefix, because this project's own digests are `v1:` and comparing
the two schemes as though they were one must be impossible rather than unlikely.

**A digest names what parsing produced.** The parse cache holds exactly what a
file's bytes said — requests, exports, declarations — and nothing about where the
file sits, because that is what makes it cacheable forever.

**A digest plus the shape of the tree names the whole record.** An edge is not a
function of bytes alone: where `./button.css` points depends on the directory the
specifier sits in, on which files exist around it, on `tsconfig` paths and on
what is installed. A record is a function of exactly four things, and
`layoutOf` in [`packages/sense/src/reuse.ts`](../packages/sense/src/reuse.ts)
names the last two in one digest:

| | named by |
|---|---|
| the file's bytes | its content digest |
| where the file sits | its path, which is the key |
| which paths exist | the layout digest |
| how resolution is configured | the layout digest |

The layout digest covers the path *set* rather than a sample of it, because
resolution is decided by absence as much as by presence: `./button` finds
`button.ts` only while no `button.tsx` sits beside it. It also folds in the
contents of the files that decide where *other* files resolve — every
`package.json`, `tsconfig*.json`, `jsconfig.json` and lockfile — so a `paths`
edit that redirects every `@/` specifier in the repository moves the digest with
it.

The trade is one-sided and deliberate: adding, deleting or renaming any file
moves the layout and costs one full scan, and every run that only edits files
costs the diff. The scanned directories are deliberately *not* in the digest,
since they decide which records a scan produces and never what any one record
contains — so a narrow run can reuse a wide run's work and neither invalidates
the other. What all of this is worth in milliseconds is measured in
[`selecting.md`](selecting.md).

Reuse is off without digests, and that is not a policy: a record that names no
bytes cannot be checked against the bytes on disk, so there is nothing to reuse it
against.

## From records to a graph

The records are I/O; the graph is not, and it lives in
[`packages/core`](../packages/core) with no disk under it. Nodes are interned to
integer ids, edges are stored compressed-sparse-row, and both directions are
materialized, because the traversal that matters runs *backwards* — from a
changed file to everything that rests on it.

Six edge kinds are kept, and they are kept because they explain a finding rather
than because the default traversal narrows on them:

| kind | |
|---|---|
| `imports` | a value import |
| `reexports` | an import that also republishes |
| `dynamic` | `import()` with a literal specifier |
| `type` | erased before anything renders, and still walked by default |
| `asset` | a stylesheet's `@import`, or a `url()` reaching a font or an image |
| `declared-in` | a component to the file that declares it |

`type` is the one worth stating: every compiler erases it, so it can move no
pixel, and the default traversal walks it anyway. A subject skipped in error is a
green run over an unwatched surface; a subject observed in error costs one
collection.

`movedBy` walks the changed set backwards and returns the files and components it
reached, the changed paths the graph holds no node for, the files seeded because
their own edges are unknown, and a breadth-first trail per node — so a report can
say *why* a subject was included, one hop at a time, rather than asserting that it
was
([ADR-0039](context/adr/0039-the-digest-is-the-proof-the-trail-is-the-explanation.md)).
Above that sits a Merkle closure: one digest per node covering everything it
rests on, with cycles condensed so a strongly-connected component hashes as a
unit, and anything downstream of an unknown marked volatile rather than digested.
**Selection does not use it.** `closureOf` and `driftedBetween` are complete and
tested and their callers are their own tests — a closure digest is only a fact
against an earlier one, and nothing writes one down. So `--since` resolves to a
git diff and inherits every way a shallow clone, a rebase or a wrong ref can
shape one; the closure is what would replace that, and it is
[spec 0026](specs/0026-selection-by-closure-digest.md)'s to finish.

## The transform that records the path

The graph answers what a change could reach. It cannot answer what a run *took* —
rendering is a series of choices, and a file graph sees both sides of every fork.

`@variance-authority/sense/instrument` is the other half's foundation: a pure
function of a string, `instrument(source, id)`, which parses, decides where the
execution boundaries are, and splices a recording call in front of each one. No
disk, no runner, no index, so it is testable against a fixture — and **no
command instruments anything.** Its callers are two benchmark scripts and a
vitest config; there is no flag, no config key, and nothing that reads
`globalThis.__VA__` back. What follows is a measurement of the transform, not a
description of what a run does.

Its probe set is smaller than statement coverage by design. Istanbul's own
visitor rules, counted on the same trees, put **2.5× as many** counters in the
same code; this is **0.40×** of every counter it inserts. The saving is not in
functions — both give every function one entry site — it is that a run of
statements with no decision in it is *one region*: on this repository's own
source, 13,692 statements collapse to 2,123 continuations. A decision carries no
probe of its own; its outcomes do, including the synthesized `else` of a bare
`if`, because a change to the condition must reach every test that ever evaluated
it.

Three properties make the emitted code safe to run everywhere:

- **Lines are preserved exactly.** Every insertion is single-line, so a stack
  trace, a `sourceMappingURL` and a coverage tool reading the same file all still
  agree about line numbers. Probes are spliced at UTF-16 offsets rather than
  re-printed, so the output stays diffable.
- **The runtime is a global, and its absence is not a crash.** The header
  resolves `globalThis.__VA__` on first use and falls back to a private array,
  so the same file produces the same results with and without a runtime — which
  is what differential execution needs.
- **A probe survives leaving its realm.** Every call site is guarded by `typeof`:
  `page.evaluate(fn)`, `new Function(fn.toString())` and a worker built from a
  stringified closure all lose this module's scope, and unguarded that is a
  `ReferenceError` in instrumented builds only. Guarded, it records nothing —
  which is the correct answer, since that execution happened somewhere this index
  does not reach.

A source it cannot parse returns nothing rather than throwing, because a file
whose blocks are unknown is *not instrumented*, never *not executed*
([ADR-0008](context/adr/0008-per-profile-expectations.md)).

The counters half is measured: `yarn workspace @variance-authority/sense
overhead` instruments a copy of this package's own build, runs its scan against a
generated tree, and measures a third, uninstrumented copy the same way, so every
ratio is reported beside the noise floor of the machine it was taken on. At
545,000 increments per run, the probed copy lands inside the band a second
identical build produces against the first. `yarn workspace
@variance-authority/sense census` prints the probe density beside the absolute
counts. What the transform feeds, and what a runner would have to hold, is
[spec 0027](specs/0027-a-test-is-selected-by-what-it-executed.md) and
[spec 0028](specs/0028-the-instrument.md).

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

**A file git cannot see does not move the layout.** The layout is built from the
digest map, which comes from the object database, so a generated file under a
`.gitignore` can never appear in a diff and can never carry a change — but it
can, in principle, shadow a resolution. That is the one gap, it is bounded by
`git add`, and turning digests off turns the whole mechanism off.

---

**Further:** [`selecting.md`](selecting.md) for what a run does with this graph ·
[`packages/sense`](../packages/sense) for the API ·
[ADR-0038](context/adr/0038-a-change-reaches-a-component-through-files.md) for
why a change reaches a component through files ·
[ADR-0041](context/adr/0041-a-request-is-the-edge-a-binding-is-the-name.md) for
requests and bindings ·
[ADR-0040](context/adr/0040-git-already-named-every-files-content.md) for the
digests · [`attribution.md`](attribution.md) for the other direction, from a
changed pixel back to a line.
