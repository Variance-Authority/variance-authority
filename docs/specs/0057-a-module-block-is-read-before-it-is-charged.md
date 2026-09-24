# Spec 0057 — a module block is read before it is charged

**Missing:** any reading of a change that lands at a module's top level. Today
the line lands in the module region, and the module region's crossings are every
test that loaded the file. A comment above an import, a type alias, a new
function beside the others and a changed top-level call are all charged the
same way: every test that loaded the file runs.
**Built on:** [0030](0030-a-diff-lands-on-blocks.md) (the line-to-region
mapping this does not replace), [ADR-0071](../context/adr/0071-the-block-walk-is-the-addons.md) (the walk and
the parse this reuses), `select.ts` `recorded()` (the frame check that proves
the old text is the recorded text).

## Purpose

Most of the time this charge is the wrong one. Over 2,696 changed source files
from 1,067 commits of three corpora (`material-ui`, `shadow`, `briefcase`),
today's mapping charged the whole module for **2,286 files (84.8%)**. For 405
files (15.0%) it charged a region, and it skipped 5.

A model that reads what the top-level change did, rather than where it sits,
charged the whole module for 376 files (13.9%). The rest:

| The change | Files | Charged |
|---|---:|---|
| only inside function bodies or signatures, or a declaration removed | 842 (31.2%) | the regions, as 0030 already does |
| an import added, removed or renamed | 836 (31.0%) | the regions for a rename; the module for an import added or removed |
| comments, types, formatting, a new function, a new pure binding, an export list | 402 (14.9%) | nothing |
| a pure top-level value changed | 240 (8.9%) | its readers ([0058](0058-a-changed-value-is-charged-to-its-readers.md)) |
| a statement that runs at load | 376 (13.9%) | the module |

Each file is counted once, under the most expensive row that applies to it.
The model did not split the import row, so how many of its files keep a module
charge is the first number the built reading reports.

An import that only changes the names it binds is not a load change. The
functions that use the new name changed as well, and they are regions. An import
of a new module, or a removed one, changes what the module does when it loads.
That is a load change.

## What would discharge it

**1. Both texts, from what the caller already has.** The old text is
`sourceAt(name, commit)`: the text `recorded()` has already proved to be the
one the recording was made from. The new text is that text with the diff's
hunks applied. A context or removed line that does not match the old text is a
diff made against something else. That file gets no reading and is charged as
it is today. No working tree and no second commit is read.

**2. One parse per side, in the addon.** The verdict comes from the same native
parse the block walk makes ([ADR-0071](../context/adr/0071-the-block-walk-is-the-addons.md)). No AST is sent to
JavaScript. The addon answers with one of four verdicts:

| Verdict | Meaning | Charged |
|---|---|---|
| `none` | The runtime text is equal: only comments, types, formatting or spelling differ. | nothing |
| `bodies` | The load sequence and every pure binding are equal. What differs runs only when something calls it. | the regions 0030 maps to, without the module region |
| `values` | The load sequence is equal, and these pure bindings' values differ. | the readers of those names ([0058](0058-a-changed-value-is-charged-to-its-readers.md)) |
| `load` | What the module does when it loads is different. | the module, as today |

**3. What counts as the load sequence.** It is every top-level statement that
runs something when the module evaluates:

- an import, keyed by the specifier and by whether anything is bound, never by
  the names bound;
- a re-export's source;
- a call;
- a declaration whose initializer calls a function, reads a property, spreads,
  destructures or awaits;
- a class that extends, has a decorator, has a static field or a static block,
  or has a computed key;
- an emitted enum or namespace.

Every function in it is written `ƒ`, because creating a function runs none of
its body. A **pure binding** is any other named declaration. Its value's shape
is compared with positions, comments and type syntax removed.

**4. A name that appears or disappears.** Who reads a new name is the job of the
compiler and the linter. There is one case where a lexical read does change
meaning: a top-level name added with the same name as a global the old text
already read, or a name removed while the new text still reads it. That name is
reported as a changed value.

**5. Every verdict is printed.** Each changed file's line in `test:since` says
which verdict it got and what that verdict charged. A file that got no reading
says why: a parse error, a hunk that did not apply, or no `sourceAt`. A
narrowing nobody can see looks the same as a selector that missed a test, and
[`selecting.md`](../selecting.md) is where a reader learns the verdicts.

**Acceptance, as scenarios:**

- A comment added above the imports of a module every test loads selects no
  test.
- A new exported function selects no test.
- `const LIMIT = 10` changed to `20` selects only the tests that ran a function
  reading `LIMIT`.
- `register(plugin)` added at top level selects every test that loaded the
  file.
- `import { a } from './x'` changed to `import { a, b } from './x'`, with `b`
  used inside one function, selects that function's tests.

## What it forecloses

**Sub-line precision.** One line holding a changed condition charges every
region whose text is on that line. The saving from splitting a one-line
condition is small, and the lines where it applies are few.

**Global side effects through a pure-looking value.** A getter on an imported
object is a property read and so counts as load. But `Object.prototype` patched
from another module is not visible in this file's text, and nothing here tries
to see it.
