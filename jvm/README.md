# Variance Authority for the JVM

A Java agent that records which methods each test entered, including methods
it reached in a service over HTTP, and writes that record in the format the
selector reads. When a diff changes a Java method, the tests that entered it
are the ones selected. That includes a Jest case or a browser spec that only
reached the method through a request.

The agent sets one flag per method, on entry, and writes no branch or line
probes. A recorded method carries every line it holds, so a selection at line
grain only widens. On Commons Lang, a full record with one row per test class
adds 1.5% to the test phase. JaCoCo, dumped per class, adds 5.6% before its
analysis runs.

## Build

```bash
sh jvm/build.sh
```

It compiles inside `maven:3.9-eclipse-temurin-21`, so Docker is the only thing
you need installed. It writes three jars to `jvm/dist/bin`:

- `variance-agent.jar` is the agent.
- `variance-agent-rt.jar` is the store it probes into. It goes on the boot
  class path, and a service compiles against it for `Journey`.
- `variance-junit.jar` splits the record at each top-level test class.

Pass a directory to build somewhere else.

## Record a JVM suite

Load the agent and the listener into the JVM that runs the tests:

```bash
-javaagent:variance-agent.jar=includes=org.example.* \
-javaagent:variance-junit.jar -Dva.out=target/va
```

`includes` is a colon-separated list of class-name globs, as JaCoCo's.
`sources` is a colon-separated list of source roots, relative to the working
directory. It defaults to `src/main/java:src/test/java:src/main/kotlin:src/test/kotlin`.
Keep `variance-agent-rt.jar` next to the agent jar.

Each top-level test class becomes one row of `record.jsonl` in `va.out`. When
the plan finishes, the agent writes the same record as `coverage.va`, which
`variance select` reads the way it reads `entries` coverage from a JS runner.

Each source file is a module. Each method a test entered is one region, spanning
its source from signature to closing brace, read with javac's tree API. Without a
compiler in the JDK, the region is cut from the method's line table instead. A
region that ended at its last statement would share that line with the region
around it, so an edit to it would charge the whole file. Some code charges an
enclosing region instead of its own:

- A lambda body, or a method that shares lines with the method around it,
  charges that method.
- Constructors and static initializers charge the file's root, because their
  line tables carry field initializers from anywhere in the class.
- A change outside every region charges every test that entered the file.

A class is named by the one file under the source roots that exists for its
package and `SourceFile` attribute, or else by the one file of that name under
them. A class that names no file or several is `unknown` in its row. A class that
fails to instrument is listed in every later row. A row that lists either cannot
exclude its test. A class without a `SourceFile` attribute, such as a proxy or a
class a test defines at runtime, is not probed: no source file can change it,
and the code that generates it is.

Surefire runs one class at a time per JVM, and that is what keeps each class's
work inside its row. `forkCount` above one adds JVMs, each with its own store,
so that parallelism is safe. Parallel classes inside one JVM are not.

To convert a record already on disk, run this from a checkout of the commit the
record was made at:

```bash
java -cp variance-agent.jar dev.varianceauthority.jvm.Coverage <record.jsonl> <out> [commit] [sources] [journeys.tsv]
```

## Record a service a Jest case calls

A Jest case that calls a service over HTTP runs code in another process, and
nothing in the case's own record says so. The service writes what it ran to
files, keyed by an id the case put on the request, and the Jest seam joins them
after the run.

In the service, wrap each request in a journey. Pass the request's `Cookie`
and `baggage` headers:

```java
import dev.varianceauthority.jvm.rt.Journey;

try (Journey journey = Journey.enter(cookie, baggage)) {
  // handle the request
}
```

The journey is the `variance-authority-journey` member of either header. When
the two disagree, the request is charged to no journey.

In the case, put the journey on the request yourself:

```ts
import { journeyCookie } from '@variance-authority/sense/case-journey';

await fetch(`${service}/api/cart`, { headers: { cookie: journeyCookie() } });
```

Start the service with the agent and a parts directory, as `-Dva.parts=<dir>` or
the `VARIANCE_AUTHORITY_PARTS` variable. Give Jest's `withJourneyCoverage` the
same directory in `parts`. When the JVM exits, the agent writes two files
there:

- `jvm-<pid>-<uuid>.vac` holds one frame per journey, plus one frame, with no
  journey, for what ran between journeys.
- `jvm-<pid>-<uuid>.rec` holds the regions those frames name, cut as `Coverage`
  cuts them.

Stop the service before Jest's journey file is finalized. The fold then charges
each journey's frame to the case that minted it, and the between frame to every
case that crossed into this process. Files are named relative to the nearest
directory above the working directory that holds `.git`, so they match the names
Jest records.

To convert a record already on disk:

```bash
java -cp variance-agent.jar dev.varianceauthority.jvm.Parts <record.jsonl> <dir>
```

Every journey's enter and close ends a window. The methods drained in a window
go to each journey that was open during it. So two journeys in flight at once
share their windows, and each one's row gains what the other ran. That widens
selection and never drops a method a journey ran. Work that outlives its request
lands in whichever window drains it.

## Record a service browser specs drive

When the tests are browser specs that no JS record can join, the driver keeps a
table instead, `journeys.tsv`, of `<journey>\t<spec file>`. Pass it to
`Coverage` as its last argument. Each journey row goes to its spec, and each
between row goes to every spec. `Coverage` fails when the table is not empty and
the service recorded none of its journeys: a service that was never watched
looks the same as one that ran nothing.

## Tests

`jvm/test/shop` is a small Java HTTP service with a static frontend, Jest cases
that call its API, and Playwright specs that drive it through a browser. Nothing
in the cases or the specs imports the service, so no import graph reaches a Java
file from a test.

```bash
node jvm/test/parts.mjs "$WORK/parts" jvm/dist/bin
node jvm/test/journey.mjs "$WORK/journey" jvm/dist/bin "$VARIANCE_BIN"
```

`parts.mjs` runs the shop under the agent with a parts directory, runs Jest in
band against it, stops the JVM, and then finalizes Jest's journey file. It
checks four things:

- A method that one case's request ran is charged to that case alone.
- The readiness probe and the JVM's startup are charged to both cases that
  crossed.
- A case that never called the shop is absent.
- A change to a Java line selects the Jest file that reached it.

It runs in band so that the first check can be exact.

`journey.mjs` seeds six backend changes. It scores the service's `coverage.va`
and `variance reach` against the specs that fail on each change. From the
record, no failing change escapes, and 9 of 18 spec runs are selected. `reach`
selects no spec, so all 4 breaking changes escape.

## Measurements

[`measure/`](measure/README.md) replays a Maven project's history under this
agent and under JaCoCo. It scores each selection against the next commit's own
record and against faults seeded on the changed lines.
