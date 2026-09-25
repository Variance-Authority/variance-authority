# JVM coverage selection, Phase 0

This harness answers one question before any JVM recorder ships: if you record which methods each test class enters, and select on the next commit's diff, which failing tests do you leave out?

It runs a Maven project's own suite in Docker, under JaCoCo or under the presence agent, one record row per test class, and replays that record across real history. Nothing here is imported by a package, and every output lands in a work directory you name, never in the repository.

## Pieces

- `listener/` is a JUnit Platform listener, loaded as a Java agent next to JaCoCo, that dumps and resets the JaCoCo store at each test class boundary. At each class end it logs, to `events.tsv`, any thread the class started that is still alive (`survivor`) and a busy common pool (`pool-busy`): work that could land in a later class's record.
- `analyze/` turns each exec file into the methods that class entered. It analyzes only the classes present in each exec, so a full Commons Lang record reads in about a second.
- `mutate/` holds `JavaTools`, a JavaParser tool with two commands. `members` writes the method and constructor spans of a source tree. `mutate` seeds faults on the given changed lines.
- `presence/` is our own recorder, a Java agent that replaces JaCoCo. It sets one flag per method on entry, from a fixed `boolean[]` on the boot class path, and writes no branch or line probes. A recorded method carries every line it holds, so a line-grain selection only widens. With the listener beside it, each test class becomes one `record.jsonl` row directly, with no exec file and no analyze step. Synthetic methods other than lambda bodies are not probed. A class is named by the one file that exists as `<root>/<package>/<SourceFile>` under the `sources` roots (default `src/main/java:src/test/java:src/main/kotlin:src/test/kotlin`), or else by the one file of that name under them. A class that names no file or several is `unknown` in the row, and a class that fails to instrument is listed in every later row; `score.mjs` runs a test whose row lists either. A class without a `SourceFile` attribute, such as a proxy or a class a test defines at runtime, is not probed. On Commons Lang a full per-class record adds 1.5% to the test phase, where JaCoCo with the dump adds 5.6% before analysis.
  When the plan finishes, the agent's `Coverage` writes the same record as `coverage.va`, sense's execution record at function grain, so the product selector reads it as it reads `entries` coverage in JS. Each file gets a module root and one region per method a test entered. The region spans the method's source from signature to closing brace, read with javac's tree API. Without a compiler in the JDK, it falls back to the method's line table. Sense shares a region's first and last lines with the region around it, so a region that ends at its last statement would charge the whole file for an edit to that statement. Lambda bodies, and methods that share lines with the method around them, charge that method. Constructors and static initializers charge the root, because their line tables carry field initializers from anywhere in the class. A change outside every region charges every test that entered the file. `java -cp va-presence.jar va.presence.Coverage <record.jsonl> <out> [commit] [sources] [journeys.tsv]` writes it for a record already on disk, run from a checkout of the commit the record was made at.
  A service records per journey instead of per test class. Its request filter wraps each request in `try (Journey journey = Journey.enter(cookie, baggage)) { … }`, passing the `Cookie` and `baggage` headers. The journey is the `variance-authority-journey` member of either header. When the two disagree, the request is unattributed. Every enter and close ends a window. The methods drained in a window go to each journey open during it, as a `journey:<id>` row. A window where no journey was open, or where a request without one was open, becomes a `between-journey-<n>` row. With `journeys.tsv`, the driver's `<journey>\t<subject file>` table, `Coverage` gives each journey row to its subject and each between row to every subject. It fails when the table is non-empty but the service recorded none of its journeys, because a service that was never watched looks the same as one that ran nothing. Two journeys in flight at once share their windows, which widens selection. Work that outlives its request lands in whichever window drains it.
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
  - `record`: sense's selector over the parent's `coverage.va`
  - `reach`: `variance reach`, the static fallback
- `mutants-maven.sh` seeds faults on each child's changed lines and runs the full suite per fault with no agent. `run-mutant.sh` runs one of them. The `m0` directory is the unmutated control.
- `score-mutants.mjs` scores the same selections against the test classes that kill each fault. That truth owes nothing to the recorder.
- `journey.mjs` asks which browser specs a backend change can break. `journey/shop` is a Java HTTP service with a static frontend and Playwright specs that only drive the browser. Nothing in the specs imports the service, so relations have no path from a Java file to a spec. Each spec mints a journey cookie and appends it to the driver's table. The harness runs the service under the agent, seeds six backend changes, and scores two selections, `record` (sense over the service's `coverage.va`) and `reach`, against the specs that fail on each change. On the shop, `record` lets no failing change escape and selects 9 of 18 spec runs. The home page spec is never selected for an API change. `reach` selects no spec, so all 4 breaking changes escape.

## Example

```bash
sh tools/jvm-phase0/build.sh "$WORK"
sh tools/jvm-phase0/replay-maven.sh "$WORK" "$CLONE" lang 26 '' src/main/java target/classes
node tools/jvm-phase0/score.mjs "$WORK/replay/lang" "$REACH_CLONE" "$VARIANCE_BIN" "$WORK/bin/va-presence.jar"
sh tools/jvm-phase0/mutants-maven.sh "$WORK" "$CLONE" "$WORK/replay/lang" "$WORK/mutants/lang" 4 4
node tools/jvm-phase0/score-mutants.mjs "$WORK/replay/lang" "$WORK/mutants/lang"
node tools/jvm-phase0/journey.mjs "$WORK/journey" "$WORK/bin" "$VARIANCE_BIN"
```

`mutants-maven.sh` adds git worktrees to `$CLONE` under the mutants directory. When you are done, remove them with `git -C "$CLONE" worktree prune` after you delete that directory.
