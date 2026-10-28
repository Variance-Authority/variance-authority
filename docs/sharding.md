# Split a test suite across CI jobs

Shard a Vitest, Jest or Playwright suite with `--shard k/n`, and each shard
takes whole test files by how long they took on the last recorded run, not by
how many there are. Each file goes in turn, longest first, to the shard with
the least time so far, so the shards finish close together. Each shard
computes the split from the record it reads and the files it collects, without
talking to the others, so shards that read one record at one commit run every
file in exactly one shard. A Playwright setup or teardown project is the
exception: Playwright runs it in every shard that keeps a test depending on it.

Here is this repository's unit suite, 782 test files and 3,259 s of test time,
on four shards:

| Placed by | Shard 1 | Shard 2 | Shard 3 | Shard 4 |
|---|---|---|---|---|
| Vitest's `--shard`, by count | 196 files, 733 s | 196 files, 619 s | 196 files, 1,092 s | 194 files, 815 s |
| the time each file took | 195 files, 815 s | 196 files, 815 s | 195 files, 815 s | 196 files, 815 s |

By count, the four shards are 473 s apart, and the build waits for the slowest
one. The times are from the [execution record](execution-record.md) at commit
`789bdbddee97`, on one Apple M4 Pro, darwin/arm64. New here? Start with
[your first run](start.md).

## Turn it on in a Vitest, Jest or Playwright config

A config wrapped by `withTestSelection` already places `--shard`; there is
nothing else to set. [Cut a Vitest run down to a diff](../packages/sense/README.md#cut-a-vitest-run-down-to-a-diff)
and [Cut a Jest run down to a diff](../packages/sense/README.md#cut-a-jest-run-down-to-a-diff)
show the wrap. In Playwright, it is the same `withTestSelection`, from
[`@variance-authority/playwright-test`](../packages/playwright-test/README.md#place-a-shard-by-whole-files).
Run the shards as you do now:

```bash
npx vitest run --shard 3/4
```

Before the first file starts, the shard prints what it was given and which
record placed it:

```text
variance-authority: shard 3/4 by the times recorded at 789bdbddee97: 195 of 782 files, 814.8 s (shards 814.8 s to 814.8 s)
```

The times come from the record every run of the suite writes. On your machine
that is your checkout's own. A fresh CI checkout has none, so for its shards to
place by time, your mainline has to publish one:

1. On a push to your mainline, keep each shard's record as an artifact. A
   wrapped configuration writes it under
   `node_modules/.cache/variance-authority/test-selection/`, at
   `<repository>/suites/<name>/coverage.bin` for a
   [declared suite](execution-record.md#one-record-for-each-suite), or
   `<repository>/coverage.bin` when you declare none. `<repository>` is a
   digest of the checkout's absolute path, which is the same on every runner of
   one workflow; a job that checks out to another path looks under another
   name and finds nothing. Upload the `test-selection` directory whole, as
   [a suite with no run report](sharing.md#a-suite-with-no-run-report) does.
2. Fold them into one with
   [`variance journeys <shard>...`](../packages/cli/README.md#sharding-journeys-takes-more-than-one-file-too):
   the record one unsharded run would have written.
3. Publish it with `variance share --suite <name> --publish`, to the
   [share](sharing.md), the store CI keeps each run's record in.
   [A suite with no run report](sharing.md#a-suite-with-no-run-report) is that
   job, step by step.

Every later build that branches from that commit reads it, and its shard jobs
download nothing for it. A shard with no record of its own asks the share for
the mainline's record when it starts and keeps it under
`node_modules/.cache/variance-authority/share/read/<suite>/`. The asking is
done by `@variance-authority/cli`, so the project installs it, and the suite
needs `"carry": "share"` beside a `share` section in `variance.config.json`.
[A suite your checkout has not recorded](sharing.md#a-suite-your-checkout-has-not-recorded)
covers which record is read when. Until a record is published, the shards are
placed as [when nothing is recorded](#when-nothing-is-recorded) shows.

## When nothing is recorded

The first build of a suite has no times, and neither has a build whose share
holds no record of it. A record that is not there never fails a build:

- **The shard places by file count.** It prices every file the same, places
  them by the same rule, and prints why on its line:

  ```text
  variance-authority: shard 1/2 by file count: 2 of 3 files; no times at node_modules/.cache/variance-authority/test-selection/…/coverage.bin: nothing is recorded there
  ```

  No shard is left empty while there are as many files as shards.
- **A shard with no file passes.** With fewer files than shards, some shard
  takes none, and it passes under every runner. For Jest and Vitest,
  `withTestSelection` sets `passWithNoTests` when the command line has
  `--shard` and your configuration does not set it, so an unsharded run that
  finds no file still fails.
- **A shard that cannot read the record fails.** A share that does not answer,
  or a record that is there and does not read, stops the shard before any test
  runs, and the error names what failed. Another shard may have read it, and
  the two would place different files. Run the job again.
- **Shards that read different records split differently**, so a file can run
  in two shards or in none. Each shard asks the share when it starts, so a
  publish that lands between two shards' starts gives them two records. The
  line in each shard's log names what it read. On the push to your mainline,
  step 2's fold fails the build as unstable sharding and names both records.
  On a pull request, fetch the record once: in the job that plans the shards,
  `variance share --suite <name>` keeps it under
  `node_modules/.cache/variance-authority/share/`. Pass that directory to each
  shard as an artifact, and a shard at the same commit reads it without asking
  the share again.
- **`variance shards` answers one shard.** [Choose how many shards](#choose-how-many-shards)
  counts by the times, so with none it answers one and says so. Pass
  `--unrecorded <n>` to start `n` shards until there are times.

A test file the record has not seen yet, such as one added on your branch,
does not make the shard place by count. It is priced at the median of the files
the record has, so new files do not all land on one shard.

## Choose how many shards

`variance shards` reads the same record and answers how many shards to start.
It charges each shard the time it spends before its first test, so it stops
adding shards when one more saves less than it costs, or when one slow file
decides how long every shard takes. `--setup` is what one shard spends before its first test: checkout, install and
build, from your own CI's timings. Without it the count weighs no setup, so it
adds shards until the slowest file or `--max` stops it, and the answer says so.
`variance shards` exits 0 on every input it can read and refuses only a
malformed value, such as `--setup 1m`, so a plan job fails only on a typo.
`--workers` is how many test files one
shard's runner runs at once.

```bash
npx variance shards --suite unit --setup 90 --workers 8
```

```text
2 shards, the last done 335.2 s in: 90.0 s of setup and up to 1629.5 s of tests each, about 245.2 s on 8 workers.
From 782 test files, 3259.1 s in all, recorded at 789bdbddee97.
More shards finish no sooner: packages/sense/src/test-selection/journey-trace.integration.test.ts alone takes 245.2 s.
```

The count is the one that makes the build cheapest in wait plus setup: every
shard is charged its setup, so a shard is added only when it shortens the wait
by more than it spends. Two things end the count:

- **One file takes longer than a shard's share.** No shard finishes before its
  slowest file, and a file is never split. The answer names that file, and its
  slowest case when the record has its cases. Here one file takes 245.2 s, so a
  third shard would finish no sooner.
- **Setup costs more than one more shard saves.** The answer says what the next
  shard would save and what it would cost. On a later change that ran 85 of the
  suite's files, the answer was one shard:

  ```text
  One more would finish 124.0 s in: 25.3 s sooner, for 90.0 s more of setup.
  ```

`--budget <seconds>` asks a different question: the fewest shards whose last one
finishes within that time, setup included. `--max <n>` caps the count. A budget
no longer than `--setup` is out of reach at any count, since every shard spends
its setup before its first test: the answer is the count that finishes soonest,
and its last line names the setup as the reason. A budget the slowest file
outlasts is out of reach too: the answer is again the count that finishes
soonest, and it names that file.

### Start only what the change needs

On a pull request, a wrapped configuration can skip the test files the change
cannot affect: set `VARIANCE_AUTHORITY_SINCE` to the ref the change is measured
from, such as `origin/main`, and the run removes the files
[`variance select`](../packages/sense/README.md#let-the-runner-skip-them)
leaves out before any starts. Set at all, even empty, it selects. Each shard
then places only the files the change selects.

`variance shards` counts the same way with two flags:

- **`--since <ref>`** leaves out of the count the files the change lets the run
  skip, as the shards themselves leave them out.
- **`--collected <file>`** is the runner's own list of the suite's test files.
  The record holds only the files it has seen, so a test file the change adds
  is counted from the list, priced at the median, as the shards price it. List
  the suite alone: with several Vitest projects, pass `--project <name>` to
  `vitest list`, or every other suite's files are counted too.

With the list, a change that affects no test answers `0 shards`, and the build
starts none. Without it, only recorded files are counted, the answer says so,
and a change that skips every one of them still gets one shard, for whatever it
adds.

Keep both off the push to your mainline: that build runs the whole suite, so
its shards' records fold into the one the next build is placed by. A selected
shard's record does not fold with another's, so a pull request's shards record
for themselves, not for the share.

GitHub Actions can build a matrix from an earlier job's output, so the count is
decided per build. `--format json` gives a `matrix` of `k/n` strings, empty for
0:

```yaml
jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      shards: ${{ steps.count.outputs.shards }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: npm ci
      - id: count
        run: |
          set -o pipefail
          npx vitest list --filesOnly > "$RUNNER_TEMP/collected.txt"
          since=()
          if [ "$GITHUB_EVENT_NAME" = pull_request ]; then since=(--since origin/main --collected "$RUNNER_TEMP/collected.txt"); fi
          shards=$(npx variance shards --suite unit --setup 90 --workers 8 "${since[@]}" --format json | jq -c .matrix)
          echo "shards=$shards" >> "$GITHUB_OUTPUT"

  test:
    needs: plan
    if: needs.plan.outputs.shards != '[]'
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: ${{ fromJSON(needs.plan.outputs.shards) }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: npm ci
      - run: |
          if [ "$GITHUB_EVENT_NAME" = pull_request ]; then export VARIANCE_AUTHORITY_SINCE=origin/main; fi
          npx vitest run --shard ${{ matrix.shard }}
```

`VARIANCE_AUTHORITY_SINCE` is set only on a pull request, since setting it at
all selects.
[`shards`: how many CI jobs a suite is worth](../packages/cli/README.md#shards-how-many-ci-jobs-a-suite-is-worth)
lists every flag and the JSON.

## Every shard computes the same split

No shard tells another what to take. Each one computes the whole split from
three inputs and keeps its own part:

- **The files**: what the runner collected, after the change's selection. Shards
  that check out the same commit collect the same files.
- **The times**: the record they read. Shards of one build read the same one.
  Each shard's record names the record it read, and combining the shards'
  records fails the build when two of them name different ones, since a file
  may then have run in no shard. A JVM shard names the record it read
  `unknown`: Surefire or Gradle hands the agent the classes `variance select`
  chose, and the agent never sees which record that read. Combining checks no
  read of such a shard, and its output names the shard.
- **The number of shards**, from `--shard k/n`.

The same inputs give the same split on every machine. A file's time is what
running it cost, its environment, setup files and import before its first case
included, as the [execution record](execution-record.md) reads it: a file that
spends seconds importing weighs seconds, however quick its cases. Each file goes
in turn, longest first, to the shard with the least time so far; ties are broken by the
file's path, so nothing depends on the order a shard read its files in. With no
times, every file is priced the same, as
[when nothing is recorded](#when-nothing-is-recorded) shows. The runner's own
split never decides: it divides by count, and Playwright under `fullyParallel` divides by test, so one file's tests
would run in two shards.

A Playwright project that other projects name in `dependencies` or `teardown`
is not placed: Playwright runs it in every shard that keeps a test depending on
it, and gives a reporter no way to leave it out. `withTestSelection` records it
in each of those shards, so combining their records refuses it as a file two
shards ran, naming the file and both records.

Computing the whole split costs each shard less than a millisecond: 0.34 ms for
this repository's 782 files.

## When one shard still finishes last

The split is decided before any test runs, from times recorded earlier, and no
shard takes work from another. A shard finishes last for one of four reasons:

- **One file takes longer than an even share.** `variance shards` names it.
  Split it into smaller files.
- **The times are old.** A file that got slower since the record was published
  is still priced at what it took then. The shard's line names the commit the
  times belong to; a mainline that publishes on every push keeps them close.
- **The shard read no times.** Its line says `by file count`, and why;
  [when nothing is recorded](#when-nothing-is-recorded) covers that split.
- **The machine was slower or started later.** A runner that starts a minute
  late finishes a minute late. The split cannot know that.

## Split stories and routes the same way

`variance run` checks the stories of a Storybook, or the routes of an app, in a
browser ([your first run](start.md) sets one up). `variance run --shard k/n`
places them by the same rule: each
story file, and each route with all its widths, goes to one job, by the time it
took on the mainline's last run. A last job merges the shards' reports with
`variance report`, fails any story no shard observed, and publishes the times
the next build splits by. [A sharded build](sharing.md#a-sharded-build) covers
the merge job and what the publish writes, and
[Sharding: `report` takes more than one file](../packages/cli/README.md#sharding-report-takes-more-than-one-file)
covers the merge itself.
