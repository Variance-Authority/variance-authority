# Which tests an edit needs, and which first

When a repository has wrapped its Vitest or Jest runner, a suite run records
which test file ran which region of which module. Test selection reads that
recording back and answers two questions about an edit: **which recorded tests
it reached**, and **how many imports lie between the edit and each one**. Both
are answers about what executed, not predictions from a build graph.

Use it to shorten the loop. It does not replace the gate: the full suite is the
only green that counts, and every narrowing here is a smaller claim than that.

## Check these first, in order

The first that fails is the whole answer.

1. **Node 22.15 or newer.** `@variance-authority/sense` declares that engine.
2. **`@variance-authority/sense` is installed.** From the repository root,
   `node -e "import('@variance-authority/sense/test-selection').then(()=>console.log('ok'))"`
   prints `ok`. If it fails, add the package as a devDependency with the
   project's package manager. It has no binary; the commands below come from
   `@variance-authority/cli`, which reads the same recording.
3. **The runner is wrapped.** `withTestSelection` from
   `@variance-authority/sense/vitest`, or the one from
   `@variance-authority/sense/jest`, is already in the runner config. Without
   it no run records anything. Wiring it is product work, not something to add
   during an unrelated task.
4. **A suite run has happened since the wrap.** Recording is a side effect of a
   wrapped run; there is no separate build step.
5. **The working directory is the repository root**, the same absolute path the
   recording run used. The recording is keyed by that path.

## Where the recording is, and what refreshes it

It is `coverage.bin` under `<cache>/test-selection/<digest of the checkout's
absolute path>/`, with `<cache>` as `SKILL.md` describes. `testCoverageFile(root)`
from `@variance-authority/sense/test-selection` returns the path; ask it rather
than composing it.

- **Nothing on a timer, and nothing in git.** The file is outside the checkout,
  so `git clean` does not delete it and a branch switch does not change it.
- **A wrapped run records again.** Each run layers over what it finds, per test
  file. That is the only refresh.
- **Per test file, automatically.** Changing a test file's own source, its
  setup, or a declared precondition starts a new generation for that file and
  retires its inherited crossings. A module whose text on disk no longer matches
  its rows marks every test that ran it partial, and a partial observation never
  justifies a skip.
- **Whole, only by being unreadable.** A missing, corrupt or foreign-layout
  recording is treated as absent, and the suite runs whole, which cannot produce
  a wrong skip. To force that, delete the directory `testCoverageFile(root)`
  names and run the suite once.

## From the command line

None of these reads `variance.config.json`. `index` writes the file graph the
other two read, so a pipeline pays for it once.

```bash
variance index                                  # write the file graph the others read
vitest run $(variance select --format vitest)   # skip what the change cannot reach
variance reach --since origin/main              # files a diff reaches over imports alone
```

- **`select` prints a skip list, never a run list.** A test the recording has
  not seen stays in the run. An empty stdout skips nothing, and runs the whole
  suite. Every sentence about the reading goes to stderr, so `$(...)` only gets
  paths. `--format json` gives the counts, and carries the reason it declined
  to narrow as `widened`.
- **`reach` needs no recording**, and reads JavaScript, TypeScript, Python,
  Rust, Java, Kotlin and Swift. It prints a run list, so a reading that cannot
  produce one exits `2` with an empty stdout rather than print a short list.
  `--whole-files` walks from each changed file whole, the answer
  `jest --changedSince` gives, which is how you check what the reading saved.

Which cases ran one line, and what a change did to the cases, is `variance
covering`, in [covering](covering.md).

Use the API below for what the commands do not print: a distance per test, the
`because` trail, or a diff that is not a ref.

## Use the repository's own entry point if it has one

A repository may wire the API into its own script. Read `package.json`'s
`scripts` and the repository's instructions first, and do not assume a command
name or runner option. In the repository this package is developed in, for
example, `yarn test:since --at-distance 0-2` is contributor tooling, not
something `@variance-authority/sense` installs, and it imports the built `dist`,
so it needs a build first.

Use a repository-owned command only when that repository defines and documents
it. Its orchestration must own the current test inventory and dispatch each
path to the Vitest, Jest, Playwright or other host that can run it. When it
exposes distance ranges, read them as hop counts and use the syntax it
documents.

If there is no script, call the API directly. Do not build a selection from
`git diff` and a grep for imports: the answer depends on what executed, and
only the recording has that. Reading the recording is not building
orchestration. Writing an inventory, a skip-list subtraction and a runner
dispatch is, and that is where the line is.

## One complete invocation

Ask the recording what a diff reached, and how far. Run this from the repository
root, as `.mjs`, with both packages installed:

```js
import { execFileSync } from 'node:child_process';
import { relationsOfFiles } from '@variance-authority/core/relate';
import { scanRelations } from '@variance-authority/sense';
import {
  distanceByExecution,
  groupByDistance,
  indexFaces,
  recordedCommit,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';

const root = process.cwd();
const file = testCoverageFile(root);
const commit = await recordedCommit(file);

// Any unified diff over the same checkout. The hunk line numbers must be in the
// coordinates of `commit`: that is what the recording's ranges are numbered in.
const diff = execFileSync('git', ['diff', commit], { cwd: root, encoding: 'utf8' });

// The import graph. Without it every test that is not a precondition is unmeasured.
const relations = relationsOfFiles(await scanRelations({ root, dirs: ['src'] }));

const { narrowing, distances } = await distanceByExecution(file, diff, {
  relations,
  faces: indexFaces(relations),
});
console.log(narrowing.whole.length, narrowing.entered.length, narrowing.unread);
console.log(groupByDistance(distances));
```

Run over one commit that edits `packages/core/src/attribute/stack.ts`, with the
graph left out, that printed:

```text
whole: 406 entered: 3 unread: ["packages/sense/src/test-selection/index-lock.ts"]
because[0]: {
 "test": "packages/core/src/attribute/call-site.test.ts",
 "via": [
  { "kind": "region", "file": "packages/core/src/attribute/stack.ts",
    "name": "", "path": "module", "startLine": 40, "endLine": 242 }
 ]
}
distances: [
 { "test": "packages/core/src/attribute/stack.test.ts", "bearing": "precondition",
   "hops": 0, "from": "packages/core/src/attribute/stack.test.ts",
   "trail": ["packages/core/src/attribute/stack.test.ts"] },
 { "test": "packages/core/src/attribute/call-site.test.ts", "bearing": "unmeasured",
   "because": "no import graph was supplied" }
]
groups: [{"hops":0,"n":2,"unplaced":false},{"n":1,"unplaced":true}]
```

Every part of that output is a rule you will meet again:

- `whole` is what the recording can speak for; `entered` is what the diff
  reached. **The skip list is `whole` minus `entered`, never a run list**: a
  skip list only has to be right about the paths it names.
- `unread` names a changed path the recording says nothing about and the graph
  does not list. It selects nothing, and the skip list is still `whole` minus
  `entered`. Print it: if the suite reads that file without importing it, it is
  a precondition to declare ([selection wiring](selection-wiring.md)).
- `because` has one entry per selected test, in the order of `entered`: a
  `region` (file, name, path and lines of the innermost recorded block a changed
  line fell in), a `precondition` by name, or an `importer` with the trail.
- Two tests came back at `hops: 0` and one `unmeasured`, **because no import
  graph was passed**. Pass `relations` and `faces` as above to measure it.

`selectTestFiles(file, diff, options)` returns `entered` alone, for a caller
that has established `whole` some other way. `narrowByExecution` is the same
query without the distances. Use `narrowByExecution` or `distanceByExecution`
whenever the answer will *exclude* anything.

The full field reference, including `stale` and the `sourceAt` check, is the
README of the installed `@variance-authority/sense`.

## Run the near end first

Every test in the reading has the number of imports between it and the change,
counted only through modules that test ran. The nearest tests exercise the
changed file with the fewest modules in between, so a failure arrives sooner and
has fewer possible causes.

The package defines no command-line spelling. It defines three functions, and
they are how you take one leg:

```js
import { atDistance, distanceRange, remaining } from '@variance-authority/sense/test-selection';

// `distances` is what `distanceByExecution` returned above.
const range = distanceRange('0-2');       // undefined for anything unparsable
const running = atDistance(distances, range.from, range.to);
const later = remaining(distances, range.from, range.to);
```

`distanceRange` reads exactly `2`, `0-2` and `3-`, and returns `undefined` for
anything else: report the typo rather than run one distance. `groupByDistance`
is the whole reading, one group per hop count that occurs, `unplaced` last.

- `0-2` means *no more than two imports away*, not *the first two groups*. A
  change whose nearest test is five hops out answers `0-2` with nothing, and
  that is the true answer: run `3-` next.
- Start at `0`: a test whose own source the edit changed is the most direct
  evidence there is. A range starting at `1` leaves it until last.
- `0-2` then `2-4` overlaps at two hops on purpose, to connect the wider run to
  the boundary the first leg already exercised. `0-2` then `3-` is the
  partition. Pick one and say which.
- A test in the reading whose distance could not be measured is **unplaced**: a
  member of `distances` with no `hops`. `atDistance` gives the unplaced to the
  leg whose range is open at the top and to no other, so `0-2` then `3-` runs
  every element of the array exactly once.
- A current test file that is **not in `distances` at all** is a different case,
  and `atDistance` cannot return it, because it was never passed in. Your
  integration owns the test inventory: diff it against `distances`, keep the
  difference selected, and run it in the final leg.

Show the whole reading beside the leg you took, and name the files left behind.
A green `0-2` says the nearest tests passed and says nothing about four hops;
reporting it as a passing suite reports a pass over work nothing ran.

Distance does not predict runtime. A nearby test can be slow, and splitting one
run into two can cost more wall-clock time than running it once. The benefit is
earlier and more focused feedback, not a faster suite. Do not present a distance
as a time estimate.

## Bearings, and the two findings

Every `TestDistance` has a `bearing`, one of six strings. Four have a `hops`
count: `precondition` (zero, the test's own source changed), `direct` (one),
`transitive` (more) and `reach-through`. Two have none: `unexplained` and
`unmeasured`.

Two of the six are findings. Both are reported whether or not anything failed,
both have an address, and neither proves a defect's cause.

- **`reach-through`** — a hop on the path landed inside a directory rather than
  on the entry module that directory publishes. The report names the importer,
  the internal file and the intended entry. Start at the importing line, not at
  the failure.
- **`unexplained`** — the test ran the changed module along no chain of imports
  it executed, while the graph explains the rest of that run. Shared state, a
  registry, a singleton, a patched prototype, a module-level assignment two
  files agree about and nothing declares. The label does not say which.

**`unmeasured` is not a finding.** The graph could not answer: a built file the
scan does not read, a directory it was not pointed at, a file whose imports
nothing could list, or no graph at all. It has the reason in a `because` string,
and `"no import graph was supplied"` is the first you will see. Treat it as
missing information about the project's wiring, not as a finding about its code.

A distance that could not be measured is absent, and a test whose distance is
unknown is still **selected**: unplaced is a fact about the graph, not
permission to skip. A report that renders a missing distance as `0` is wrong,
and sorts the least understood work in the run to the front.

## Do not

- Do not report a narrowed run, or a near range, as a passing suite.
- Do not read a timeout under a recorded run as a slow test before you have
  compared memory with and without the wrap ([selection
  wiring](selection-wiring.md)).
- Do not record again to make a selection smaller. A stale recording widens the
  run; it does not hide tests.
- Do not infer a distance from reading imports yourself. The graph says what
  could be imported; only the recording says what ran, and a distance has to be
  true of both.
