# Variance Authority for the JVM

A Java agent that records which methods each test entered, so that a change to
a Java method runs only the tests that reached it. A test here is a JUnit test
class, or a Jest case or browser spec that reached the method in a service over
HTTP. The record is one row per test, and the selector answers a diff from it
without an import graph, which a request to another process never shows.

The agent sets one flag per method, on entry, and writes no branch or line
probes. A recorded method carries every line it holds, so a selection at line
grain only widens. On Commons Lang, whose bare test phase takes about 130 s, a
full record with one row per test class adds 1.5% to that phase. JaCoCo, dumped
per class, adds 5.6% before its analysis runs. Both are medians of three
interleaved runs of [`measure/overhead-maven.sh`](measure/overhead-maven.sh).

## Get the jars

There is no published artifact. Build the jars from this checkout:

```bash
sh jvm/build.sh
```

It compiles inside `maven:3.9-eclipse-temurin-21` for Java 8 and later, so
Docker is the only thing you need installed. It writes three jars to
`jvm/dist/bin`, or to `<dir>/bin` when you pass a directory:

- `variance-agent.jar` is the agent.
- `variance-agent-rt.jar` is the store it probes into. The agent puts it on the
  boot class path, and a service compiles against it for `Journey`. Keep it next
  to the agent jar.
- `variance-junit.jar` is a JUnit Platform listener that starts a new row at each
  top-level test class. It is loaded as a second `-javaagent` so that it lands on
  the system class path, where the launcher finds it.

## Record a JVM suite

The suite must run on the JUnit Platform: Jupiter, or JUnit 4 through the
Vintage engine. With Maven Surefire:

```xml
<plugin>
  <artifactId>maven-surefire-plugin</artifactId>
  <configuration>
    <argLine>-javaagent:${va.bin}/variance-agent.jar -javaagent:${va.bin}/variance-junit.jar -Dva.out=${project.build.directory}/va</argLine>
  </configuration>
</plugin>
```

Set `va.bin` to the directory holding the jars. If the pom already sets
`argLine`, for JaCoCo or for heap flags, append these flags to it rather than
replacing it. With Gradle:

```kotlin
tasks.test {
  useJUnitPlatform()
  val va = file("/path/to/jvm/dist/bin")
  jvmArgs(
    "-javaagent:$va/variance-agent.jar",
    "-javaagent:$va/variance-junit.jar",
    "-Dva.out=${layout.buildDirectory.dir("va").get().asFile}",
  )
}
```

Each top-level test class becomes one row of `record.jsonl` in `va.out`. When
the test plan finishes, the listener writes the same record as `coverage.va`.

Each test JVM keeps its own rows under `va.out/records` and, when its plan
finishes, merges every finished JVM's rows into `record.jsonl`. Forks that share
a `va.out` merge in turn, so the last one to finish writes the whole suite. A
rerun replaces the rows of the classes it ran and keeps the rest, so
`-Dtest=AddTest` leaves the other classes' rows in place. A row that read a file
whose text has changed since is dropped, and its class runs until it is recorded
again.

| Setting | Where | Default | |
| --- | --- | --- | --- |
| `includes` | agent option | the checkout's own classes | Colon-separated class-name globs, with `*` and `?`, as JaCoCo's. |
| `sources` | agent option | `src/main/java:src/test/java:src/main/kotlin:src/test/kotlin` | Colon-separated source roots, relative to the test JVM's working directory. |
| `va.out` | system property | `va-exec` | Where `record.jsonl`, `coverage.va` and `events.tsv` go. |
| `va.commit` | system property | none | The commit `coverage.va` names as its baseline. |
| `va.parts` | system property | `VARIANCE_AUTHORITY_PARTS` | A service's parts directory. See below. |
| `va.presence.capacity` | system property | 4,194,304 | How many methods the store can flag. |

Agent options are comma-separated after the `=`, as in
`includes=com.acme.*,sources=src/main/java:src/test/java`. Any other option
fails the JVM at startup.

Without `includes`, the agent probes the classes that load from inside the
checkout, such as a module's `target/classes`, and nothing from the Maven or
Gradle cache or the JDK. A diff of the checkout cannot change a dependency, so
probing one could only mark rows `unknown`. Name `includes` when your own
classes load from outside the checkout.

### What a row holds

Each source file is a module. Each method a test entered is one region: the span
of source from its signature to its closing brace, read with javac's tree API.
Without a compiler in the JDK, the region is cut from the method's line table
instead. A region that ended at its last statement would share that line with
the region around it, so an edit to it would charge the whole file. Some code
charges an enclosing region instead of its own:

- A lambda body, or a method that shares lines with the method around it,
  charges that method.
- Constructors and static initializers charge the file's root, because their
  line tables carry field initializers from anywhere in the class.
- A change outside every region charges every test that entered the file.

A class is named by the one file under the source roots that exists for its
package and `SourceFile` attribute, or else by the one file of that name under
them. A class that names no file, or several, is `unknown` in its row. A class
that fails to instrument is listed in every later row. A row that lists either
one cannot exclude its test. A class without a `SourceFile` attribute, such as a
proxy or a class a test defines at runtime, is not probed: no source file can
change it, and the code that generates it can.

Work is charged to a row by time: whatever the store flagged between one test
class's start and the next is that class's. Surefire and Gradle run one class
at a time per JVM, and that keeps each class's work inside its row. Parallel
classes inside one JVM share their flags, so record with JUnit's parallel
execution off. Parallel forks are fine, since each fork is a JVM of its own.

At each class boundary the listener logs to `events.tsv` whether a thread the
class started is still alive (`survivor`) or the common pool is still busy
(`pool-busy`). Either one can land that class's work in the next class's row.

### Select from the record

Name `coverage.va` with `--execution`:

```bash
yarn exec variance select --execution target/va/coverage.va
```

It prints the test files the change since the record's commit (`va.commit`)
cannot reach, one per line: those are the ones you may skip. Tests are named by
their source file, such as `src/test/java/org/example/AddTest.java`. A test file
that is not in the record is never printed, so it runs. A record made without
`va.commit` names no commit to diff from, so pass `--since <ref>`, or hand the
change in with `--diff <patch>` (`-` reads stdin).

From a script, `narrowByExecution('target/va/coverage.va', diff)` from
`@variance-authority/sense/test-selection` returns `whole`, every test file in
the record, and `entered`, the ones the diff reaches.

Paths in `coverage.va` are relative to the checkout, whichever module ran, so
they match a diff taken at its root.

To convert a record already on disk, run this from the directory the suite ran
in, at the commit the record was made at:

```bash
java -cp variance-agent.jar dev.varianceauthority.jvm.Coverage <record.jsonl> <out> [commit] [sources] [journeys.tsv]
```

## Record a service a Jest case calls

A Jest case that calls a service over HTTP runs code in another process, and
nothing in the case's own record says so. To join the two, every request
carries the case's journey, an opaque id the Jest seam mints per case. The
service writes what it ran under each journey to files in a parts directory.
After the run, the fold, `variance journeys finalize`, joins those parts to the
cases in Jest's journey file.

### In the service

Put `variance-agent-rt.jar` on the service's compile and run class path. Without
the agent, `Journey.enter` returns a scope that does nothing. Wrap each request
in a journey, passing the request's `Cookie` and `baggage` headers, either of
which may be null:

```java
import dev.varianceauthority.jvm.rt.Journey;

try (Journey journey = Journey.enter(cookie, baggage)) {
  // handle the request
}
```

The journey is the `variance-authority-journey` member of either header. When
both headers carry one and they disagree, the request is handled as though it
carried none, and what it ran is charged the way work between journeys is.

Start the service with the agent and a parts directory:

```bash
java -javaagent:/path/to/variance-agent.jar=includes=com.acme.* \
  -Dva.parts=/abs/path/parts -jar service.jar
```

A jar that bundles its dependencies loads them from inside the checkout too, so
name your own packages in `includes` there.

`VARIANCE_AUTHORITY_PARTS` works in place of `-Dva.parts`. Start it from its
module directory inside the checkout, because the `sources` roots are relative
to that directory. Files are named relative to the nearest directory above it
that holds `.git`, so they match the names Jest records, and in a container that
means mounting the checkout rather than only the module.

When the JVM exits, the agent writes two files to the parts directory:

- `<head>-<uuid>.vac` holds one frame per journey, plus one frame, with no
  journey, for what ran between journeys.
- `<head>-<uuid>.rec` holds the regions those frames name, cut as `Coverage`
  cuts them.

The service must exit through its shutdown hooks, on `SIGTERM` or
`System.exit`. A `SIGKILL` writes nothing.

`<head>` is `VARIANCE_AUTHORITY_HEAD` when the service's environment sets it, and
`jvm` otherwise. `variance journeys finalize` compares the heads that wrote parts
with the run before, so give each service its own.

### In the Jest suite

Put the journey on each request. `journeyCookie()` returns
`variance-authority-journey=<id>` inside a case and `''` outside one. Join it to
any cookie the request already sends:

```ts
import { journeyCookie } from '@variance-authority/sense/case-journey';

await fetch(`${service}/api/cart`, { headers: { cookie: journeyCookie() } });
```

Give `withJourneyCoverage` the same parts directory:

```js
// jest.config.mjs
import { withJourneyCoverage } from '@variance-authority/sense/jest';

export default withJourneyCoverage(config, {
  journeyFile: '.variance-authority/journeys.bin',
  parts: ['/abs/path/parts'],
});
```

Run Jest, stop the service, and then fold and select:

```bash
yarn exec variance journeys finalize .variance-authority/journeys.bin
git diff origin/main | yarn exec variance select --execution .variance-authority/journeys.bin --diff -
```

The fold charges each journey's frame to the case that minted it. It charges
the between frame, which holds the service's startup and anything no journey
claimed, to every case that sent this process at least one request.

A class that is `unknown` goes into its journey's frame by class name, with no
regions. No record holds that name, so `journeys finalize` lists it among the
modules cases ran that no record holds: a change to it selects nothing, and the
finalize tells you which classes those are.

To convert a record already on disk:

```bash
java -cp variance-agent.jar dev.varianceauthority.jvm.Parts <record.jsonl> <dir>
```

### Concurrent requests

Each journey's enter and close ends a window. The methods drained in a window
go to each journey that was open during it. So two journeys in flight at once
share their windows, and each one's row gains what the other ran. That widens
selection and never drops a method a journey ran. Work that outlives its request
lands in whichever window drains it.

## Record a service browser specs drive

When the tests are browser specs that no JS record can join, the driver sets
the journey cookie itself and keeps a table, `journeys.tsv`, of
`<journey>\t<spec file>`. Record the service with `-Dva.out` instead of a parts
directory, and pass the table to `Coverage` as its last argument. Each journey
row goes to its spec, and each between row goes to every spec. `Coverage` fails
when the table is not empty and the service recorded none of its journeys: a
service that was never watched looks the same as one that ran nothing.

## Tests

`jvm/test/shop` is a small Java HTTP service with a static frontend, Jest cases
that call its API, and Playwright specs that drive it through a browser. Nothing
in the cases or the specs imports the service, so no import graph reaches a Java
file from a test.

`jvm/test/modules` is a two-module Maven build with no `includes`, whose `calc`
module runs each test class in a JVM of its own, two at a time, into one
`va.out`.

```bash
node jvm/test/record.mjs "$WORK/record" jvm/dist/bin
node jvm/test/parts.mjs "$WORK/parts" jvm/dist/bin
node jvm/test/journey.mjs "$WORK/journey" jvm/dist/bin packages/cli/dist/bin.js
```

All three need Docker and a built checkout (`yarn build`). `journey.mjs` also
needs Playwright's Chromium.

`record.mjs` records the build fresh, again, with `-Dtest=AddTest`, and after an
edit to a test file. It checks that:

- `coverage.va` names files relative to the checkout, so a diff at its root
  selects from either module's record.
- No row names an `unknown` class, so every test is eligible to skip.
- Every fork's classes are in the record once.
- A rerun replaces rows, and `-Dtest=` keeps the rows of the classes it did not
  run.
- An edit retires the rows of the class whose record read the edited file.

`parts.mjs` runs the shop under the agent with a parts directory, runs Jest in
band against it, stops the JVM, and then finalizes Jest's journey file. It
moves `Cart.java` out of the declared sources before it compiles, and it checks
that:

- A method that one case's request ran is charged to that case alone.
- The readiness probe and the JVM's startup are charged to both cases that
  crossed.
- A case that never called the shop is absent.
- A change to a Java line selects the Jest file that reached it.
- The finalize names `shop.Cart`, compiled from outside the sources, as a
  module no record holds.

It runs in band so that the first check can be exact.

`journey.mjs` seeds six backend changes. It scores the service's `coverage.va`
and `variance reach` against the specs that fail on each change. From the
record, no failing change escapes, and 9 of 18 spec runs are selected. `reach`
selects no spec, so all 4 breaking changes escape.

## Measurements

[`measure/`](measure/README.md) replays a Maven project's history under this
agent and under JaCoCo. It scores each selection against the next commit's own
record and against faults seeded on the changed lines.
