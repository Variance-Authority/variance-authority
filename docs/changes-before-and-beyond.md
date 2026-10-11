# Changes before and beyond

Two changes widen a run that no import graph can narrow: a config file nothing
imports, and a package you never wrote. Selection answers from the names files
import from each other, so a change with no name in those imports is either the
whole suite or nothing at all — and which of the two is a choice you make rather
than one the walk makes for you. This page is about those two changes, and
[selection](selecting.md) is about everything between them.

Read a run from left to right. The harness starts it, the tests it started run
your code, and your code goes out into what the install provides and never comes
back. Selection lives in the middle stretch, where a file has a name the record
can store. What comes before it and what lies beyond it are both outside
selection, for opposite reasons.

```mermaid
flowchart LR
  subgraph before["before reach"]
    node["node version"]
    config["jest config, vite config, next setup"]
  end
  subgraph reach["within reach"]
    tests["your tests"]
    code["your code"]
  end
  subgraph beyond["beyond reach"]
    direct["@mui/material"]
    transitive["jsdom"]
  end

  node --> config
  config --> tests
  tests --> code
  code --> direct
  direct --> transitive
  transitive -.->|"wired into the environment"| config

  classDef outside fill:none,stroke-dasharray:4 3;
  class before,beyond outside;
```

**Beyond reach** is the far right: a dependency bump. Nothing in the diff names
a file you wrote, and yet the code that imports the bumped package renders
differently. That change is reachable, because the thing that changed has a
name and your files import that name.

**Before reach** is the far left: the node version, the harness config, the
bundler setup. Nothing imports them and they change everything downstream of
themselves. That change is not reachable, and a diff that touches only it runs
the whole suite.

## What a bumped package reaches

A package is a node in the graph like a file is, and an import of one is an edge
to it. So the question a dependency bump asks is the question every change asks
— *which subjects covered something that depends on this* — and it is answered
by the same walk, from a seed at the other end of the line.

| The diff contains | Selection does |
| --- | --- |
| `@mui/material` bumped | Every file whose imports reach it is treated as changed, transitively, and selection proceeds from there |
| `jsdom` bumped, and only `jest-environment-jsdom` depends on it | The bump is traced up through the install to the packages that rest on it, and then into your files. A transitive dependency is not a shorter question, only a longer trail |
| `@mui/material` bumped and no file imports it | Nothing. An installed package with no importer reaches nothing |
| Only a `type` import names the bumped package | Nothing. Types are erased before anything runs, so nothing a run can observe rests on them |
| A file that imports the bumped package was never measured | That file selects nothing, and every measured file the walk reaches beside it or above it selects the tests that ran it. The record has no crossing to charge an unmeasured file with, and declaring the file does not change that: a precondition selects on a change to the declared file's own text, never on a bump beneath it |

Which **copy** of a package an importer got is not asked. A specifier names
`@mui/material`; which of the installed instances a resolver hands it is
unanswerable without reproducing that resolver, and a selector that guessed
would skip on the guess. Names over-include, and over-including is the safe
direction.

## Why the lockfile is read and not diffed

`package.json` is a request, the lockfile is the answer, and neither is a
changed file here. They are read at two revisions — the base and the working
tree — and compared as installs, which is a different question from *did this
file's bytes change*. For `variance select` the base is the install the
recorded suite ran on: the journal's commit, unless the recording ran over
lockfiles or manifests you had not committed. A run keeps those texts, and they
are what your tree is compared from; a recording that kept none is compared from
its commit.

- A workspace edit rewrites `yarn.lock` and changes no package. Compared as an
  install it contributes nothing.
- A resolution or an override changes what `^4.17.21` means without changing the
  line that asked for it. Compared as an install it is a bump like any other.
- Both paths are then dropped from the changed-file list. They have no row in
  any record, so left in they would be reported a second time for the very
  thing they just explained.

`yarn.lock` (classic and Berry), `pnpm-lock.yaml` and `package-lock.json` are
read. **A lockfile that cannot be read widens the run**: a comparison that could
not be made is not a comparison that found nothing.

## How a change before reach is declared

A change to `vite.config.ts`, to the jest environment, to the node version in
CI: none of them is imported by anything, so there is no edge to walk back
along and no answer smaller than the whole suite. That much is decided for you.
What is not decided is whether the run notices.

A diff that is *only* a config file already runs everything when no execution
record is kept, because a diff no part of which is in the graph shows nothing
about which component changed. That stops being true the moment anything else
is in the diff, or a record is kept: the record has no row for the config file,
so it keeps no subject in the run. A CI workflow edited
beside one component gives the walk a seed, and the run narrows to that
component, though it never examined the change that seeded it.

Name the files the run rests on and it stops being an accident. What every
suite rests on goes at the top, and what one suite rests on goes beside its
kind:

```json
{
  "before": [".github/workflows", ".nvmrc"],
  "suites": {
    "unit": { "kind": "unit", "before": ["vitest.config.ts", "test/global-setup.ts"] },
    "e2e": { "kind": "e2e", "relations": false, "before": ["playwright.config.ts", "src/main.tsx"] }
  },
  "source": { "dirs": ["src"], "relations": true }
}
```

A runner config names its setup files and its environment as strings —
`setupFiles: ['./test/setup.ts']`, `testEnvironment: 'jsdom'` — and a string
is not an import, so nothing in the graph runs from the config to them. The
runner integrations record some of them on every test they run, as
preconditions: Vitest records the config file Vite loaded, the local modules it
imports, its `setupFiles`, `snapshotSerializers` and `diff` file; Jest records
`testEnvironment`, `setupFiles` and `setupFilesAfterEnv` when they are files of
the repository; Rstest records `setupFiles`. Every test a configuration runs
declares them, so a change to one selects every test it governs. Name the rest
in `before`: `globalSetup` in every runner, Jest's `globalTeardown`, Jest's and
Rstest's config file, Jest's `moduleNameMapper` and `transform` targets, and
everything a Playwright config names. Name a recorded file too, as the example
does with `vitest.config.ts`, when its change must run every test file: a
recorded file reruns only the recorded tests that declared it, and a `before`
entry also runs the tests no recording has seen.

Each entry is matched against the diff by path, so naming a directory of
workflows is one line rather than one per file. A directory is also walked: every
file under it is an entry point, so a `test/` that holds the setup brings in
what that setup loads, wherever it lives. When a top-level entry changes,
`variance run --since` runs whole; when either list changes for the suite
`variance select` reads, it skips none of that suite. Each names the file that
put it there.

Which paths govern a run is a fact about your repository, and no rule derives
it. *Every changed path the graph does not include* would be the README, the
changelog and the editor settings — a whole run each, forever — and switching
that off would switch the config files off with it. Declared, it is exact.

`variance run --since` reads the top-level `before`, and needs
`source.relations: true` to do it, because what an entry point buys is
everything below it.

`variance select` reads both: the top-level list and the list of the suite whose
record it reads, or with `--execution` the suite `--suite` names. A change to anything either one reaches runs that whole suite,
and `select` names what put it there. A suite with no `before` has nothing
before its reach, and `select` prints that beside its answer. Beside what they
record themselves, the Vitest, Jest and Rstest integrations take a
`preconditions` option: every test they record declares each file it lists, and a change to one
selects every test that declares it. A changed file nothing imports and nothing
declares selects nothing, and `select` names it.

An end-to-end suite reaches your app through a browser and imports none of it,
so the import graph names none of its tests, or names a unit test's neighbour by
accident. Give such a suite `"relations": false` and list the files it rests on
in its own `before`. A changed file its record did not measure then selects
nothing in that suite, without a walk, and `select` names it declined; a change
to an entry point runs the suite whole.

## What comes with a declared entry point

A declared file is one name. The fixture only the setup imports, the polyfill,
the DOM package it registers: each is an ordinary file or package that nothing
in a test imports, whose change reaches no component, and which on its own
narrows a run to nothing. Declared once, they arrive with the file that
imports them — the entry point is the one thing walked **along** the arrows
instead of against them.

```mermaid
flowchart LR
  config["vitest.config.ts<br/>declared"]
  setup["test/setup.ts<br/>declared"]
  fixtures["test/fixtures.ts"]
  env["global-jsdom"]
  jsdom["jsdom"]
  theme["src/theme.ts<br/>sensed"]
  tokens["src/tokens.css"]
  button["Button.tsx"]

  setup --> fixtures
  setup --> env
  setup --> theme
  env --> jsdom
  theme --> tokens
  button --> theme

  classDef rests fill:none,stroke-width:2px;
  classDef sensed fill:none,stroke-dasharray:4 3;
  class config,setup,fixtures,env,jsdom rests;
  class theme,tokens,button sensed;
```

The descent stops at the first file `source.dirs` already covers. A setup file
that imports `src/theme.ts` does not drag it in: that file has dependents, a
change to it is answered exactly by walking them, and pulling it in would trade
an exact answer for a whole run. Everything below it is reached *through* it,
so `src/tokens.css` stays out too.

An entry the scan does not cover — a `.nvmrc`, a workflow, a `tsconfig` —
has nothing under it to read. It contributes its own name, which is all it has,
and the run prints that in a note.

The cost is real and it is yours to spend. A config that imports your bundler
rests on everything that bundler rests on, so a bump inside that set widens the
run. That is the correct answer, because the harness did change; a repository
that finds it too wide narrows what it declares.

## Where before and beyond meet

A `jsdom` bump is beyond reach, and the environment it is wired into is before
reach — the only arrow in the first figure that points back to the left. The
install comparison names `jsdom`; the harness depends on it through
`global-jsdom`, which the declared setup imports; and no file you wrote ever
spells the word. An environment the config names only by string is not
imported by anything, so its packages are not reached. Undeclared, that diff narrows to whatever else it
touched. Declared, the run is whole, and it names `jsdom`.

