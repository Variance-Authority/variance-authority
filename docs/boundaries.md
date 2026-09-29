# See the structure your imports build

`variance layers` numbers every package by how much of the repository sits
beneath it, and tells you in a pull request which packages changed number.
`variance restrictions` checks imports against rules you write down. Neither
asks you to tag packages or declare an architecture first: both read the import
graph in the [source index](source-index.md), so the layers are the ones your
code has, not the ones a config says it should have.

## Why the number matters

An import is cheap to write and lasting to own. The layer makes its cost
visible. A package that imports nothing else in the repository is layer 1. Any
other package is one layer above the highest layer among the packages it
imports. Packages that import each other in a cycle count as one step.

The number says three separate things.

**How much a package needs beneath it.** A layer 1 package can be used, built
and tested alone. A layer 7 package needs a chain of six layers under it. This
is dependency weight, and it grows with every import. It is not blast radius:
the packages most of the repository imports sit in the lowest layers, so a
change to one of them affects the most code. Layers count what a package needs,
not what needs it.

**Which way the graph points.** With layers, every import has a direction, and
the direction is the same for the whole repository: a package may know about
what is below it, and what is below it cannot know about it. The cycle that
nobody chose, where four reasonable imports add up to `core` importing
`feature` importing `helper` importing `core`, shows up as one step instead of
four layers, which is a change you can see in a review. Layers do not forbid an
import. They give the graph a down.

**What builds and checks have to redo.** Building, type checking, bundling and
task scheduling in tools such as Nx follow the static package graph, so a change
low in it invalidates more of it. This does not apply to test selection.
[Selecting tests](selecting.md) uses which tests ran the changed code in a
recorded run, not which packages import it, so a tall graph does not make
Variance run more tests.

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
- **No measured effect is claimed.** The argument is structural: a layer count
  is a cost you can see, and a direction is one you can reason from. Nothing
  here says fewer layers build faster.

See [orientation](orientation.md#start-from-the-map) for the layers as they
appear in the code map, and [the CLI](../packages/cli) for every flag.
