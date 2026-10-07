# Selection through the API

Read this for what `variance select` and `variance reach` do not print: a
distance per test, the `because` trail, or a diff that is not a ref. The
recording, the commands and the bearings are in [test
selection](test-selection.md).

## One complete invocation

Ask the recording what a diff reached, and how far. Run this from the checkout's
root, as `.mjs`, with `@variance-authority/sense` and `@variance-authority/core`
installed:

```js
import { execFileSync } from 'node:child_process';
import { relationsOfFiles } from '@variance-authority/core/relate';
import { scanRelations } from '@variance-authority/sense';
import {
  distanceByExecution,
  groupByDistance,
  indexFaces,
  readableTestCoverage,
  recordedCommit,
} from '@variance-authority/sense/test-selection';

const root = process.cwd();
// Name the suite when the root variance.config.json declares `suites`;
// leave the option out when it declares none.
const file = await readableTestCoverage(root, { suite: 'unit' });
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
console.log(narrowing.because[0].via[0]);
console.log(groupByDistance(distances));
```

In the repository this package is developed in, with `dirs: ['packages']` and a
diff that changes line 152 of `packages/sense/src/test-selection/at-distance.ts`,
that printed:

```text
667 1 []
{
  kind: 'region',
  file: 'packages/sense/src/test-selection/at-distance.ts',
  name: 'reachesTheEnd',
  path: 'for#0/body/if#0/else',
  startLine: 152,
  endLine: 152
}
[
  {
    hops: 1,
    tests: [ 'packages/sense/src/test-selection/at-distance.test.ts' ],
    unplaced: false
  }
]
```

Read it by these rules:

- `whole` is the set of paths the recording covers; `entered` is what the diff
  reached. **The skip list is `whole` minus `entered`, never a run list**: a
  skip list only has to be right about the paths it names.
- `unread` names a changed path the recording has no row for and the graph
  does not list. It selects nothing, and the skip list is still `whole` minus
  `entered`. Print it: [selection wiring](selection-wiring.md#what-selection-refuses-to-narrow)
  says when such a path is a precondition to declare.
- `because` has one entry per selected test, in the order of `entered`. Its
  `via` lists every fact that selected the test: a `region` for each recorded
  block a changed line fell in (file, declaration, path in it, lines), a
  `precondition` by name (the test's own source, a setup or a configuration
  file it declared), a `reader` (a file that reads a `name` the changed file
  declares), or an `importer` with the trail.
- `distances` can hold a test outside `entered`: one in `incomplete` that the
  diff did not enter, placed by the shortest path it ran to a file in
  `readings` it loaded. Every reading seeds, an `unread` one included, except
  a `none` the parser decided; a `none` with `kept: true` seeds. A changed file
  with no reading seeds no test: a stale one, or one whose text was checked and
  that has no line ranges, such as a rename, mode or binary change. An
  incomplete test with no path is left out of `distances`.
- Leave `relations` and `faces` out, and every test that is not a precondition
  comes back with no `hops`, `bearing: 'unmeasured'` and `because: 'no import
  graph was supplied'`.

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
is the whole reading: one `{ hops, tests, unplaced }` group per hop count that
occurs, and the unplaced last, with no `hops`.

- `0-2` means *no more than two imports away*, not *the first two groups*. A
  change whose nearest test is five hops out answers `0-2` with nothing, and
  that is the true answer: run `3-` next.
- Start at `0`: a test whose own source the edit changed is the most direct
  evidence there is. A range starting at `1` leaves it until last.
- `0-2` then `2-4` overlaps at two hops on purpose, to connect the wider run to
  the boundary the first leg already exercised. `0-2` then `remaining(distances,
  0, 2)` is the partition. Pick one and say which.
- A test in the reading whose distance could not be measured is **unplaced**: a
  member of `distances` with no `hops`. `atDistance` gives the unplaced to every
  leg whose top is at or past the furthest hop the reading placed, and an open
  top such as `3-` always is. So when nothing was placed beyond two hops, `0-2`
  and `3-` both return them. Take the later leg from `remaining` to run each
  test once. A reading that placed nothing gives them to an open range only, so
  `0-2` returns none of them there.
- A current test file that is **not in `distances` at all** is a different case,
  and `atDistance` cannot return it, because it was never passed in. Your
  integration owns the test inventory: diff it against `distances`, keep the
  difference selected, and run it in the final leg.

Show the whole reading beside the leg you took, and name the files left behind.
A green `0-2` shows the nearest tests passed and is no evidence about four hops;
reporting it as a passing suite reports a pass over work nothing ran.

Distance does not predict runtime. A nearby test can be slow, and splitting one
run into two can cost more wall-clock time than running it once. The benefit is
earlier and more focused feedback, not a faster suite. Do not present a distance
as a time estimate.
