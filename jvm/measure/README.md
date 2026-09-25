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
  the methods that class entered. It analyzes only the classes present in the
  exec, so a full Commons Lang record reads in about a second.
- `variance-mutate.jar`, a JavaParser tool with two commands. `members` writes
  the method and constructor spans of a source tree. `mutate` seeds faults on
  the lines you give it.

Next to JaCoCo, `variance-junit.jar` dumps and resets JaCoCo's store at each
test class boundary, one exec file per class. At the end of each class it logs
two conditions to `events.tsv`, because either can land work in a later class's
record:

- `survivor`: a thread the class started is still alive.
- `pool-busy`: the common pool is still busy.

## Runs

- `record-maven.sh` runs the suite once, in one of five modes:
  - `bare`: no agent.
  - `agent`: JaCoCo probes only.
  - `split`: JaCoCo plus the per-class dump.
  - `presence`: the agent's probes only.
  - `pressplit`: the agent plus one row per class.

  Extra Maven flags pass through. `-DreuseForks=false` records every test
  class in its own JVM.
- `compare-records.mjs` compares two records of one commit class by class, such
  as the suite against every class run alone. It names the methods and files
  each side lacks.
- `overhead-maven.sh` compiles once, then alternates the five modes over
  `surefire:test` alone. The cost it reports is against the test phase and
  nothing else.
- `replay-maven.sh` records a per-class run at each of the last N first-parent
  commits. It records under `split` by default, or under the agent with
  `pressplit` as its last argument.
- `score.mjs` selects from the parent's record against the child's diff. It
  scores that selection against the child's own record and failures, at six
  grains:
  - `method`
  - `shape`: `method`, plus every test that entered a file whose change falls
    outside any method body.
  - `line`
  - `file`
  - `record`: sense's selector over the parent's `coverage.va`.
  - `reach`: `variance reach`, the static walk.

  A test whose row lists an `unknown` class, or a class that failed to
  instrument, always runs.
- `mutants-maven.sh` seeds faults on each child's changed lines and runs the
  full suite per fault with no agent. `run-mutant.sh` runs one of them. The
  `m0` directory is the unmutated control.
- `score-mutants.mjs` scores the same selections against the test classes that
  kill each fault. That truth owes nothing to the recorder.

## Example

```bash
sh jvm/build.sh "$WORK"
sh jvm/measure/build.sh "$WORK"
sh jvm/measure/replay-maven.sh "$WORK" "$CLONE" lang 26 '' src/main/java target/classes
node jvm/measure/score.mjs "$WORK/replay/lang" "$REACH_CLONE" "$VARIANCE_BIN" "$WORK/bin/variance-agent.jar"
sh jvm/measure/mutants-maven.sh "$WORK" "$CLONE" "$WORK/replay/lang" "$WORK/mutants/lang" 4 4
node jvm/measure/score-mutants.mjs "$WORK/replay/lang" "$WORK/mutants/lang"
```

`mutants-maven.sh` adds git worktrees to `$CLONE` under the mutants directory.
When you are done, delete that directory, then run
`git -C "$CLONE" worktree prune`.
