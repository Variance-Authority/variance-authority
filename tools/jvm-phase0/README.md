# JVM coverage selection, Phase 0

This harness answers one question before any JVM recorder ships: if you record which methods each test class enters, and select on the next commit's diff, which failing tests do you leave out?

It runs a Maven project's own suite in Docker, under JaCoCo or under the presence agent, one record row per test class, and replays that record across real history. Nothing here is imported by a package, and every output lands in a work directory you name, never in the repository.

## Pieces

- `listener/` is a JUnit Platform listener, loaded as a Java agent next to JaCoCo, that dumps and resets the JaCoCo store at each test class boundary. At each class end it logs, to `events.tsv`, any thread the class started that is still alive (`survivor`) and a busy common pool (`pool-busy`): work that could land in a later class's record.
- `analyze/` turns each exec file into the methods that class entered. It analyzes only the classes present in each exec, so a full Commons Lang record reads in about a second.
- `mutate/` holds `JavaTools`, a JavaParser tool with two commands. `members` writes the method and constructor spans of a source tree. `mutate` seeds faults on the given changed lines.
- `presence/` is our own recorder, a Java agent that replaces JaCoCo. It sets one flag per method on entry, from a fixed `boolean[]` on the boot class path, and writes no branch or line probes. A recorded method carries every line it holds, so a line-grain selection only widens. With the listener beside it, each test class becomes one `record.jsonl` row directly, with no exec file and no analyze step. Synthetic methods other than lambda bodies are not probed. A class is named by the one file that exists as `<root>/<package>/<SourceFile>` under the `sources` roots (default `src/main/java:src/test/java:src/main/kotlin:src/test/kotlin`), or else by the one file of that name under them. A class that names no file or several is `unknown` in the row, and a class that fails to instrument is listed in every later row; `score.mjs` runs a test whose row lists either. A class without a `SourceFile` attribute, such as a proxy or a class a test defines at runtime, is not probed. On Commons Lang a full per-class record adds 1.5% to the test phase, where JaCoCo with the dump adds 5.6% before analysis.
- `build.sh` compiles all four inside `maven:3.9-eclipse-temurin-21`.

## Runs

- `record-maven.sh` runs the suite once, as `bare`, `agent` (JaCoCo probes only), `split` (JaCoCo plus the per-class dump), `presence` (presence probes only) or `pressplit` (presence plus the per-class rows). Extra Maven flags pass through: `-DreuseForks=false` records every test class in its own JVM.
- `compare-records.mjs` compares two records of one commit class by class, such as the suite against every class alone, and names the methods and files each side lacks.
- `overhead-maven.sh` compiles once, then alternates the five modes over `surefire:test` alone, so recording cost is measured against the test phase and nothing else.
- `replay-maven.sh` records a per-class run at each of the last N first-parent commits, under `split` or, with `pressplit` as its last argument, the presence agent.
- `score.mjs` selects from the parent's record against the child's diff, then scores that selection against the child's own record and failures. It scores six grains:
  - `method`
  - `shape`: method, plus every test that entered a file whose change falls outside any method body
  - `line`
  - `file`
  - `record`: the product selector over the record. `coverage.mjs` converts it into sense's execution record at function grain, so the record reads as `entries` coverage does in JS: a module root per file and one region per method a test entered, spanning its line table. Lambda bodies, and methods that share lines with the method around them, charge that method. Constructors and static initializers charge the root, because their line tables carry field initializers from anywhere in the class. A change outside every region charges every test that entered the file. `score.mjs` writes the converted record beside the parent's as `coverage.va`.
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
