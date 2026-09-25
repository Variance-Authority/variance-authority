# JVM coverage selection, Phase 0

This harness answers one question before any JVM recorder ships: if you record which methods each test class enters, and select on the next commit's diff, which failing tests do you leave out?

It runs a Maven project's own suite under JaCoCo in Docker, one exec file per test class, and replays that record across real history. Nothing here is imported by a package, and every output lands in a work directory you name, never in the repository.

## Pieces

- `listener/` is a JUnit Platform listener, loaded as a Java agent next to JaCoCo, that dumps and resets the JaCoCo store at each test class boundary. At each class end it logs, to `events.tsv`, any thread the class started that is still alive (`survivor`) and a busy common pool (`pool-busy`): work that could land in a later class's record.
- `analyze/` turns each exec file into the methods that class entered. It analyzes only the classes present in each exec, so a full Commons Lang record reads in about a second.
- `mutate/` holds `JavaTools`, a JavaParser tool with two commands. `members` writes the method and constructor spans of a source tree. `mutate` seeds faults on the given changed lines.
- `build.sh` compiles all three inside `maven:3.9-eclipse-temurin-21`.

## Runs

- `record-maven.sh` runs the suite once, as `bare`, `agent` (probes only) or `split` (probes plus the per-class dump). Extra Maven flags pass through: `-DreuseForks=false` records every test class in its own JVM.
- `compare-records.mjs` compares two records of one commit class by class, such as the suite against every class alone, and names the methods and files each side lacks.
- `overhead-maven.sh` compiles once, then alternates the three modes over `surefire:test` alone, so recording cost is measured against the test phase and nothing else.
- `replay-maven.sh` records a split run at each of the last N first-parent commits.
- `score.mjs` selects from the parent's record against the child's diff, then scores that selection against the child's own record and failures. It scores five grains:
  - `method`
  - `shape`: method, plus every test that entered a file whose change falls outside any method body
  - `line`
  - `file`
  - `reach`: `variance reach`, the static fallback
- `mutants-maven.sh` seeds faults on each child's changed lines and runs the full suite per fault with no agent. `run-mutant.sh` runs one of them. The `m0` directory is the unmutated control.
- `score-mutants.mjs` scores the same selections against the test classes that kill each fault. That truth owes nothing to the recorder.

## Example

```bash
sh tools/jvm-phase0/build.sh "$WORK"
sh tools/jvm-phase0/replay-maven.sh "$WORK" "$CLONE" lang 26 '' src/main/java target/classes
node tools/jvm-phase0/score.mjs "$WORK/replay/lang" "$REACH_CLONE" "$VARIANCE_BIN"
sh tools/jvm-phase0/mutants-maven.sh "$WORK" "$CLONE" "$WORK/replay/lang" "$WORK/mutants/lang" 4 4
node tools/jvm-phase0/score-mutants.mjs "$WORK/replay/lang" "$WORK/mutants/lang"
```

`mutants-maven.sh` adds git worktrees to `$CLONE` under the mutants directory. When you are done, remove them with `git -C "$CLONE" worktree prune` after you delete that directory.
