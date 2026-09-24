# ADR-0072 — a change is read before it is charged

**Status:** accepted
**Date:** 2026-09-24
**Relates to:**
[ADR-0071](0071-the-block-walk-is-the-addons.md) (the parse this reuses),
[ADR-0069](0069-every-answer-has-an-owner.md),
[`packages/sense/native/src/module_verdict.rs`](../../../packages/sense/native/src/module_verdict.rs),
[`packages/sense/native/src/module_readers.rs`](../../../packages/sense/native/src/module_readers.rs),
[`packages/sense/src/test-selection/reading.ts`](../../../packages/sense/src/test-selection/reading.ts),
[`packages/sense/src/test-selection/values.integration.test.ts`](../../../packages/sense/src/test-selection/values.integration.test.ts)

## Context

A changed line was charged to the narrowest region holding it. At a module's
top level that region is the module itself, and its crossings are every test
that loaded the file. So a comment above the imports, a type, a new function
and a new top-level call were charged the same way. Over 2,696 changed source
files from 1,067 commits of `material-ui`, `shadow` and `briefcase`, that charge
was the module for 84.8% of them. A model that read what each top-level change
did charged the module for 13.9%.

The same charge applied to a changed constant. `LIMIT = 10` becoming `20` runs
nothing when it changes. What it changes is every function that reads `LIMIT`,
in its own file and in the files that import it. The recording already holds a
region for each of those functions.

## Decision

**Each changed file is read from both of its texts before any region is
charged.** The old text is the one the frame check proved the recording was cut
from. The new text is that text with the diff's hunks applied. A context or
removed line that is not in the old text means the diff was made against
something else. That file gets no reading and is charged by its lines.

**The addon gives one verdict per file, over oxc's typed tree.** It parses each
side twice: whole, and with every function body emptied. No tree is sent to
JavaScript, and none is converted to ESTree.

| Verdict | What it found | Charged |
|---|---|---|
| `none` | The two programs are equal once comments, types and formatting are removed. | nothing |
| `bodies` | The load sequence and every binding's value are equal. | the regions the lines land in, without the module's own |
| `values` | The load sequence is equal, and some bindings' values moved. | the same regions, and every reader of the moved values |
| `load` | What the module does as it loads moved. | the module |

The load sequence is every top-level statement that runs something as the module
evaluates. An import counts by what it loads, never by the names it binds. So
adding a name to an import is a change to the functions that use the name.

**A moved value is charged where it is read.** The reads are lexical, and a
parameter with the same name counts as a read. A read inside a function charges
the innermost region holding it. A read in a load-time statement charges the
module. A read in another pure binding's value moves that binding too. An
exported value is followed one file deep, into each direct importer on a
runtime edge. It goes further only where an importer re-exports it. An importer
that hands a namespace on whole charges its module, because no name follows the
value from there. A test file that reads the value selects itself.

**An insertion between regions charges nothing under a reading.** Without a
reading, text added between two lines charges the regions on both sides, because
lines alone cannot tell text added inside a function's last line from text added
after it. With a `bodies` or `values` verdict, text added in a gap that no region
spans is top-level. The verdict already proved it loads nothing, and a value it
moves is charged to that value's readers.

**Every reading is printed.** `ExecutionNarrowing.readings` carries each file's
verdict, or why it got none: no `sourceAt`, a hunk that did not apply, a text
that does not parse, or no addon. `test:since` prints one line per file. A
selection that reaches a test through a read carries a `reader` reason, which
names the value, the file that declares it and the file that reads it.

## Alternatives

**Read the module in JavaScript, over `oxc-parser`'s ESTree.** The tree crosses
the boundary for every changed file and every importer. ADR-0071 removed that
crossing from the walk, and the reading would bring it back.

**Follow a value through every hop.** When `clamp` returns something derived
from `LIMIT`, the change reaches `clamp`'s callers through `clamp`'s region,
which is already charged. Following the value further would charge more on the
strength of a read the recording already answers.

**Charge only the importers the graph names.** An importer the scan did not see
would lose the charge silently. Instead, a test that crossed the declaring
module's top level and was not reached through any importer the reading
examined is still charged.

## Cost

- **A machine without the addon reads nothing.** Every file is charged by its
  lines, and each reading says `addon`.
- **A read is a name, not a use.** A shadowing parameter, or a value passed to an
  argument nothing uses, still selects. The compiler and the linter decide which
  reads matter.
- **What the file's text cannot show is not seen.** A getter on an imported
  object is a property read and counts as load. `Object.prototype` patched from
  another module does not appear in this file's text.
- **The reading is only as good as the recording's lines.** A recording made
  before `sense:instrument/presence-v5` placed parameters and injected helpers on
  the wrong lines. It is read as stale and recorded again.
