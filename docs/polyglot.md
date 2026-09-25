# How different languages are handled

[Variance Authority](README.md) is built for React frontends, and that is what
most of these pages are about. That does not mean it only reads JavaScript.
Its own checkout is TypeScript over a Rust scanner, so the first repository it
could not read in full was its own — and it now reads JavaScript and TypeScript
in every dialect, stylesheets, Python, Rust, Java, Kotlin and Swift. One reader
per language writing into one graph with one kind of node is what **polyglot**
means here, and a diff that spans several of them is answered in one walk.

You do not need a subject, a baseline or a configuration file to use that half.
Ask what a diff reaches and pipe the answer at whatever runs your tests. The
commit below touched a React component and a Python pricing rule together,
which is the case this page is about:

```bash
variance reach --since origin/main
```

```text
src/checkout/CartSummary.tsx
src/checkout/CartSummary.test.tsx
src/checkout/total.ts
src/checkout/cart.css
services/pricing/rules.py
services/pricing/tests/test_rules.py
```

One list, two runners:

```bash
variance reach --since origin/main | grep '\.test\.tsx$' | xargs -r vitest run
variance reach --since origin/main | grep '/test_.*\.py$' | xargs -r pytest
```

The list names every file the change can reach, one per line, with the changed
files among them except those whose edit changes nothing that runs.
`--format json` returns the same answer with what was left out of it beside it. No project configuration is read, and `--since` has no default:
the command is asked by a repository whose tests something else runs, and
guessing a ref there would be guessing what a build is about to skip.

## Walked from what the edit changed

`jest --changedSince`, `vitest --changed` and Playwright's `--only-changed` walk
the import graph from every file a diff touched, so a comment in a module every
test imports runs every test. `variance reach` reads each changed file before
and after the edit and walks the same graph from what the edit changed. An edit
that changes nothing that runs selects nothing.

The [Zod](selection-zod.md) and [TanStack Query](selection-tanstack-query.md)
case studies each start from sixty commits made before the instrumentation
landed. Each commit is checked against a record made at its parent commit: you
ask four selectors which test files to run, and count the answers in one unit,
the test files in the parent's record. A file selected on five commits counts
five times. The first row is the baseline, every test file on every commit. On
Zod, which has one package, the package graph is read from the workspace
manifests:

| | TanStack Query | Zod |
| --- | --- | --- |
| every test file on every commit | 11,280 | 12,120 |
| the package graph (`nx affected` on TanStack Query) | 3,464 | 8,047 |
| the file graph, `variance reach --whole-files` | 1,470 | 4,531 |
| walked from what the edit changed, `variance reach` | 441 | 4,142 |
| the [execution record](execution-record.md), `variance select` | 775 | 5,196 |

On TanStack Query the default walk selects 1,029 fewer test files than the file
graph. 885 of them come from edits that change nothing that runs, and 717 of
those from five commits that edit comments in `types.ts`, which nearly every
test imports. The other 144 come from changed exports: an edit to
`streamedQuery` selects 9 test files, where the file graph selects 143. On Zod
the walk selects 389 fewer, because most of Zod's tests import the library
through one namespace, `import * as z`, and the walk is whole wherever an import
names no export.

The record answers from which lines each test ran, so a namespace import does
not widen it. On Zod it selects fewer test files than the walk on 12 of the
sixty commits, 798 fewer in all, and on TanStack Query it selects as few as 23
where the walk selects 143. Those are commits that change the inside of a
function: the record knows which of the files that load the module ran it.

The record also selects tests that neither walk can, because it knows what
each test ran under as well as what it imported. Zod runs its main package's
tests a second time under a compile-mode project whose setup file imports the
core, so code that runs as the core loads, such as a regular expression
constant or the locale index, runs in every test in that project, including the
ones that import none of it. On ten commits that change such code the record
selects 200 or more where the walks select about 130.

Configuration is read per project. Each TanStack Query project's Vite
configuration imports its own `package.json`, and a change to a file that a
project's configuration reads reruns that project's tests and no other
project's: a commit that edits the four devtools manifests reruns 14 test files
of 188. Four commits that edit package manifests are 553 of the record's 775.
Neither walk treats a manifest as a changed file, so both select nothing on
those commits. Without them the record selects 222, against the walk's 441.

A changed JavaScript or TypeScript file is read from both of its texts before the
walk starts. When the edit is a comment, a type or formatting, the file runs
what it ran before, so nothing is walked from it and it is not in the list.
Stderr names it. Two edits of that kind change what runs and are walked from: a
JSX pragma such as `@jsxImportSource`, and a type in a decorated class, which
`emitDecoratorMetadata` can write into the class. A file in another language,
and a file that was added, deleted or does not parse, is walked from as a whole
file.

When the edit changes some of a file's exports and nothing that runs as the
module loads, the walk starts from those exports and not from the whole file. An
export is changed when its own code changed, or when anything it uses at the top
level of the same file changed: a function, a constant, a `let` that a changed
function writes. If `cart.ts` changes `total` and leaves `label` as it was, a file
that imports `total` is in the list and a file that imports only `label` is not.
A barrel passes each changed export on under the name it gives it, so
`export { total as sum } from './cart'` puts every file that imports `sum` in
the list. Stderr names the changed exports of each file, and `--format json` lists them
under `exports`.

The walk is whole wherever an import names no export:

- a namespace import, `import * as cart`
- a `require`, and an `import './cart'` that binds nothing
- a dynamic `import()`

It is also whole one import further out. A file that imports a changed export
is walked from as a whole file, because which of its own exports use that name
is not read.

## Why an import graph is the safe half

An import is permission, not proof. `import { total } from './total'` says this
file *may* depend on `total.ts`, and most of the time it depends on one function
in it. So a graph built from imports names more than a change really reached,
and that is the direction to be wrong in: the cost of a file you did not need is
a test run, and the cost of a file you missed is a green build over code nobody
looked at.

Everything that narrows below the graph narrows from evidence. An
[execution record](execution-record.md) says which regions a test actually
covered, and [running less of the suite](selecting.md) uses it to skip work the
graph would have included. Nothing narrows from absence — "I saw no import" is
never a reason on its own. An import the reader cannot see, such as a `require`
of a computed name, is the record's to answer: the module loads under the test,
and the test is in its record.

Type-level references are the one thing the walk does not follow, because they
are erased before anything runs. A TypeScript `import type`, a Python
`if TYPE_CHECKING:` block and a Kotlin import that only names a signature are
recorded as edges and skipped by a walk that asks what a change can reach at
runtime. The `else:` branch of that Python block is the runtime half and is
followed.

## One reader per language, one graph

A language here is a reader and a resolution algorithm — what does this file
ask for, and where does that land on this disk — and nothing above them learns
a new type. What differs between languages is how much the syntax tells you.

**JavaScript and TypeScript.** One language, not six: `.ts`, `.tsx`, `.jsx`,
`.mjs` and `.cts` share a reader and a resolver, so a dialect is not a port.
The syntax says almost everything, and the work is in resolution instead:

- **A `tsconfig.json` is found per file** rather than once per repository, which
  is what a workspace of many packages needs, and its `paths` apply where it
  applies.
- **Export conditions are read in order, source before built output**, so a
  package that publishes both is read as its source rather than its `dist`.
- **Anything outside this repository resolves to nothing on purpose** — a
  builtin, a package in `node_modules`, a path above the root — because no diff
  of this repository can be that file.
- **On macOS and Windows a specifier can resolve to a file it does not name**,
  since both match filenames without regard to case; that is handled where it
  happens rather than left to the case-sensitive machine CI runs on.

**Stylesheets.** A second language rather than a dialect of the first, because
the same string asked from two places is two different questions: `./colors`
from a stylesheet may find `_colors.scss`, and from a module must not. `.scss`
and `.less` share that reader, and a component that imports its own stylesheet
is an edge like any other.

**Python.** A statement is several modules: `from a.b.c import name` runs three
`__init__.py` on the way down and then either `c.py` or nothing, and which one is
a fact about the disk rather than about the statement. Every module path the
statement could have meant is emitted and resolved, so the sibling a test
imports through its package is an edge rather than a silence. Over a 299-file
Python codebase with 597 first-party requests, resolving only the written module
loses 64 edges — a tenth — and the shape it loses is exactly a test importing
three siblings from one package.

**Rust.** There is no specifier that names a path. `mod order;` declares that a
file exists, so a `mod` that resolves to nothing is a hole and is reported as
one. `use crate::read::harvest::Harvest;` names an item, and which prefix is the
module is again a fact about the disk; resolution takes the longest prefix that
is a file, and a `use` that finds nothing is an external crate rather than an
error. `#[path]` is taken as written.

**Java and Kotlin.** Two syntaxes over one resolution algorithm. An import names
a package and a thing in it, the package is a directory under a source root, and
the source root is derived from what the files themselves declare rather than
from a convention list — a file at `a/b/c/Thing.java` declaring `package b.c`
sits under root `a`, and Maven and Gradle layouts fall out of that instead of
being assumed. Types in the same package are visible with no import at all, so
every file asks for its own package as well; on a JVM codebase those are most of
the real edges, and leaving them out would report a class and the class beside
it as unrelated. Kotlin adds one difference: a top-level function may live in
any file of its package, because Kotlin has no filename rule.

**Swift.** The language does not have the edge the rest of this rests on.
`import Core` names a module, which is a whole target, and files inside a target
see each other with no import at all. So the answer is given at the grain the
language has and projected onto files: an import reaches every file in that
target, and a file reaches every file beside it in its own. On a 708-file,
51-target package the largest target is 78 files and same-target visibility is
20,756 edges, about twenty-nine per file — affordable because targets are small
on purpose. `Package.swift` is a program rather than a manifest format, and is
read with the same grammar as everything else, since `path:` is frequently not
the default and the default is only a default.

## What the answer will not do

**It will not answer short.** On a clean exit the list is never empty, because
every changed file that runs differently is among the files it reaches. The walk
cannot stand behind a list in four cases:

- nothing changed since the ref
- nothing changed that any reader claims
- every changed file runs what it ran before
- a changed source file the scan never reached

In each of them the command writes nothing to stdout, says why on stderr, and
exits `2`. A run list is the
dangerous shape to get wrong: an empty one piped into a runner runs nothing and
looks like a fast green build.

**It will not hide what it could not read.** Two kinds of file are named on
stderr:

- **A changed path in no language this build reads is taken out of the walk** —
  a lockfile, a Dockerfile, a workflow — and named on stderr rather than
  dropped.
- **A file whose own edges could not be enumerated is walked from as though it
  had changed** — a parse error, a missing grammar, a computed import, a macro,
  a name resolved by reflection — and a sentence on stderr says which file and
  why.

A widening you can read is a work item; a widening you cannot is a tax.

**It will not narrow by language.** The reach of a diff that touched Python and
Swift is one walk over one graph, and the Swift file reached through a target
is in the same list as the Python module reached through a package.

## Where it sits

`variance reach` answers from structure alone, which is why it needs nothing
from you but a ref. The [source index](source-index.md) is where a repeated scan
keeps what it learned, so the second answer over a tree that did not change
costs a fraction of the first. [Sense](../packages/sense) is the package that
does the reading, and can be used directly when you want the records rather
than a list of paths.

Below the graph, `variance select` answers from what runs recorded — a narrower
list, and one that exists only where a run has been recorded. The graph needs no
history, so it is the answer available on the first day, in any of the languages
above.
