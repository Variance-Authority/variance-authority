# Source scan reference

The **source scan** turns a checkout into one stable record per file: resolved
outgoing edges, component declarations, content identity, and any reason the
edge list is incomplete. This page defines that contract—what the scan reads,
how to interpret its records, what makes an answer reusable, and where the
answer stops.

Selection is a separate decision. The scan can establish that a change reaches
a component; it does not decide which subjects or tests may be skipped.
[`selecting.md`](selecting.md) owns that user-facing consequence, while
[`execution-record.md`](execution-record.md) owns the coverage data showing which
regions a test actually entered.

The public scan is `scanRelations` from
[`@variance-authority/sense`](../packages/sense). The graph built from its
records belongs to [`@variance-authority/core`](../packages/core), which opens no
files.

## Lookup map

| Need | Contract |
|---|---|
| Read a checkout | [`scanRelations`](#scan-inputs) |
| Read source text already held by an editor, VFS or build | [`readModule` and `readStyle`](#requests-bindings-and-published-names) |
| Interpret one returned file | [`FileRecord`](#file-records) |
| Distinguish a missing package from an incomplete edge list | [Unresolved and unknown](#unresolved-and-unknown) |
| Ask which edge kinds a runtime walk follows | [Graph handoff](#graph-handoff) |
| Reuse work safely across scans | [Content and resolution reuse](#content-and-resolution-reuse) |
| Inspect the persisted columns | [Source index format](source-index.md) |
| Inspect keys, lookups and asymptotic costs | [Source index structures](source-structures.md) |

## Scan inputs

`scanRelations(options)` returns `Promise<readonly FileRecord[]>`.

| Option | Default | Contract |
|---|---|---|
| `root` | required | Repository root. Every returned path is relative to its real path. |
| `dirs` | required | Directories from which traversal starts. They are seeds, not a traversal boundary. |
| `tsconfig` | `"auto"` | A specific configuration, or nearest-config discovery per importing file. |
| `conditionNames` | `source, import, require, default` | Export conditions, in resolution order. |
| `digests` | Git digests when available | A caller-supplied digest map; `false` reads and hashes files directly and disables record reuse. |
| `cache` | in memory | Parse cache, keyed by content and the way the filename says to read it. |
| `reuse` | off | Record cache. It is consulted only when content digests are available. |
| `largestFile` | 1 MiB | Maximum file size the scan opens. Larger files become unknown rather than being parsed. |
| `parsed` | absent | Receives the repository-relative path and cached parse once per readable file, including reused records when their parse remains available. |

The prerequisites are a readable checkout, installed dependencies for bare
specifier resolution, and any path mappings the source relies on. Persistence
is optional: without it the returned records are the same and the scan repeats
more work.

`readModule(file, contents)` and `readStyle(file, contents)` are exported from
`@variance-authority/sense/read` for callers that already hold source text. They
read requests and names without resolving anything or opening the checkout.

## Requests, bindings and published names

A **request** is one import, re-export, literal `import()`, or literal
`require()` and keeps its specifier exactly as written. A **binding** is one name
that request brings into the file, including whether the binding is type-only.
They are separate because neither statement-level edges nor name-level edges
can represent both facts without loss.

For example, this syntax produces one request for `./ui` and two bindings:

```ts
import { Card, type Props } from './ui';
```

`Card` survives compilation; `Props` does not. Keeping both on one request also
means a barrel republishing fifty names still contributes one file edge rather
than fifty copies of the same edge.

Module reading covers static imports, re-exports, literal dynamic imports and
literal `require()` calls. It also keeps published names. `export * from './ui'`
has a known file request but an open-ended export set, so its export row has no
exported name; absent is not interpreted as an empty set.

The module record supplies these facts without making the full syntax tree part
of the retained result. Stylesheets use a conservative text reading instead:
`@import`, `@use`, `@forward`, `url()` and CSS Modules `composes … from` become
whole-file asset requests. A request found inside a CSS comment may therefore
over-include. That costs work; missing a real request could skip work, so the
reader favours the safe direction.

The request set is explicitly incomplete when the parser reports an error, a
dynamic import is not a literal, or a `require()` target cannot be read as a
literal. The returned reading carries the reason rather than presenting a
partial list as complete.

## Resolution

Reading answers *what was requested*. Resolution answers *which repository file
could satisfy it*. Keeping those questions separate makes the first answer
portable and keeps resolution settings from changing what counts as an import.

Three resolution modes keep unlike requests apart:

| Mode | Contract |
|---|---|
| Module | JavaScript and TypeScript modules, including `.js` to TypeScript rewriting for `nodenext` source. |
| Style | Stylesheet extensions only, so a stylesheet request cannot resolve to a module. |
| Exact | No extension rewriting, used when accepting a rewritten target would hide a mismatch. |

Sass partials are tried as a second spelling. `tsconfig: "auto"` resolves each
request under the project governing its importing file, which matters when two
files in one directory belong to solution-style projects whose path mappings
disagree.

Every accepted target is canonicalized to the spelling on disk. A case-only
match is rejected on a case-insensitive filesystem, preventing a graph that
names a path no case-sensitive checkout contains.

### Traversal and repository boundaries

`source.dirs` identifies where the scan starts. It does not fence the graph. A
file under `src/` that imports `../design/button.css` brings that stylesheet into
the result, and the stylesheet's own requests continue the walk. Directories the
scan never descends into are fixed: `node_modules`, `dist`, `build`, `coverage`,
`.git`, `.next`, and `.turbo`.

Traversal stops at the repository edge. Builtins, installed dependencies, and
paths above `root` cannot be named by a diff in this repository, so they do not
become file edges.

A workspace package boundary can stop the same way. A bare package request often
resolves through a symlink to that package's built output, and built output is
excluded because it is not what a repository diff names. A package publishing a
source condition can produce an ordinary source edge; otherwise a workspace
project graph supplies the missing relationship as additional changed seeds.
[`selecting.md`](selecting.md#what-nx-and-turbo-know-that-a-scan-cannot) owns how
those seeds affect a run.

## File records

Records are sorted by repository-relative path in code-unit order, so one tree
produces byte-stable graph input across machines.

| Field | Meaning |
|---|---|
| `file` | Repository-relative path and record key. |
| `digest` | Content digest when one is available. |
| `edges` | Resolved outgoing targets with their edge kinds, deduplicated and sorted. |
| `declares` | Component names declared by this file. Test, spec, story and declaration files are not component declarations. |
| `unresolved` | Specifiers that produced no repository file, preserved as written. |
| `unknown` | Sentence explaining why outgoing edges could not be enumerated completely. |

An unreadable file still receives a record. Its `unknown` sentence is the
answer; an empty edge list would make the stronger and unsafe claim that it
depends on nothing. A file above `largestFile` behaves the same way and says
both its size and the configured cap.

### Unresolved and unknown

An unresolved request is not always a hole in the same boundary:

| Request | Record | Consequence |
|---|---|---|
| Relative, such as `./button` | Added to `unresolved` and to the `unknown` reason | It names repository source that could not be identified, so the edge list is incomplete. |
| Bare, such as `react` or `@scope/ui` | Added to `unresolved` only | It normally names a dependency outside this repository; the file's repository edge list remains usable. |
| Builtin, `data:` URL, or an external URL | No repository edge | No repository file can answer it. |

This distinction is conservative in both directions. Treating a missing
relative target as an external package could skip its dependants. Treating every
missing package as an unknown repository edge would make an uninstalled optional
dependency widen every traversal.

## Graph handoff

`relationsOfFiles` turns file records into an interned, bidirectional graph. The
edge convention is always `A → B` means **A depends on B**. A component therefore
points to the file declaring it, and one walk against the arrows from a changed
file reaches importers and components together.

| Edge kind | Relationship |
|---|---|
| `imports` | Value import. |
| `reexports` | Import that also republishes. |
| `dynamic` | Literal `import()`. |
| `type` | Type-only request, erased before runtime. |
| `asset` | Stylesheet request, font, image, or another non-module target. |
| `declared-in` | Component to the file declaring it. |

Type-only edges remain in the graph because source-oriented questions need
them. The default reach and closure use `RUNTIME_EDGES`, every kind except
`type`: a type-only dependency runs no test and paints no pixel. A caller asking
about source—for example a documentation generator reading prop types—passes
`EDGE_KINDS` or another explicit set.

Files with `unknown` edges are retained as unknown nodes. `movedBy` seeds every
such file alongside the changed set, because it may import the changed file.
The result distinguishes files and components reached normally, changed paths
missing from the graph, unknown files that widened the walk, and the
breadth-first trail explaining each arrival. Selection decides what to do with
those facts; the graph does not rule a subject out by itself.

## Content and resolution reuse

Repeated scans avoid work in layers, each keyed by the facts that can safely
answer it.

### Content digests

Git can name tracked and unignored untracked contents without the scan opening
every file. The committed tree supplies blob ids; working-tree status identifies
paths that must be re-hashed from disk. A file edited back to its committed
contents therefore returns to the committed digest.

Git object ids carry a `git:` prefix and scan-computed digests carry `v1:`. They
are different schemes and never compare as though they were interchangeable.
Outside a Git checkout, or when Git cannot answer, the scan reads and hashes
files itself.

### Parse reuse

A parse is keyed by content digest plus the way the filename says to read those
bytes: its extensions select a source dialect or stylesheet reader, and names
such as `.test.ts` change whether declarations count as components. Resolution
is deliberately absent from this key. Two files with the same key contain the
same requests, bindings, exports and declarations wherever they sit.

### Record reuse

A resolved record depends on four things:

| Input | Named by |
|---|---|
| File bytes | Content digest. |
| File position | Repository-relative path. |
| Resolution configuration | Digest of manifests, lockfiles, `tsconfig` and `jsconfig` contents, requested `tsconfig`, and condition names. |
| Paths that could have answered this file's requests | Witness directories. |

Witnesses come from the request, not only the successful answer. A request for
`./button` witnesses the importing directory and the possible `button`
directory even when neither currently answers, because a new file can turn that
absence into an edge without changing the importing file's bytes. A resolved
target's directory is also witnessed for redirects such as `package.json`
`main`.

A resolution-configuration change invalidates all resolved records while
leaving content-keyed parses reusable. A directory membership change
invalidates only records that witnessed that directory. When configuration is
unreadable and no honest bound for bare specifiers can be derived, the whole
path set enters the configuration digest and any path move invalidates the
record layer.

The configured seed directories are not part of either reuse key. They decide
which records a scan asks for, not what any one record means, so a narrow scan
can reuse records from a wider one.

Parse and record layers may persist together through `openSourceIndex`. The
versioned binary generation, immutable segments and publication rules are
defined in [`source-index.md`](source-index.md). With warm state, edits rebuild
their changed records and path additions rebuild records watching the affected
directories; the scan still visits the graph it returns. Current measured cold,
warm and changed-tree costs are kept in [`performance.md`](performance.md).

## Limits

**The scan is not a build.** It follows syntax and configured resolution. A
caller can layer declared taints over the returned records, but a bundler plugin
that invents or rewrites requests can still create an edge the scan does not
see. A missing relative target becomes unknown and widens; a missing bare target
remains an unresolved package request. Supply the relationship through supported
configuration, a project-graph seed, or a taint rather than treating a quiet
record as build equivalence.

**Generated files hidden from Git can shadow resolution.** The directory map is
built from the digest map, and Git does not report ignored files. An ignored
generated file can therefore appear or disappear without moving a witness
directory even though it changes which path a request resolves to. Tracking the
file closes the gap. `digests: false` disables content- and layout-based record
reuse when the checkout must be read without that assumption.

**Package edges are conditional.** Source exports and path mappings can keep a
workspace edge inside the repository. Built-output resolution does not; the
workspace tool's affected-project answer supplies that boundary at project
granularity.

**Large files become unknown.** The default one-megabyte cap prevents generated
barrels and bundles from consuming a scan's memory budget. Raising
`largestFile` accepts that cost for a file the caller intentionally wants read.

**Static reach is possibility, not execution.** The graph includes both sides
of a branch. Execution recording supplies which regions a particular test or
subject entered, and [`selecting.md`](selecting.md) defines how the two grounds
combine.

---

**Further:** [`source-index.md`](source-index.md) for the persisted binary
format · [`source-structures.md`](source-structures.md) for keys, lookups and
complexity · [`selecting.md`](selecting.md) for selection behavior ·
[`execution-record.md`](execution-record.md) for observed execution ·
[`packages/sense`](../packages/sense) for the public API.
