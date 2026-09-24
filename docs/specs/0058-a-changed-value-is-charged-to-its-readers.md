# Spec 0058 — a changed value is charged to its readers

**Missing:** a way to charge a changed top-level value to anything narrower than
its module. `const LIMIT = 10` becoming `20` ran nothing when it changed. What
the change affects is every place that reads `LIMIT`, and the recording already
holds a region for each of those places. Today the edit lands in the module
region and selects every test that loaded the file.
**Built on:** [0057](0057-a-module-block-is-read-before-it-is-charged.md) (the
`values` verdict, which names the bindings), the import graph selection already
consults (`ExecutionNarrowingOptions.relations`).

## Purpose

In the 2,696-file model behind 0057, 240 files (8.9%) changed a pure value and
nothing that runs at load. Many of those values are exported. For all of these
files, today's charge is the module. When the module is a shared constants
file, that is every test that reaches it.

## What would discharge it

**1. Readers, found by the parser.** A read is an identifier in a position that
reads a binding. The walk is lexical and does not resolve shadowing, so a
parameter with the same name counts as a read. That selects more, never less.
Each read is placed in one of four ways:

| Where the read is | Charged |
|---|---|
| inside a function | the innermost region holding its line |
| at top level, in a statement that runs at load | the module |
| in another pure binding's value (`const B = { a: A }`) | `B` becomes a changed value, and the walk repeats until no new name is added |
| a namespace handed on whole, a `require`, an `import()` | the module: nothing the parser can match by name reaches it |

**2. One file deep, through the graph.** When a changed value is exported, the
walk is repeated in each **direct** importer. The importer list comes from the
import graph selection already has. The detective does not resolve specifiers
and does not read the scan's bindings. In an importer, the seeds are the local
names bound to the exported ones, and `ns.NAME` for every namespace import. An
importer that re-exports the value passes it on to its own direct importers.
Those are the only files reached two or more hops away.

**3. The same parse, in the addon.** The readers are answered from the parse
that produced the verdict in 0057. The importer's text comes from the recording
frame, like any other old text. An importer whose text cannot be proved to be
the recorded one charges its module.

**4. A reason of its own.** `SelectionReason` gets a `reader` kind. It holds the
changed name, the file that declares it, and the region of the read. So
`test:since --dry-run` prints *`LIMIT` in `limits.ts`, read by `clamp` in the
`slider.ts` component* rather than a region the reader never touched.
`distance.ts` counts the distance from the declaring file, because that is
where the edit is.

**Acceptance, as scenarios:**

- `LIMIT` read only inside `clamp` selects `clamp`'s tests.
- `LIMIT` read in `const DEFAULTS = { max: LIMIT }`, with `DEFAULTS` read
  inside `render`, selects `render`'s tests.
- `LIMIT` passed to `configure(LIMIT)` at top level selects the module's tests.
- An exported `LIMIT` imported as `{ LIMIT as max }` and read inside `Slider`
  selects `Slider`'s tests, and no test that only loaded the declaring file.
- `import * as limits` with `limits.LIMIT` read inside a function selects that
  function's tests. `register(limits)` selects the importer's module.

## Out of scope

**Whether a read uses the value.** A read that passes the value to an argument
nothing uses is still a read. Deciding which reads matter is the job of the
compiler and the linter, and the recording then shows which of these regions
ran.

**Two or more hops without a re-export.** When `clamp` returns a value derived
from `LIMIT`, the function that calls `clamp` changes, and that is `clamp`'s
region. Coverage already selects that caller's tests.
