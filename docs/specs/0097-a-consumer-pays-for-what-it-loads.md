# Spec 0097 — a consumer pays for what it loads

**Missing:** nothing says which load was needed up front and which
later. Spec 0095 names the import that brought in what a test file never
used, and a literal `import()` owns what only it reaches, but every load
is read over the whole file. A static import evaluates its target at
load, and nothing reads where its consumer used it, so an import needed
when the file was collected looks the same as one needed only when a
case acted. A browser test's page is drained once, so its first load and
what its interactions loaded are one sum.
**Built on:** the attribution of
[spec 0095](0095-an-import-spills-what-the-test-never-used.md): weight,
ownership by dominator rooted at the test file, the scope reading, and a
spill's size and share. Weight and ownership are its items 1 and 2, and
the scope reading is its item 6 on this repository; `distill --file` and
`distill` over a scope carry them. Also the test-selection recording,
which flags a region that ran while its module evaluated, keeps those
ordinals in each case's frame, and charges them to the whole file
([spec 0059](0059-a-change-runs-the-cases-that-ran-it.md)); the
`presence` regions the sense addon places in every module, one at every
place control arrives; the addon's reader walk, which places each read
of an imported binding in the function that holds it; the `dynamic` edge
kind in `Relations` and the scanner's
dynamic request with its line; and the playwright-test collector, which
drains each document once, at the test's teardown.

## Purpose

A consumer asks for something and pays for whatever its request brings
in. Asking for one constant and getting the module that defines it, every
module that module imports, and every file behind a barrel on the way is
the banana that came with the gorilla and the jungle. Spec 0095 reads that
case for a test file's own imports, including an import that only reads a
constant. Rendering a modal that pulls in a date library, a rich-text
editor and their locales is the same cost, paid later, by an action and
through a lazy import. This spec reads that one.

The north star is one reading of load cost for every consumer, at the
moment it was needed:

- **What it reached:** the files its request loaded, owned by it.
- **How much it consumed:** its spill's size and share, as spec 0095
  defines them. The avalanche is what that reading shows when a request
  took little and its spill is most of what it loaded. It is read from
  the two numbers, never cut at a threshold.
- **When it was needed:** at the initial load or later, so a fix aims at
  the moment that costs. For a lazy import, that is when it was paid.

Initial load is what a test file needs from its imports outside every
case's frame, and what a page pays until its document's `load` event.
Later load is what an import is needed for only inside a case or after
an interaction, whether a lazy import paid for it then or a static
import paid for it at load. They call for different fixes. An initial
cost is cut by narrowing or deleting an import. A later cost is cut by
making the import lazy, by narrowing the lazy import that pays it, or
accepted as a cost the user meets only when they act.

## Definition

### Consumers

A consumer is an import that causes a load: a **static import**, as spec
0095 reads it, or a **dynamic import**: a literal `import()`, `React.lazy`
and every wrapper that compiles to one, each with the line the scanner
gives it.

A dynamic import is a root of its own. Ownership stays spec 0095's,
rooted at the test file, and walks dynamic edges too. What every path
reaches only through one dynamic import is owned by that import, unless a
static import above it is itself unused: then the topmost unused import
owns it, as spec 0095 rules, because removing that import frees all of
it. A file that a static and a dynamic import both reach is owned by
neither. It is reported once, as shared, as spec 0095 reports a diamond.
An import's size is exclusive: what a dynamic import nested under it owns
is reported under the dynamic import, never twice.

Spec 0092's choke-point reading walks the same edges. Its "dynamic
import" hole narrows to a non-literal one once `dominatorsOf` walks
dynamic edges.

A `require()` inside a function is emitted by the scanner as an import
wherever it stands, so it is owned as a static import. When its target
evaluated inside a case, it is a later load (below). That is the same
file read at a second moment, never a second owner, and it is counted
once.

### Initial and later are scopes, not times

The record holds no order and no time
([ADR-0056](../context/adr/0056-a-journey-is-the-places-visited.md)), and
this spec adds neither. Initial and later split each import by scope:

- **In a test file,** an import is needed initially when its consumer
  used it anywhere outside every case's frame, in collection or in a
  hook, and needed later when every use came inside a case's frame. The
  module behind a static import cannot say which: it evaluates when its
  consumer does, whether or not the consumer ever uses it, so it reads
  as loaded wherever its consumer loaded. Only the consumer holds the
  moment, at the place it reads the import (below). A dynamic import or
  a `require` inside a function evaluates its target when it runs, so its
  call is the use, placed as a read is. The reading keeps one fact per
  import and test file. It names no case, and selection still charges a
  load to the whole file, as spec 0059 does, because a module evaluates
  once per realm and which case paid for it depends on the order the
  cases ran in.
- **In a page,** what ran up to its document's `load` event is initial,
  and what ran after it is later, for the test that drove it. A bundle
  hides the consumer behind its chunks, so a page is split by when a load
  was paid, which for a lazy chunk is when it was needed.

The playwright-test collector drains each document once, at the test's
teardown, so a test that loads a page and then clicks holds both moments
as one set. The split needs a second drain of the same document, at its
`load` event. That is a runtime addition ADR-0056's decision 3 does not
allow, so it lands with an ADR that narrows that decision, as ADR-0076
narrows ADR-0056 for the story. Selection reads the union of the two
drains, so it answers exactly as it does with one. The split is read only
for load cost, and no phase is tagged on a probe. The Storybook collector
navigates once per run, so a story has no `load` event of its own, and
its loads are not split.

### A use is read where the consumer reads the import

The sense addon's reader walk already finds every read of an imported
binding in the source and places it in the function that holds it, or on
the module when it runs at load; it is what charges a changed constant to
its readers. This spec extends that walk, never adds a second one. A
read is placed in one of two ways, by what its consumer is:

- **A module** is instrumented, so each read lands in the `presence`
  region that holds it, and the run recorded whether that region was
  entered outside every case's frame or only inside cases.
- **A test file** is not instrumented: nothing enters one, and its own
  edit is what runs it. A read is placed by the callback that holds it.
  Inside a case's callback it is a use inside a case; at top level, in a
  `describe` body or in a hook it is a use outside every case. A read in
  a helper the file declares is asked of the helper's own readers, an
  extension of the walk modelled on how it follows a pure binding's
  readers, and one it cannot follow is a use outside every case.

An import is needed initially when any of its uses is outside every
case, and later when all of them are inside cases. A dynamic import or a
`require` inside a function is placed by its call, as a read is.
Nothing is added to the emitted code or to the running test.

The fold folds the ambient bucket into every case of its file, so it
drops which regions were entered outside every case. It keeps that fact
per test file, one bit per region, taken from the ambient frames only.
The `loaded` flag is not that fact: a module a case's `import()` pulls in
evaluates inside the case's frame, and its region is flagged `loaded`
all the same.

A region is entered at its first statement, and a read later in it may
never run: a call before it throws, or a loop exits early. Such a use
reads as reached, in both directions. In a region entered outside every
case it reads as initial, and the reading proposes narrowing an import
that could be lazy. In a region entered only inside cases it reads as
later, and the reading proposes making lazy an import that could be
deleted.

- **A probe at every read is not built.** It would record what the
  regions already hold, a second implementation of region entry, and it
  would be reconsidered only if the reached-but-not-run case above is
  shown to change a reading.
- **A proxy around what `require` returns is rejected.** It traps every
  read of the module for as long as the test runs, not only the first,
  and it hands the consumer an object that is not the module itself. A
  spike built that way on react-hook-form's suite (252 source files, 122
  test files, 1,492 cases) cost 2.3× on transform, 4.4% on runtime, and
  about 14 KB of JSON per test file, against plain `@swc/jest`. The
  reading above costs none of those at runtime.

A later load can be divided by step only where the steps' order is
already recorded. That is the opt-in story tap in Node, which is read for
one case at a time and never for a suite
([ADR-0076](../context/adr/0076-a-story-is-the-order-one-case-visited.md)), and
the Eyes journal joined by
[spec 0054](0054-eyes-attention-is-read-as-test-steps.md). Without one of
those, a later load is read per import and is not divided.

### Absent is not empty

- An import of a module whose only uses lie in a case whose frame wasn't
  kept is **unmeasured**, neither initial nor later. A test file's own
  imports are placed by its source and are never unmeasured this way.
- A run recorded under `entries` instead of `presence` holds module and
  function regions only. Each read is held by a larger region, and more
  reads that never ran read as reached.
- A use in a continuation after its case had ended lands in the
  ambient bucket and reads as initial. The recording cannot tell it from
  a hook's use, so initial is read as "needed outside every case", never
  as "needed before the cases ran".
- A document replaced before it was drained leaves its test incomplete, as
  it does for execution, and its split isn't reported.
- A dynamic import whose specifier isn't a quoted string has no edge, and
  neither does a template literal, even one with no substitution. What it
  loaded stays **unseen**.

## Where it is read

- **In `variance distill`,** for one test file or a scope. A test file's
  reading splits its weight into initial and later, and heads each with
  the imports that own it, largest spill first. A dynamic import carries
  its line.
- **For a page,** in the playwright-test collector's reading: each
  document's first load beside what the test's interactions added to it.

## Not part of it

- **Bytes shipped.** A bundler decides what a user downloads. This reading
  counts the source a test or a page evaluated, which is what a fix to an
  import changes. Transfer size is left to the tools that read bundles.
- **Time.** No duration is recorded and none is inferred from the counts.

## What would discharge it

1. **A dynamic import owns what only it reaches.** This replaces the
   fixture under spec 0095's item 2 in which a dynamic import reads as
   unseen, and amends spec 0092's hole to a non-literal dynamic import.
   Fixtures: a `React.lazy` modal whose files `distill` reports under the
   `import()` with its line; a module both a static and a dynamic import
   reach, reported once as shared; a lazy import under an unused static
   import, owned by the static one; a non-literal `import()` still read as
   unseen.
   **Discharged but for the line.** `causesOf` in
   `@variance-authority/distill` walks the `lazy` edges it is handed beside
   the static ones, and marks an owning import that is dynamic only
   `lazy: true`. `variance distill` hands it the file graph's `dynamic`
   edges and prints that import as `lazily imports`. Fixtures in
   `own.test.ts`, and, read through the file graph in the CLI's file
   reading, a `React.lazy` modal and an `import()` of a template literal
   that stays unseen. Spec 0092's hole names a non-literal dynamic import.
   Open: the import's line, which `Relations` does not carry and which
   comes with spec 0095's item 5 for every import.
2. **A use says whether an import was needed outside every case.**
   The reader walk places each read of an import binding, and each
   in-function `require` or `import()` call, in a module's region or a
   test file's case or non-case callback; the fold keeps, per test file,
   which regions were entered outside every case; and the test file's
   reading splits weight into initial and later per import. Fixtures:
   two cases where only one opens a statically imported modal, whose
   import reads as later; the same modal opened through a helper the
   file declares, read the same way; a `require()` inside a function read
   as later and counted once; a hook's use read as initial; a component
   whose import is read only in a handler a case fires, read as later; a
   module consumer in a dropped frame read as unmeasured. The emitted
   code and the runtime are unchanged.
3. **A page splits its first load from what came after.** An ADR narrows
   ADR-0056's decision 3. The playwright-test collector drains at the
   document's `load` event and again at teardown, and selection is
   unchanged on the union. Fixture: a page whose modal chunk loads on a
   click.
4. **A later load per step,** read through the story tap for one case, and
   through spec 0054's join where it lands.
5. **Measured with spec 0095's item 6** on the seven-MUI corpus. The public
   page that spec 0095's item 7 names states initial and later load and
   lands both terms before any output prints them.
