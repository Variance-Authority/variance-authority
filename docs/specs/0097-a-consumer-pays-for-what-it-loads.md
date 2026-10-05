# Spec 0097 — a consumer pays for what it loads

**Missing:** nothing says, for a consumer, how much it loaded against how
much it used. Spec 0095 names the import that brought in what a test file
never used, but it reads one moment, the file's collection, and one kind
of consumer, a static import. A lazy import that fires when a case opens a
modal is counted to no import and to no case. An import that only reads a
constant looks the same as a dead one. A page's first load can't be told
apart from what its interactions loaded later.
**Built on:** the attribution of
[spec 0095](0095-an-import-spills-what-the-test-never-used.md): weight, the
top-level-only rule, ownership by dominator rooted at the test file, and
the product and published regimes. Also the test-selection recording,
which flags a region that ran while its module evaluated and keeps those
ordinals per case frame
([spec 0027](0027-a-test-is-selected-by-what-it-executed.md)). And the
`dynamic` edge kind in `Relations`, the scanner's dynamic request with its
line, and the member reads it records through a namespace or an
`import()`.

## Purpose

A consumer asks for something and pays for whatever its request brings
in. Asking for one constant and getting the module that defines it, every
module that module imports, and every file behind a barrel on the way is
the banana that came with the gorilla and the jungle. Rendering a modal
that pulls in a date library, a rich-text editor and their locales is the
same cost, paid later, by an action rather than by an import.

The north star is one reading of that cost for every consumer, at the
moment it was paid:

- **What it reached:** the files its request loaded, owned by it under the
  attribution of spec 0095.
- **How much it consumed:** the lines of what it loaded, against the lines
  of what any case then used.
- **Whether it avalanched:** the share of what it loaded that nothing used,
  so an import that took one constant and loaded forty files heads the list
  above one that loaded forty files and used thirty-nine.
- **When it was paid:** at the initial load or later, so a fix aims at the
  moment that costs.

Initial load is what a test file pays before its first case, and what a
page pays before its first interaction. Later load is what a case or an
interaction pays when it reaches code nothing loaded yet. Both are
valuable, and they call for different fixes. An initial cost is cut by
narrowing or deleting an import. A later cost is cut by narrowing the lazy
import that pays it, or by accepting it as a cost the user meets only when
they act.

## Definition

### Consumers

A consumer is a place that causes a load. There are four kinds:

| Consumer | Pays at | Read from |
|---|---|---|
| **A static import**, as its importer wrote it | Initial, when its importer evaluates | Spec 0095's ownership |
| **A dynamic import**: a literal `import()`, `React.lazy` and every wrapper that compiles to one | Later, when the code around it runs | The `dynamic` edge, rooted at the import, with its line |
| **A case** of a test file | Later, for what it evaluated first | The case frame's evaluating ordinals |
| **A document** a browser test opened | Initial for its first load, later for what each interaction loaded | The page collector, drained per document |

A `require()` inside a function is a static import to the scanner, which
emits it as an import wherever it stands, but it pays later. It's read as
a dynamic import when the recording shows its target evaluated inside a
case.

### What a consumer reached

A static or dynamic import reached what it owns: the weight files and the
used files behind it on the runtime graph, rooted where it stands, with
factory mocks cutting their edge, as spec 0095 defines ownership. A
dynamic import is a root of its own. What only it reaches is owned by it
and not by the static import of its importer. Today `distill` leaves
`dynamic` out of its loading edges, so this weight is reported as
`unseen`.

A case reached the modules first evaluated while it ran. A module
evaluates once per realm, for the first case that imports it, so a later
load belongs to the first case in the file's order that paid it. The case
is named as the one that paid, never as the only one that needs the code.
The consumer that answers for the cost is the import that loaded it,
static or dynamic, and the case is the moment.

### What it consumed

For each consumer: the files and lines it loaded, the files and lines of
those in which any case executed a declaration below the top level, and
the difference. This is spec 0095's weight, counted per consumer and per
moment instead of per test file.

The **avalanche** is that difference read as a share of what the consumer
loaded. A ranking orders consumers by unused lines, then by share. A
consumer whose request was one name and whose load was a region is
reported with both numbers, because the share is what makes it the banana.

### A read is a use

A read of an exported constant runs no region, so the recording can't see
it, and an import that only reads a constant looks dead. The static side
can see it. A named import says which names it takes, and the scanner
records the member reads made through a namespace or an `import()`
result. When every name an import takes resolves to a declaration that
has no region below the top level, the import is a **read**: it was used,
and what it owned beyond the file declaring those names is its avalanche.
It is never proposed for deletion. It's proposed for the narrowest import
that reaches the declaring file, under spec 0095's least-knowledge and
regime rules.

### Initial and later are scopes, not times

The record holds no order and no time
([ADR-0056](../context/adr/0056-a-journey-is-the-places-visited.md)), and
this spec adds none. Initial and later are a partition by scope:

- **In a test file:** what evaluated outside any case, in collection and in
  `beforeAll`, is initial. What evaluated inside a case's frame is later,
  for that case.
- **In a document:** what ran before the page settled from its first
  navigation is initial. What ran after is later, for the test that drove
  it.

A later load can be divided by step only where the order of steps is
already recorded: the opt-in story tap in Node, and the Eyes journal joined
by [spec 0054](0054-eyes-attention-is-read-as-test-steps.md). Without one
of those, a later load is read per case or per test, and is not divided.

### Absent is not empty

- A case whose frame wasn't kept has an **unmeasured** later load, not an
  empty one.
- A document replaced before it was drained leaves its test incomplete, as
  it does for execution, and its split isn't reported.
- A dynamic import whose specifier isn't a literal has no edge. What it
  loaded stays **unseen**, named with the case that loaded it.
- A read through a holder passed to another function lists no member, so
  the import isn't read as a read. It falls back to spec 0095's reading.

## Where it is read

- **In `variance distill`,** for one case, one test file or a scope. A
  test file's reading splits its weight into initial and later, and heads
  each with the consumers that paid it, largest unused first. The
  dynamic-import consumers carry their line.
- **For a page,** in the browser collectors' readings: the initial load of
  each document beside what each test's interactions added to it.

## Not part of it

- **Bytes shipped.** A bundler decides what a user downloads. This reading
  counts the source a test or a page evaluated, which is what a fix to an
  import changes, and leaves transfer size to the tools that read bundles.
- **Time.** No duration is recorded and none is inferred from the counts.

## What would discharge it

1. **A dynamic import owns what only it reaches.** Fixtures: a
   `React.lazy` modal whose files `distill` reports under the `import()`
   with its line rather than as `unseen`; a module both a static and a
   dynamic import reach, owned by neither.
2. **A case keeps what it loaded.** The fold keeps which case's frame first
   evaluated each module, and a test file's reading splits weight into
   initial and later per case. Fixtures: two cases where only one opens the
   modal; a `require()` inside a function read as later; a dropped frame
   read as unmeasured.
3. **A read is a use.** An import taking only names that resolve to
   region-less declarations is reported as a read with its avalanche and
   the narrowest import, and never as dead. Fixtures: a constant behind a
   barrel, a namespace read through a member, an enum.
4. **The avalanche ranking** per consumer, in text and in `--format json`,
   with unused lines and the share.
5. **A document splits its first load from what came after.** The page
   collector drains once when the first navigation settles and again at
   teardown. Fixture: a page whose modal chunk loads on a click.
6. **A later load per step,** read through the story tap in Node, and
   through spec 0054's join where it lands.
7. **Measured on this repository and on the seven-MUI corpus,** with the
   time stated against `covering` on the same record. The public page
   states the reading and lands its terms before any output prints them.
