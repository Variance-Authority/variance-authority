# Measuring JVM selection

If you record which methods each test class enters and select on the next
commit's diff, which failing tests do you leave out, and what does the
recording cost? These scripts answer both questions on a real Maven project.
They run its suite in Docker under the agent or under JaCoCo, then replay that
record across the project's history. Every output lands in a work directory you
name, never in the repository.

## Build

```bash
sh jvm/build.sh "$WORK"
sh jvm/measure/build.sh "$WORK"
```

The first command builds the agent. The second adds what the measurements
compare it with, and writes it to the same `bin`:

- The JaCoCo agent, with `variance-analyze.jar`. It turns each exec file into
  the methods that class entered, and it analyzes only the classes present in
  the exec.
- `variance-mutate.jar`, a JavaParser tool with two commands. `members` writes
  the method and constructor spans of a source tree. `mutate` seeds faults on
  the lines you give it.

Under either recorder, `variance-junit.jar` closes a row at each test class
boundary. Under JaCoCo, it does that by dumping and resetting JaCoCo's store,
one exec file per class. At the end of each class it logs two conditions to
`events.tsv`, because either one can land work in a later class's row:

- `survivor`: a thread the class started is still alive.
- `pool-busy`: the common pool is still busy.

## Before the first run

Every Maven run is offline (`-o`) against `$WORK/m2`, so that timings measure
the tests rather than the network. Prime that repository by running the suite
online once in the same image, at the oldest and the newest commit you will
replay:

```bash
docker run --rm -v "$WORK/m2:/root/.m2" -v "$CLONE:/repo" -w /repo \
  maven:3.9-eclipse-temurin-21 mvn -B -q test
```

An unprimed dependency shows up as `FAILED` in the run's output, and that
commit has no record.

The scripts reach Surefire through `-DagentArgs`. That works because Commons
Lang's `argLine` interpolates `${agentArgs}`. For another project, add
`${agentArgs}` to its Surefire `argLine` first, or the suite runs with no
recorder and every row comes out empty.

`replay-maven.sh` and `score.mjs` check out commits in the clones you give
them, and `mutants-maven.sh` adds worktrees to `$CLONE`. Give them clones that
you keep for this, not your working checkout. `replay-maven.sh` reverses the
commit list with BSD `tail -r`, so it runs on a macOS host.

## Runs

- `record-maven.sh <work> <repo> <mode> <out> [includes] [maven flags]` runs the
  suite once, in one of five modes:
  - `bare`: no agent.
  - `agent`: JaCoCo probes only.
  - `split`: JaCoCo plus the per-class dump.
  - `presence`: the agent's probes only.
  - `pressplit`: the agent plus one row per class, written as `record.jsonl`
    with no analysis step.

  `includes` defaults to `*`, and an empty string means `*` too. Under the
  agent, `*` makes every row name Surefire's classes as `unknown`, and such a
  row never excludes its test. So pass the project's own packages, such as
  `'org.apache.commons.lang3.*'`. Extra Maven flags pass through:
  `-DreuseForks=false` records every test class in its own JVM.
- `compare-records.mjs <ref> <other> [out.json]` compares two records of one
  commit class by class, such as the suite against every class run alone. It
  names the methods and files each side lacks.
- `overhead-maven.sh <work> <repo> <includes> <rounds> <out>` compiles once,
  then alternates the five modes over `surefire:test` alone, for the number of
  rounds you give. The cost it reports is against the test phase and nothing
  else.
- `replay-maven.sh <work> <repo> <name> <N> <includes> <source root> <classes dir> [split|pressplit]`
  records a per-class run at each of the last N first-parent commits into
  `$WORK/replay/<name>`. It records under `split` by default, or under the agent
  with `pressplit`.
- `mutants-maven.sh <work> <repo> <replay> <out> <max per file> <parallel>`
  seeds faults on each child's changed lines and runs the full suite per fault
  with no agent. `run-mutant.sh` runs one of them. The `m0` directory is the
  unmutated control. It also writes each child's `members.json`, the method
  spans that the `shape` grain in `score.mjs` reads, so run it before scoring.
- `score.mjs <replay> <reach clone> <variance bin> <agent jar> [test root]`
  selects from the parent's record against the child's diff. It scores that
  selection against the child's own record and failures, at six grains:
  - `method`
  - `shape`: `method`, plus every test that entered a file whose change falls
    outside any method body.
  - `line`
  - `file`
  - `record`: sense's selector over the parent's `coverage.va`.
  - `reach`: `variance reach`, the static walk.

  A test whose row lists an `unknown` class, or a class that failed to
  instrument, always runs.
- `score-mutants.mjs <replay> <mutants>` scores the same selections against the
  test classes that kill each fault. That truth owes nothing to the recorder.

## Example

`$CLONE` and `$REACH_CLONE` are two clones of Commons Lang. `$VARIANCE_BIN` is
`packages/cli/dist/bin.js` in a built checkout of this repository.

```bash
sh jvm/build.sh "$WORK"
sh jvm/measure/build.sh "$WORK"
sh jvm/measure/replay-maven.sh "$WORK" "$CLONE" lang 26 'org.apache.commons.lang3.*' src/main/java target/classes pressplit
sh jvm/measure/mutants-maven.sh "$WORK" "$CLONE" "$WORK/replay/lang" "$WORK/mutants/lang" 4 4
node jvm/measure/score.mjs "$WORK/replay/lang" "$REACH_CLONE" "$VARIANCE_BIN" "$WORK/bin/variance-agent.jar"
node jvm/measure/score-mutants.mjs "$WORK/replay/lang" "$WORK/mutants/lang"
```

Drop `pressplit` to replay under JaCoCo instead.

When you are done, delete the mutants directory, then run
`git -C "$CLONE" worktree prune`.
