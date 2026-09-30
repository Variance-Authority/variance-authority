# See the structure your imports build

`variance layers` numbers every package by the longest chain of packages it
imports beneath it, and tells you in a pull request which packages changed
number. It needs no declaration of an architecture: it derives the depth from
the imports already in the [source index](source-index.md), so the layers are
the ones your code has, not the ones a config says it should have.
`variance restrictions` adds policy when you want to state a relationship or a
depth limit that must hold. Neither asks you to tag packages.

## Why the number matters

The idea that imports form a hierarchy, and not only a list, is older than package
managers. [On dependencies](on-dependencies.md) follows it from Parnas and
Dijkstra through levelization to architectural fitness functions.

An import is cheap to write and lasting to own. The layer makes what it does
to the depth of the graph visible. A package that imports nothing else in the repository is layer 1. Any
other package is one layer above the highest layer among the packages it
imports. Packages that import each other in a cycle count as one step.

The number says two things, and a third that it does not.

**How deep a package's longest chain goes.** A layer 1 package can be used,
built and tested alone. A layer 7 package has a chain of six packages under it,
each importing the next. This is dependency depth, not size: a layer 7 package
may need six packages or six hundred, and an import of a package from a lower
layer than its highest one leaves the layer as it is. Only an import that
lengthens the longest chain raises it. Depth is not blast radius either: the
packages most of the repository imports sit in the lowest layers, so a change
to one of them affects the most code. Layers count how long the chain a package
needs is, not how many packages it needs and not what needs it.

**Which way the graph points.** Outside cycles, every import points from a
higher layer to a lower one, and that is the same for the whole repository: a
package may know about what is below it, and what is below it cannot know about
it. Packages in a cycle collapse into the same step. The cycle that
nobody chose, where four reasonable imports add up to `core` importing
`feature` importing `helper` importing `core`, shows up as one step instead of
four layers, which is a change you can see in a review. Layers do not forbid an
import. They give the graph a down.

**Affected work, which the number does not say.** Depth is separate from how
much a change affects. Build tools such as Nx use the same package graph to
decide what a change may invalidate, but that depends on what imports the
changed package: a layer 1 package nobody imports affects nothing, and a layer 1
package that 400 packages import affects all of them. Test selection is
different again. [Selecting tests](selecting.md) uses which tests ran the
changed code in a recorded run, not which packages import it, so a tall graph
does not make Variance run more tests.

## Declared or derived

Large repositories already treat the direction of dependencies as architecture.
Bazel and Buck2 give every target a visibility list, and Buck2 adds
`within_view` to limit what a target may depend on. Pants has
`__dependencies_rules__` and `__dependents_rules__`. Nx tags projects and states
which tags may depend on which. Fluid Framework keeps a `layerInfo.json` that
names its layers, their packages and the layers each may depend on, and fails the
build on a deviation.

All of them start from a statement of what the architecture should be. That
statement has to exist before it can be enforced, and it has to be kept true
after.

`variance layers` starts from the other side. With no rules written, the imports
already give every package a layer, and a pull request that changes a layer is
reported whether or not anyone thought to forbid it. `restrictions` is what you
add when you do want to state an edge that must not exist; the two work
independently. The search for a tool that reports a package's computed layer
changing in a pull request found none among these.

## What a pull request shows

A layer is a number, and a number alone changes nothing. `layers` compares the
number in two source indexes:

```bash
variance layers --against base.index --format markdown
```

Adding one import to `packages/foo` can lift `foo` from layer 3 to 4, and every
package that imports `foo` with it. Listing all of them would print one edit
five hundred times, so the answer names the packages whose own imports changed,
and counts the rest:

```
1 package changed its layer by its own dependencies. 42 other packages moved with it.
packages/foo 3 → 4: takes packages/bar. Carried 42 packages.
```

You can still say yes; no layer is wrong by itself. The reviewer sees what the
edit did to the structure, and the author sees it too. The command always
exits 0 and prints nothing in `--format markdown` when no package changed layer,
so a CI job can post the answer as a pull-request comment and clear the comment
when there is nothing to say. Run without `--against`, it lists every package's
layer, lowest first.

The base index is one that `variance index` built at the base commit. A base
with no package layers, built before the code map recorded them, is refused with
a message that says so.

## Restrictions say what is not allowed

Layers describe the structure that exists. Restrictions state the structure you
want. Put a `.relations.json` in any directory:

```json
[
  { "from": ".", "to": ".", "type": "allowed" },
  { "to": ".", "type": "restricted", "message": "core is internal" }
]
```

```bash
variance restrictions
```

Each rule has a `type` of `allowed` or `restricted`, an optional `from` and
`to`, and an optional `message` that is printed with a violation. `from` and
`to` name a folder or a glob, or `*` for everything, and are relative to the
directory of the file, where `.` is that directory. An omitted side matches
anything. Every `.relations.json` in or above the directory of either end of an
import applies, the nearest one first, and the first rule that matches decides.
An import that no rule matches is allowed. The example above lets code inside
the folder import code inside it, and closes the folder to everything outside.

The rule model follows the `restrict` rule of
[eslint-plugin-relations](https://github.com/theKashey/eslint-plugin-relations),
so its rules carry over. Two differences follow from what runs where:

- **The graph comes from the source index,** so `variance restrictions` checks
  the whole repository in one pass and does not need a lint run.
- **Rules are JSON.** A `.relations.json` is data and is never run. A RegExp or a
  rule computed in JavaScript is not supported; write a glob.

`restrictions` exits 1 when an import breaks a rule, and 0 otherwise. Without a
`.relations.json` it says so and exits 0. A fence that cannot fail is a comment,
so the exit code is the gate; leave the command out of CI if you do not want one.

### A family of packages named alike

Packages sit in one flat directory, and a name marks the group: `postoffice` is
the package other code uses, and `postoffice-stamps`, `postoffice-routes` and
the rest are its internals. Put one file in `packages/`:

```json
[
  { "from": "postoffice", "to": "postoffice-*", "type": "allowed" },
  { "from": "postoffice-*", "to": "postoffice-*", "type": "allowed" },
  { "to": "postoffice-*", "type": "restricted", "message": "postoffice-* is internal to postoffice" }
]
```

`postoffice` and every `postoffice-*` may import the `postoffice-*` packages.
Any other package that imports one is listed with the message, including a
package named `postofficer`, because the glob needs the hyphen. Anyone may
import `postoffice` itself, since no rule names it as a target. A new
`postoffice-*` package is inside the group the day it is created; nothing is
edited.

### One public package inside a folder of internals

The packages that make up a feature live together, and one of them is its
entry. Put one file in `src/houses/cards/`, which holds `house-of-cards` and
the internals around it:

```json
[
  { "to": "house-of-cards", "type": "allowed" },
  { "from": ".", "to": ".", "type": "allowed" },
  { "to": ".", "type": "restricted", "message": "use house-of-cards; the rest of cards is internal" }
]
```

Rules are read top to bottom and the first match decides. Everyone may import
`house-of-cards`. What is inside `src/houses/cards` may import the rest of it.
Everything else that imports into `src/houses/cards` is listed. Imports
elsewhere under `src/houses` are not affected, because no rule matches them.

Both shapes are run as tests over the rule engine (`restrictions.test.ts`).

### A ceiling on the layer

An import rule names an edge. To say that a package may not sit above a layer,
write a rule with `for` and `maxLayer` in the same file:

```json
[
  { "for": "packages", "maxLayer": 5, "message": "keep the tree shallow" },
  { "for": "packages/postoffice-*", "maxLayer": 3 }
]
```

`for` is a folder or a glob, written like `from` and `to` and relative to the
file. The first rule caps every package under `packages`. The second caps the
packages named `postoffice-…` lower. Where several ceilings hold a package the
lowest decides, so a cap written in a subfolder can tighten a folder's ceiling
and never loosen it. `maxLayer` is a whole number from 1.

A ceiling constrains the layer a package ends up with, not only the imports
written inside it. If a package lower in the graph gets deeper, every package
above it may get deeper too, so a capped package can fail although none of its
own files changed. This is what the rule says: `maxLayer` is how deep that
package may become, whichever dependency made it deeper. The ceiling follows
the package, not the edit that moved its layer.

```
payments   layer 5, maxLayer 5
   ↓
ledger     layer 4
```

If `ledger` takes a new import and moves from layer 4 to 5, `payments` moves
from 5 to 6 without an edit, and `variance restrictions` reports it above its
ceiling. `variance layers` shows the same edit in the pull request that made
it, with `ledger` as the cause and `payments` as carried.

`variance restrictions` lists each package above its ceiling with its layer,
the ceiling and the file that states it, and exits 1, like a restricted
import. The layer is the same repository-wide number `variance layers` prints,
not one counted inside the folder. A ceiling is checked against the source
index's package layers; if the index holds none, the command says so instead of
passing. The ceiling is a number you chose, so pick it after reading the layers
you have: a cap below where the repository already sits fails on the first run.

A ceiling on the packages a package may import, such as "nothing below layer 5",
is not supported.

Both the flat-directory cap and the folder cap are run as tests
(`restrictions.test.ts`, `restrictions-caps.test.ts`).

## What the numbers do not say

- **A high layer is not a defect.** An application package that imports the
  repository sits at the top by design. The layers say what the imports build,
  not whether it was worth building.
- **Depth is not stability.** A package that many others import is costly to
  change however few layers it has beneath it. Layers count what a package
  needs, and the dependants of a package are a separate count.
- **Only package imports count.** An import of an installed third-party package
  is not a layer, and `restrictions` does not check it.
- **The comment names packages, not files.** It says which package took a new
  dependency, not which file wrote the import.
- **No measured effect is claimed.** The argument is structural:
  dependency depth is a consequence you can see, and dependency direction is
  something you can reason from. Nothing here says fewer layers build faster.

See [orientation](orientation.md#start-from-the-map) for the layers as they
appear in the code map, and [the CLI](../packages/cli) for every flag.
