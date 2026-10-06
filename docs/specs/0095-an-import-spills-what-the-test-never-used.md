# Spec 0095 — an import spills what the test never used

**Missing:** nothing names the import that made a test file load code its tests
never used. `variance distill` lists the files one test loaded and never called
into, and proposes mocking each of them by its own path. The path is usually a
file deep behind the test's own imports, reached through a barrel, so the
proposal is unreadable as a cause and wrong as a fix: a test that mocks a file
its own code never names has taken a dependency on an internal.
**Built on:** the test-selection recording, which keeps a load apart from an
execution per declaration
([spec 0027](0027-a-test-is-selected-by-what-it-executed.md)); `scanRelations`
in `@variance-authority/sense` and the `Relations` built from it, with runtime
edges and mock shadows; distill's `loadedOnly`, which needs a declaration the
test never executed; and the dominator pass that
[spec 0092](0092-a-choke-point-is-read-twice.md) specifies, which lands first.

## Purpose

A test that writes `import { Button } from '@app/ui'` meant one component. If
`@app/ui` is a barrel, evaluating it evaluates every file it re-exports, and
everything those files import. The test file pays for loading all of it on
every run, and an edit to the top level of any of it selects the file's tests.
Nothing in the test says so, and nothing in a report does either: the cost
arrives as a long list of files with no import of the test's own at the head of
it.

The fix is decided at an import someone wrote:

- **Delete the import, or mock it**, when nothing behind it is used. An import
  kept for its side effects is mocked with a factory; an automock loads the real
  module to read its shape and saves nothing.
- **Depend on what is needed**, when something behind it is used, so the
  import that brings `Button` stops bringing everything else: import past the
  barrel from inside its own package, import an entry point its package already
  declares, or, in a product, split the barrel.

Which of these a reading may propose depends on who the barrel's package is
for (below). A published package is optimized for the people who install it,
never for its own suite.

The reading is deterministic and cheap. It reads the recording and the import
graph a run already left, runs no test, needs no Eyes journal and no browser,
and gives the same answer every time it is asked of the same record.

## Definition

The unit is the test file. A runner evaluates a module once per test file, when
it collects the file, so a load belongs to the file and not to any one of its
cases. For a test file F:

- **Used** files are F itself and every file in which any case of F executed a
  declaration below the top level.
- **Weight** is every file F loaded that declares something below its top level
  and in which no case of F executed any of it.
- A file that declares nothing below its top level is never weight. A barrel, a
  file of constants, a polyfill or a registry runs everything it has when it is
  loaded, and a read of a constant is not recorded, so the recording cannot say
  F did without it. Such a file passes weight through and is not proposed for
  removal.

Loads come from the recording, never from the graph alone: a transform that
defers re-exports, such as a lazy CommonJS mode, loads less than the graph
says. The graph is used only to attribute what was loaded, read by request
rather than by name, because a barrel evaluates all of its re-exports whichever
name was asked for. Spec 0092 sees a barrel through by name; the difference
between the two readings is the spill.

### Attribution

An import, as its importer wrote it, **owns** a weight file when every runtime
path from F to that file passes through it: the dominator relation of spec
0092, rooted at F, with mocks with a factory cutting their edge. An owned file
is freed by removing the import that owns it, so an import's size is what a fix
would save. Weight that no single import owns, because two imports reach it, is
reported once as **shared**, with the imports that reach it, and counted to
none of them.

| Owning import | Reading | Proposal |
|---|---|---|
| In F, taking at least one name, every one of which resolves to declarations with nothing below their top level | **A read.** F used it for a constant, which runs no region, so the recording can't see the use. What it owns beyond the file declaring those names is its spill. | The narrowest import that reaches the declaring file, under the rules below. Never deletion. |
| In F, with only weight behind it | **A dead import.** F loaded everything behind it and used none of it. | Delete it, or mock it with a factory if it is there for its side effects. |
| In F or a used file, with a barrel behind it that leads to used and weight files | **A barrel spill.** F used some of what the barrel re-exports and loaded the rest. | The narrowest import the regime of the barrel's package allows (below). |
| In a used file other than F | **An import F does not write.** A file F used imports something F never needed. | None at the test. The import is named with the file that writes it, as a fact about that file. |

The first row that matches decides.

A spill is reported by its size, the files and lines it owns that F loaded and
never executed; by its **share**, that size over every line F loaded through
the import, used or not, which is everything the import dominates and wider
than what it owns; and by the number of other test files the same import
spills into. Spills rank by size. The share is a second column, read beside
the size: two imports that each spill forty files read the same by size, and
the share separates the one that loaded forty-one files for a constant from
the one that loaded four hundred and used most of them.

Which names an import takes is static: a named import lists them, and the
scanner records the member reads made through a namespace or an `import()`
result. An import that takes no name, such as `import './x'`, or a namespace
whose holder is handed to another function and so lists no member, is never
read as a read.

### Least knowledge

The boundary is the package. A proposal names only a specifier F already
writes, a path inside the importer's own package, or an entry point another
package declares. It never names a file inside another package by a path its
`exports` do not declare, and it never proposes rewriting an import to such a
path.

### Who the package is for

The barrel's package decides which narrower import may be proposed, and its
manifest says which kind it is. A package whose manifest declares
`"private": true` is part of a **product**: nobody outside the repository
imports it, its entry points are internal boundaries, and a barrel in it may be
split into whatever entries its own importers need. Any other package is
**published**: its entry points are what its users learn, and every new one is
something more each of them has to know about it.

| Barrel's package | May propose | Never proposes |
|---|---|---|
| Product | Splitting the barrel into entries that name what is used, and importing from them. | — |
| Published | An import past the barrel from a file inside the same package; an entry point the package already declares in `exports`; deleting or mocking the import in the test. | A new entry point, or a split of a barrel the package publishes. |

A published barrel spill that only a new entry would fix has no proposal. It is
reported with its size and the test files it spills into, as the cost of the
package's surface, and the import stays as it is.

This replaces distill's proposal of `vi.mock('<loaded file>')` for each file
loaded and not covered. The per-file reading stays as evidence, and the
proposal moves to the import.

### Absent is not empty

- With no recording, the reading is **unmeasured**, never "no spill".
- A weight file with no runtime path from F on the graph was loaded by
  something the scan cannot see: a dynamic import, a harness file, a specifier
  that is not a literal. It is named as **unseen**, owned by no import, and given
  no proposal. A literal dynamic import becomes an owner of its own under
  [spec 0097](0097-a-consumer-pays-for-what-it-loads.md).
- A mock with a factory cuts its edge, and nothing behind it is loaded. A mock
  that did not take is `auditTaints`' finding, not this one's.

## Where it is read

- **Its own question, for one test file and for the suite.** For one file it
  lists the spilling imports, each with its line, the barrel on its path, and
  the weight it owns, largest first. For the suite it ranks imports and barrels
  by the weight they spill and the test files they spill into: the barrel that
  puts four thousand unused lines into two hundred test files is the first line
  of the answer.
- **In `variance distill`**, which heads its loaded-but-not-covered reading with
  the spilling imports of the test's file, in place of a proposal per loaded
  file.

## The slower reading

In a React codebase, executed is not the same as needed. A component rendered
by the tree runs its function whether the test addresses it or not, so the
recording reports it used. Telling the components a test works with from the
ones it only renders needs the Eyes journal joined to the same case, which is
[0054](0054-eyes-attention-is-read-as-test-steps.md). It is a second reading on
top of this one, per case rather than per file, and is not part of this spec.

## What would discharge it

1. ~~Weight per test file from the recording, with the top-level-only rule.~~
   **Discharged.** `distillFile` in `@variance-authority/distill`, read by
   `variance distill --file` alone. A function-less barrel pins the
   top-level-only rule for the constants file and the polyfill.
   Fixtures: a constants file, a polyfill, and a file whose declarations no case
   in the file executed while one case in a second file did.
2. ~~Ownership over the runtime graph by request, rooted at the test file, with
   factory mocks cutting. Fixtures for a dead import, a barrel spill, an import
   the test file does not write, a diamond whose shared weight is counted to
   neither import, a dynamic import read as unseen, and an automock that still
   loads.~~
   **Discharged.** `dominatorsOf` in `@variance-authority/core/relate`, read by
   `distillFile` when it is handed the file graph's static imports, and by
   `variance distill --file` alone. The walk keeps only files the recording
   says F evaluated, so a factory mock cuts its edge with no mock reader. An
   import names its importer and imported file, not the specifier as written:
   the specifier and its line come with item 5. Shared weight names the nearest
   file every path runs through rather than the imports that reach it. An
   unused file that dominates an entered one reads as shared, because removing
   its import would lose code a case ran. Fixtures in `own.test.ts`, plus a
   cycle and a file the recording does not hold.
3. The least-knowledge rule, with a fixture whose only narrower import is a path
   into another package that its `exports` do not declare, so no proposal names
   the internal.
4. The regime from the manifest: the same spill through a barrel in a private
   package proposes the split; through a published package's barrel it
   proposes an import from inside that package or an existing entry, and with
   neither available it proposes nothing and reports the cost.
5. Distill's proposal at the import in place of the loaded file, in text and in
   `--format json`.
6. The question for one file and for the suite, measured on this repository and
   on the seven-MUI corpus, with its time stated against the time `covering`
   takes on the same record. One test file answers in under a second.
   **Discharged on this repository.** `distillScope` in
   `@variance-authority/distill`, read by `variance distill` with no case and no
   file, over `--from <dir>`, one `--suite`, or every declared suite. Imports
   rank by their lines summed over the test files they reach. Every test file
   of this repository's three suites reads in 0.9 s, one package in 0.55 s,
   against 0.4 s for `covering --file` on the same record. The seven-MUI
   corpus is not measured.
7. The public page: [`optimize-a-test.md`](../optimize-a-test.md) states the
   reading and lands its terms before any output prints them.
8. A read is a use, and every spill carries its share. Fixtures: a constant
   behind a barrel, a namespace read through a member, and an enum, each
   reported as a read with the narrowest import and never as dead.
