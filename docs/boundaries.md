# See the structure your imports build

`variance layers` numbers every package by the longest chain of packages it
imports beneath it, and tells you in a pull request which packages changed
number. It needs no declaration of an architecture: it derives the depth from
the imports already in the [source index](source-index.md), so the layers are
the ones your code has, not the ones a config says it should have. Declare a
few line budgets and it also places every package in a tier by how much code it
pulls in. `variance restrictions` adds policy when you want to state a
relationship, a depth limit or a size limit that must hold. Neither asks you to
tag packages.

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
may need six packages or six hundred, which is what a
[tier](#tiers-say-how-much-code-a-package-pulls-in) counts. An import of a
package from a lower
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

## Tiers say how much code a package pulls in

A layer counts how long the chain under a package is. A tier counts how much
code comes with it. Declare the budgets in the `variance.config.json` at the
repository root, largest first:

```json
{ "tiers": [200000, 20000, 1000] }
```

Each number is a budget in lines of code. A package's size is the lines in its
entries plus the lines in every file those files import, followed to the end of
the checkout. A file of the package that no entry loads, such as dead code or a
build script, is not counted. Blank lines and comments are not counted. A type-only
import is not followed, because nothing loads it at runtime. An `import()` is
followed, because something does. Test files, and files only tests import, are
not part of what a package ships.

A package's entries are the files its `package.json` names in `exports`,
`main`, `module` or `bin`, whoever else imports them. A subpath pattern such as
`"./*": "./src/*/index.ts"` names every file it matches. A path under the
build's output is read as the source file the `tsconfig` builds it from, so
`./dist/index.js` is `src/index.ts` whether or not you have built. A package
whose manifest names none of its files, such as an application, starts at the
files its own code never imports — a test or another package importing one
leaves it an entry — and `variance layers` lists every such package once under
its answer.

A package is in the highest-numbered tier whose budget its size fits. Tier 0 is
the first entry and has no limit: a package that fits no smaller budget is tier
0, whatever number you wrote there. Each budget must be smaller than the one
before it, and `variance layers` stops with the file and the reason when one is
not. Nothing assigns a package to a tier; its imports decide it.

With tiers declared, `variance layers` prints each package's tier and size
beside its layer:

```
1 @acme/format tier 2 (412 lines in 6 files)
4 @acme/checkout tier 1 (18250 lines in 131 files)
7 @acme/app tier 0 (164020 lines in 1204 files, 3 files unsized)

Installed packages are not in the code map, so no closure counts their lines.
```

A file the walk arrives at with no size is counted as unsized: a stylesheet, a
file the index holds no parse for, an import the index could not resolve. The
lines around it are then a lower bound, and when the known lines fit a budget
the tier reads `≤ 1`: at most tier 1, maybe lower. An installed package is not a
file of the checkout. The walk stops at it, and does not make the size a lower
bound, because it is left out of every package alike.

Against a base index, `variance layers` names the packages whose tier changed
because of their own code, and counts the rest, the same way it does for
layers:

```
1 package changed tier. 2 other packages moved with it.
@acme/format tier 2 → tier 1 (412 → 1310 lines): its own code 180 → 1078 lines. Carried 2 packages.
```

A tier changes only when the number changes. A size that grows inside its
budget is not reported, and neither is `tier 1` becoming `tier ≤ 1`.

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

### A rule along the chain

An import rule judges one import: the file that writes it and the file it
names. A package that must never rest on code outside `packages/` can break
that through a file that is allowed on its own: `packages/checkout` imports a
shared example under `examples/`, which imports a helper under `tools/`. Write
the rule with `"transitive": true`, and it judges every file a package's
shipped files arrive at, however many imports away:

```json
[
  { "from": "packages/*", "to": "packages/*", "type": "allowed", "transitive": true },
  { "from": "packages/*", "type": "restricted", "transitive": true, "message": "what packages ship stays inside packages" }
]
```

Transitive rules are a list of their own, read like import rules: every
`.relations.json` in or above either end applies, the nearest first, and the
first transitive rule that matches decides. `from` is a file a package ships,
where a walk starts, and `to` is any file the walk arrives at. The walk goes
through every import, types included, because a type check needs the file a
declaration names whether or not anything loads it. It does not go on through a
restricted file.

Test files are not where a walk starts, so a test that imports a helper from
`tools/` is not a finding. A transitive rule does not judge a single import
either; import rules do that, and the two lists never mix.

Each finding is the import that arrives in the restricted file, because that is
the line you change. It is printed with the shortest chain to it and the number
of shipped files behind it:

```
packages/checkout/src/index.ts → examples/shared.ts → tools/helper.ts: what packages ship stays inside packages (.relations.json); 4 shipped files reach examples/shared.ts
1 restricted chain.
```

A chain is read against the code map, which says which files each package
ships. When the map was built from an older source index, the command says so
and asks for `variance index` instead of judging stale files.

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

### A budget on the tier

To say that a package may not pull in more than a tier allows, write `for` and
`maxTier`:

```json
[
  { "for": "packages/*", "maxTier": 1, "message": "a library stays under 20000 lines" }
]
```

`maxTier` names a tier the root `variance.config.json` declares, from 1 to the
last one; tier 0 has no budget, so it limits nothing. A `maxTier` in a checkout
that declares no `tiers` is refused, and so is an entry that holds both
`maxLayer` and `maxTier`. Where several budgets hold a package, the smallest
decides.

`variance restrictions` lists each package over its budget with its size, the
budget and the file that states it, and exits 1:

```
@acme/checkout pulls in 24100 lines, over the 20000 of tier 1: a library stays under 20000 lines (.relations.json)
1 package over a tier budget.
```

A package whose known lines fit, while part of what it pulls in could not be
sized, is printed as undecided and does not fail the command. The rule cannot
say it broke, and `variance layers` counts the unsized files behind it. Like a
layer ceiling, a budget follows the package: a dependency that grows can put a
package over its budget without an edit to it, and `variance layers --against`
names the dependency that did.

### A role a doc declares

Some exports are written for tests: a fixture builder, a fake clock, a reset
for a module's state. Nothing in an import says so, so a shipped component can
start to use one and no rule notices. Write the role in the export's doc
comment, and `variance restrictions` checks it with no `.relations.json`:

```ts
/**
 * Builds a user with every field filled.
 * @testOnly
 */
export function makeUser(): User { … }
```

- **`@testOnly`** says only tests may run the export. Every shipped file that
  imports it is listed, with the line of the import and the place the role is
  declared. The check follows re-exports, so an import through a barrel or
  under a new name is listed too.
- **`@production`** says the export is shipped code. It is listed when only
  tests import the file that declares it.
- **Both tags on one export** is listed as a contradiction.

```
src/Checkout.tsx:4 ships makeUser, declared @testOnly at src/testing/users.ts:5
src/format.ts:12 price is declared @production, but only tests reach it
2 declared roles contradicted.
```

A file counts as test code when its name marks it as a test, or when tests
import it and no shipped file does. Every other file counts as shipped. A
component a story or an example shows is the exception: it is written for the
product, wired in yet or not, so it and what it imports are held to their roles
as shipped code is. The check reads the shown components from where the files
are, not from their names or the story format: whatever a `*.stories.*`,
`*.story.*` or `*.examples.*` file imports from its own directory or below it
is shown. What the catalog imports from elsewhere, such as a decorator in
`.storybook/` or a mock in `test-utils/`, stays test code.

A file whose exports are all `@testOnly`, such as a `testing` entry that
re-exports the fixtures, is test code by declaration, so its own imports are
not listed.
A `@testOnly` export used through a type import is not listed, because the
type import runs nothing.

The tags are read from the doc of the export statement, or for
`export { name }` from the doc of the statement that declares `name`. They are
this project's own tags, not TSDoc release tags such as `@public` or
`@internal`, so writing one does not change what API Extractor or a docs
generator does with the export. If you lint TSDoc, declare both as modifier
tags in `tsdoc.json`:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/tsdoc/v0/tsdoc.schema.json",
  "tagDefinitions": [
    { "tagName": "@testOnly", "syntaxKind": "modifier" },
    { "tagName": "@production", "syntaxKind": "modifier" }
  ]
}
```

A listed role makes `variance restrictions` exit 1, like a broken rule. The
check reads which files are shipped from the code map that `variance index`
writes; when that map is older than the source index, the command says so and
exits 2 instead of guessing.

## What the numbers do not say

- **A high layer is not a defect.** An application package that imports the
  repository sits at the top by design. The layers say what the imports build,
  not whether it was worth building.
- **Depth is not stability.** A package that many others import is costly to
  change however few layers it has beneath it. Layers count what a package
  needs, and the dependants of a package are a separate count.
- **Only package imports count.** An import of an installed third-party package
  is not a layer, adds no lines to a tier, and `restrictions` does not check it.
- **Lines are not bytes.** A tier counts the source lines a package pulls in,
  not what a bundler ships after tree-shaking and minifying. It says how much
  code a package asks you to own, not how much a user downloads.
- **The comment names packages, not files.** It says which package took a new
  dependency, not which file wrote the import.
- **No measured effect is claimed.** The argument is structural:
  dependency depth is a consequence you can see, and dependency direction is
  something you can reason from. Nothing here says fewer layers build faster.

See [orientation](orientation.md#start-from-the-map) for the layers as they
appear in the code map, and [the CLI](../packages/cli) for every flag.
