# Source scan reference

The **source scan** is what stands behind a report that names a component your
change did not obviously touch. It reads your checkout without executing any of
it, and everything that decides what work a change can affect walks what it
wrote.

The scan turns a checkout into one stable record per file: resolved outgoing
edges, component declarations, content identity, and any reason the edge list is
incomplete. A run walks those records to decide which components, tests and
**subjects** — a subject is one named UI state you asked for and can ask for
again, such as `cart/empty` — a change can reach, so the run covers the affected
work rather than the whole suite.

Read this page when you are calling the scan from your own tooling, or when a
report named a component you expected it to miss, or missed one you expected it
to name. It defines what the scan reads, how to interpret its records, what
makes an answer reusable, and where the answer stops.

Selection is a separate decision. The scan can establish that a change reaches
a component; it does not decide which subjects or tests may be skipped.
[`selecting.md`](selecting.md) owns that user-facing consequence, while
[`execution-record.md`](execution-record.md) owns the coverage data showing which
regions a test actually covered.

## Install and call

```bash
npm install --save-dev @variance-authority/sense
```

`scanRelations` reads the checkout and returns the records;
`relationsOfFiles` and `affectedBy` from `@variance-authority/core` turn them into
an answer about one change.

```ts
import { affectedBy, relationsOfFiles } from '@variance-authority/core/relate';
import { scanRelations } from '@variance-authority/sense';

const records = await scanRelations({ root: '.', dirs: ['src'] });
// records[0] ->
// {
//   file: 'src/components/Button.tsx',
//   digest: 'git:9f2c…',
//   edges: [{ to: 'src/tokens.css', kind: 'asset' }, …],
//   declares: ['Button'],
// }

const affected = affectedBy(relationsOfFiles(records), ['src/tokens.css']);

affected.files;      // files the change can reach, the changed file included
affected.components; // component names declared in any of them
affected.missing;    // changed paths the graph does not hold
```

`scanRelations(options)` returns `Promise<readonly FileRecord[]>`.
`readModule(file, contents)` and `readStyle(file, contents)` are exported from
`@variance-authority/sense/read` when you already have the source text: they
read requests and names without resolving anything or opening the checkout.

## Lookup map

| Need | Contract |
|---|---|
| Read a checkout | [`scanRelations`](#scan-inputs) |
| Check whether a file extension is read | [Extensions](#extensions) |
| Reach a workspace package's source instead of its `dist` | [Workspace packages](#workspace-packages) |
| Resolve a `@/…` alias | [Resolution](#resolution) |
| Read source text an editor, VFS or build already has | [`readModule` and `readStyle`](#install-and-call) |
| Interpret one returned file | [`FileRecord`](#file-records) |
| Distinguish a missing package from an incomplete edge list | [Unresolved and unknown](#unresolved-and-unknown) |
| Ask which edge kinds a runtime walk follows | [Graph handoff](#graph-handoff) |
| Reuse work safely across scans | [Content and resolution reuse](#content-and-resolution-reuse) |
| Inspect the persisted columns | [Source index format](source-index.md) |
| Inspect keys, lookups and asymptotic costs | [Source index structures](source-structures.md) |

## Scan inputs

| Option | Default | Contract |
|---|---|---|
| `root` | required | Repository root. Every returned path is relative to its real path. |
| `dirs` | required | Directories from which traversal starts. They are seeds, not a traversal boundary. |
| `tsconfig` | `"auto"` | A specific configuration, or nearest-config discovery per importing file. |
| `conditionNames` | `source, import, require, default` | Export conditions, in resolution order. |
| `digests` | Git digests when available | Your own digest map; `false` reads and hashes files directly and disables record reuse. |
| `cache` | in memory | Parse cache, keyed by content and the way the filename says to read it. |
| `reuse` | off | Record cache. It is consulted only when content digests are available. |
| `largestFile` | 1 MiB | Maximum file size the scan opens. Larger files become unknown rather than being parsed. |
| `parsed` | absent | Receives the repository-relative path and cached parse once per readable file, including reused records when their parse remains available. |

The prerequisites are a readable checkout, installed dependencies for bare
specifier resolution, and any path mappings the source relies on. Persistence
is optional: without it the returned records are the same and the scan repeats
more work.

### Extensions

The scan opens two sets of extensions and no others. Everything else on disk is
a file it can point at but never reads:

| Set | Extensions | Read for its own requests |
|---|---|---|
| Module dialects | `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` | Yes |
| Stylesheets | `.css`, `.scss`, `.sass`, `.less` | Yes |
| Everything else | `.vue`, `.svelte`, `.astro`, `.mdx`, `.json`, `.md`, `.html`, images, fonts | No |

A file under `dirs` with one of the first two sets gets a record. A file with
any other extension gets none and is never a traversal seed. If your components
live in single-file `.vue` or `.svelte` modules, the scan never learns what they
import, so a change to a file one of them uses does not reach it.

Such a file can still be an edge target. The edge kind follows the target, not
the syntax that asked for it, so `import './App.vue'`, `import './icon.svg'` and
`import data from './data.json'` each record an `asset` edge to a repository
path. Editing that path marks its importers; nothing continues from the far
side, because there is no record there to continue from.

`.json` is also tried during extensionless resolution, after every module and
stylesheet extension: `./config` finds `src/config.json` when nothing else
answers, and records the same `asset` edge.

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
`@import`, `@use`, `@forward`, `url()` and CSS Modules `composes … from`
become whole-file asset requests. A request found inside a CSS comment may
over-include. That costs work; missing a real request could skip work, so the
reading errs towards over-including.

The request set is explicitly incomplete when the parser reports an error, a
dynamic import is not a literal, or a `require()` target cannot be read as a
literal. The returned reading names the reason rather than presenting a
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

`paths` from that configuration are honoured. With

```json
{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }
```

`import { Button } from '@/components/Button'` records an ordinary `imports`
edge to `src/components/Button.tsx`. Discovery walks up from the importing file,
so an alias table declared once at the repository root and inherited through
`extends` in each package needs nothing configured on the scan.

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

### Workspace packages

A bare request for a package in the same repository resolves through the
`node_modules` symlink onto that package's real directory, and the package's own
manifest decides which file it lands on. The excluded directories apply to
resolved targets as well as to traversal, so a manifest naming only built output
produces no edge:

```json
{ "name": "@scope/ui", "exports": { ".": { "default": "./dist/index.js" } } }
```

`import { Button } from '@scope/ui'` lands on that package's `dist/index.js`,
which is outside the graph. The importing record keeps `@scope/ui` under `unresolved`
and has no `unknown` reason, because a bare specifier normally names a
dependency rather than repository source. An edit to the package's own
`src/Button.tsx` then reaches nothing in the consuming package.

Three arrangements give the edge back, and one is enough.

**A `source` export condition.** `source` leads the default `conditionNames`,
ahead of `import`, `require` and `default`:

```json
{
  "name": "@scope/ui",
  "exports": { ".": { "source": "./src/index.ts", "default": "./dist/index.js" } }
}
```

The same request now records `imports → packages/ui/src/index.ts`, and the walk
continues through that package's files like any other.

**A top-level `source` field**, for a package with no `exports`. The main fields
are read as `source`, `module`, `main`.

**A `tsconfig` path mapping**, which asks nothing of the package manifest:

```json
{ "compilerOptions": { "baseUrl": ".", "paths": { "@scope/*": ["packages/*/src"] } } }
```

When none of the three is available—a vendored package, or a manifest you do not
own—the relationship stays outside the scan, and a workspace tool supplies it at
project granularity. `source.changes` in the CLI configuration asks `nx` or
`turbo` which projects a diff affects and treats every file under each named
project as changed input:

```json
{ "source": { "changes": { "tool": "turbo", "task": "build" } } }
```

That widens by whole package rather than by file, and it is the only path that
does not require a manifest or alias change.
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
| `declares` | [Component names](#component-declarations) declared by this file. Test, spec, story and declaration files are not component declarations. |
| `unresolved` | Specifiers that produced no repository file, preserved as written. |
| `unknown` | Sentence explaining why outgoing edges could not be enumerated completely. |

An unreadable file still receives a record, with the edges that could be read
and an `unknown` sentence naming what could not. The walk uses the edges; the
edge behind the sentence is the [execution record](execution-record.md)'s to
answer, since a module that loads under a test is recorded however it was
named. A file above `largestFile` behaves the same way and says
both its size and the configured cap.

### Component declarations

**The scan recognises React components only.** It reads no other framework's
component model, so on a Vue, Svelte, Angular or Solid codebase `declares` is
empty, no `declared-in` edge exists, and `affected.components` comes back empty.
File-level reach is unaffected: you still get which files a change can reach.

A component is one the source spells as a `function`, `const`, `let` or `class`
declaration whose name begins with an uppercase letter, exported or not. Those
names are what `declares` lists, and what a `declared-in` edge points from.
Recognition reads the declaration line, not the value behind it, so these are
all named:

```tsx
export const Row = memo(Inner);
export const Card = forwardRef(Inner);
export const Panel = styled.div`color: red`;
export const Field = withTheme(Inner);
```

What is missed is a component that never gets a capitalised name at its
declaration:

```tsx
export default memo(function Row() {});     // no name on the line
export default forwardRef(Inner);           // no name on the line
export { Inner as Row } from './inner';     // renamed by a re-export
Widget.Row = Inner;                         // assigned after the fact
```

A missed component leaves a report naming the component without a file, which
is what the report said before the index existed. The error runs the other way
too: any capitalised `const` counts, including one whose value is a hook, a
schema or a constant, and including one declared inside another function. A
false positive can only surface for an identifier something else already named.

### Unresolved and unknown

An unresolved request is not always a hole in the same boundary:

| Request | Record | Consequence |
|---|---|---|
| Relative, such as `./button` | Added to `unresolved` and to the `unknown` reason | It names repository source that could not be identified, so the edge list is incomplete. |
| Bare, such as `react` or `@scope/ui` | Added to `unresolved` only | It normally names a dependency outside this repository; the file's repository edge list remains usable. |
| Builtin, `data:` URL, or an external URL | No repository edge | No repository file can answer it. |

A relative request names repository source, so the file's reason says an edge
is missing and which one. A bare request normally names a dependency, and
recording it as a missing repository edge would put every uninstalled optional
dependency in that list.

## Graph handoff

`relationsOfFiles` turns file records into a bidirectional graph. The
edge convention is always `A → B` means **A depends on B**. A component
points to the file declaring it, and one walk against the arrows from a changed
file reaches importers and components together.

| Edge kind | Relationship |
|---|---|
| `imports` | Value import. |
| `reexports` | Import that also republishes. |
| `dynamic` | Literal `import()`. |
| `type` | Type-only request, erased before runtime. |
| `asset` | Stylesheet request, font, image, JSON, or another target the scan does not open. |
| `declared-in` | Component to the file declaring it. |

Type-only edges remain in the graph because source-oriented questions need
them. The default reach and closure use `RUNTIME_EDGES`, every kind except
`type`: a type-only dependency runs no test and paints no pixel. To ask about source instead — a
documentation generator reading prop types, say — pass `EDGE_KINDS` or another
explicit set. `relationsOfFiles`, `affectedBy`,
`RUNTIME_EDGES` and `EDGE_KINDS` are all exported from
`@variance-authority/core/relate`.

Files with `unknown` edges are retained as nodes with the edges that were read,
and `affectedBy` walks them like any other. It seeds the changed files and
nothing else. The result distinguishes files and components the change
affects, changed paths missing from the graph, and the breadth-first trail
explaining each arrival. Selection decides what to do with
those facts; the graph does not rule a subject out by itself.

## Content and resolution reuse

Repeated scans avoid work in layers, each keyed by the facts that can safely
answer it.

### Content digests

Git can name tracked and unignored untracked contents without the scan opening
every file. The committed tree supplies blob ids; working-tree status identifies
paths that must be re-hashed from disk. A file edited back to its committed
contents returns to the committed digest.

Git object ids start with `git:` and scan-computed digests with `v1:`. They are
different schemes and never compare as though they were interchangeable.
Outside a Git checkout, or when Git cannot answer, the scan reads and hashes
files itself.

### Parse reuse

A parse is keyed by content digest plus the way the filename says to read those
bytes: its extensions select a source dialect or stylesheet reader, and names
such as `.test.ts` change whether declarations count as components. Resolution
is absent from this key. Two files with the same key contain the
same requests, bindings, exports and declarations wherever they sit.

### Record reuse

A resolved record depends on four things:

| Input | Named by |
|---|---|
| File bytes | Content digest. |
| File position | Repository-relative path. |
| Resolution configuration | Digest of manifests, lockfiles, `tsconfig` and `jsconfig` contents, requested `tsconfig`, and condition names. |
| Paths that could have answered this file's requests | The directories a request looked in, answered or not. |

The fourth input counts directories a request looked in even when nothing
answered. A request for `./button` counts the importing directory and a possible
`button` directory while both are empty, because adding a file there turns that
absence into an edge without changing the importing file's bytes.

So: change a `tsconfig`, a manifest or a lockfile and every resolved record is
rebuilt, while the content-keyed parses stay reusable. Add or remove a file and
only the records that looked in that directory are rebuilt. When the
configuration cannot be read, every record is rebuilt on any path change.

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

**The scan is not a build.** It follows syntax and configured resolution. You can layer declared taints over the returned records, but a bundler
plugin that invents or rewrites requests can still create an edge the scan does
not see. A missing relative target becomes unknown and widens; a missing bare target
remains an unresolved package request. Supply the relationship through supported
configuration, a project-graph seed, or a taint rather than treating a quiet
record as build equivalence.

**A Git-ignored generated file can shadow resolution.** The scan learns the
tree's layout from Git, and Git does not report ignored files. A generated file
your `.gitignore` covers can appear or disappear without the scan
noticing, even though it changes which path a request resolves to, and a reused
record then names the wrong target. Track the file, or pass `digests: false`,
which reads and hashes the checkout directly and turns record reuse off.

**Package edges are conditional.** A `source` export condition, a `source` main
field or a path mapping keeps a workspace edge inside the repository; a manifest
resolving only to built output does not, and the workspace tool's
affected-project answer supplies that boundary at project granularity. See
[Workspace packages](#workspace-packages).

**Large files become unknown.** The default one-megabyte cap prevents generated
barrels and bundles from consuming a scan's memory budget. Raising
`largestFile` accepts that cost for a file you want read anyway.

**Components are React's, and only where the source names them.** On another
framework `declares` is empty; on React, a component that never has a
capitalised name at its declaration is missed. See
[Component declarations](#component-declarations).

**Static reach is possibility, not execution.** The graph includes both sides
of a branch. Execution recording supplies which regions a particular test or
subject covered, and [`selecting.md`](selecting.md) defines how the two grounds
combine.

---

**Further:** [`source-index.md`](source-index.md) for the persisted binary
format · [`source-structures.md`](source-structures.md) for keys, lookups and
complexity · [`selecting.md`](selecting.md) for selection behavior ·
[`execution-record.md`](execution-record.md) for observed execution ·
[`packages/sense`](../packages/sense) for the public API.
