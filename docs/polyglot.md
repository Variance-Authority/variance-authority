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

The list names every file the change can reach, the changed files among them,
one per line. `--format json` returns the same answer with what was left out of
it beside it. No project configuration is read, and `--since` has no default:
the command is asked by a repository whose tests something else runs, and
guessing a ref there would be guessing what a build is about to skip.

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
never a reason on its own, because a file whose edges could not be read may
import anything.

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
The syntax says almost everything, and the work is in resolution instead. A
`tsconfig.json` is found per file rather than once per repository, which is what
a workspace of many packages needs, and its `paths` apply where it applies.
Export conditions are read in order, source before built output, so a package
that publishes both is read as its source rather than its `dist`. Anything
outside this repository resolves to nothing on purpose — a builtin, a package in
`node_modules`, a path above the root — because no diff of this repository can
be that file. On macOS and Windows a specifier can resolve to a file it does not
name, since both match filenames without regard to case; that is handled where
it happens rather than left to the case-sensitive machine CI runs on.

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
the changed files are always among the files they reach. When the walk cannot
stand behind a list — nothing changed since the ref, nothing changed that any
reader claims, or a changed source file the scan never reached — the command
writes nothing to stdout, says why on stderr, and exits `2`. A run list is the
dangerous shape to get wrong: an empty one piped into a runner runs nothing and
looks like a fast green build.

**It will not hide what it could not read.** A changed path in no language this
build reads — a lockfile, a Dockerfile, a workflow — is taken out of the walk and
named on stderr rather than dropped. A file whose own edges could not be
enumerated — a parse error, a missing grammar, a computed import, a macro, a
name resolved by reflection — is walked from as though it had changed, and a
sentence on stderr says which file and why. A widening you can read is a work
item; a widening you cannot is a tax.

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
