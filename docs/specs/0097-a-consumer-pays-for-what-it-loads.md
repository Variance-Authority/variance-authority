# Spec 0097 — a consumer pays for what it loads

**Missing:** nothing says what a lazy import loaded, or which load was
paid up front and which later. Spec 0095 names the import that brought in
what a test file never used, but only for static imports, read over the
whole file. What a modal's `import()` loads when a case opens it is owned
by no import and reads as `unseen`. The fold drops whether a module first
evaluated inside a case, so a load paid when the file was collected looks
the same as one paid when a case acted. A browser test's page is drained
once, so its first load and what its interactions loaded are one sum.
**Built on:** the attribution of
[spec 0095](0095-an-import-spills-what-the-test-never-used.md): weight,
ownership by dominator rooted at the test file, the scope reading, and a
spill's size and share. Weight and ownership are its items 1 and 2, and
the scope reading is its item 6 on this repository; `distill --file` and
`distill` over a scope carry them. Also the test-selection recording,
which flags a region that ran while its module evaluated, keeps those
ordinals in each case's frame, and charges them to the whole file
([spec 0059](0059-a-change-runs-the-cases-that-ran-it.md)); the
`dynamic` edge kind in `Relations` and the scanner's dynamic request with
its line; and the playwright-test collector, which drains each document
once, at the test's teardown.

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
moment it was paid:

- **What it reached:** the files its request loaded, owned by it.
- **How much it consumed:** its spill's size and share, as spec 0095
  defines them. The avalanche is what that reading shows when a request
  took little and its spill is most of what it loaded. It is read from
  the two numbers, never cut at a threshold.
- **When it was paid:** at the initial load or later, so a fix aims at the
  moment that costs.

Initial load is what a test file pays outside every case, in collection
or a hook, and what a page pays until its document's `load` event. Later
load is what is paid when a case or an interaction reaches code nothing
loaded yet. They call for different fixes. An initial cost is cut by
narrowing or deleting an import. A later cost is cut by narrowing the lazy
import that pays it, or accepted as a cost the user meets only when they
act.

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
is reported under the dynamic import, never twice. Today `distill` leaves
`dynamic` out of the edges it walks, so a lazy import owns nothing and its
files read as `unseen`.

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
this spec adds none to a test file's record. Initial and later split each
loaded module by scope:

- **In a test file,** a module is a later load when it first evaluated
  inside some case's frame, and an initial load when it evaluated outside
  every case frame: in collection or in any hook, the ambient bucket. The
  fold keeps one fact per module and test file, beside the ordinals it
  already keeps as loaded. It names no case, and selection still charges
  a load to the whole file, as spec 0059 does. A load belongs to the
  file, as spec 0095 says, because a module evaluates once per realm, for
  whichever case imported it first, and which case that was depends on
  the order the cases ran in. A later load is read per import, with the
  cases that could have paid it left to the reader who asks for one case.
- **In a page,** what ran up to its document's `load` event is initial,
  and what ran after it is later, for the test that drove it.

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

A later load can be divided by step only where the steps' order is
already recorded. That is the opt-in story tap in Node, which is read for
one case at a time and never for a suite
([ADR-0076](../context/adr/0076-a-story-is-the-order-one-case-visited.md)), and
the Eyes journal joined by
[spec 0054](0054-eyes-attention-is-read-as-test-steps.md). Without one of
those, a later load is read per import and is not divided.

### Absent is not empty

- A case whose frame wasn't kept leaves what it loaded **unmeasured**,
  neither initial nor later.
- A module that first evaluated in a continuation after its case had
  ended lands in the ambient bucket and reads as initial. The recording
  cannot tell it from a hook's load, so an initial load is read as "paid
  outside every case", never as "paid before the cases ran".
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
2. **The fold keeps whether a module first evaluated inside a case.** The
   test file's reading splits weight into initial and later per import.
   Fixtures: two cases where only one opens the modal, whose chunk reads
   as later; a `require()` inside a function read as later and counted
   once; a dropped frame read as unmeasured.
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
