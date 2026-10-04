# Select Java tests from the methods each one ran

A Java agent records which methods each test entered, so a change to a Java
method runs only the tests that reached it. A test is a JUnit test class, or a
Jest case or browser spec that reached the method in a service over HTTP. The
record is one row per test, and `variance select` answers a diff from it without
an import graph, which a request to another process never shows.

The agent sets one flag per method, on entry, and writes no branch or line
probes. A recorded method carries every line it holds, so a selection at line
grain only widens. On Commons Lang, whose bare test phase takes about 130 s, a
full record with one row per test class adds 1.5% to that phase. JaCoCo, dumped
per class, adds 5.6% before its analysis runs. Both are medians of three
interleaved runs.

## Get the jars

Build the jars from a checkout of this repository:

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
  top-level test class. Load it as a second `-javaagent` so that it lands on the
  system class path, where the launcher finds it.

## Record a JVM suite

Your suite runs on the JUnit Platform: Jupiter, or JUnit 4 through the Vintage
engine. With Maven Surefire:

```xml
<plugin>
  <artifactId>maven-surefire-plugin</artifactId>
  <configuration>
    <argLine>-javaagent:${va.bin}/variance-agent.jar -javaagent:${va.bin}/variance-junit.jar -Dva.suite=unit</argLine>
  </configuration>
</plugin>
```

Set `va.bin` to the directory holding the jars. If your pom already sets
`argLine`, for JaCoCo or for heap flags, append these flags to it rather than
replacing it. With Gradle:

```kotlin
tasks.test {
  useJUnitPlatform()
  val va = file("/path/to/jvm/dist/bin")
  jvmArgs(
    "-javaagent:$va/variance-agent.jar",
    "-javaagent:$va/variance-junit.jar",
    "-Dva.suite=unit",
  )
}
```

`unit` is a suite your root `variance.config.json` declares, as it does for
your Node suites:

```json
{ "suites": { "unit": { "kind": "unit" }, "checkout": { "kind": "e2e" } } }
```

When the test plan finishes, the listener writes the suite's record to
`suites/unit/coverage.bin` in your checkout's [cache directory](cache.md): the
file a Node seam naming `suite: 'unit'` writes, and the one a reader of that
suite opens. In a worktree it is the worktree's own directory, and the first run
there starts from the rows the primary checkout recorded. If your repository
declares no suites, leave `-Dva.suite` out and the record is the checkout's one
`coverage.bin`. A suite your configuration does not declare fails the JVM
before a test runs, and so does no suite once you declare any.

Each top-level test class becomes one row. Every module and fork of the build
records into the same suite, and the last JVM to finish writes the whole suite,
whichever module it ran. A rerun replaces the rows of the classes it ran and
keeps the rest, so `-Dtest=AddTest` leaves the other classes' rows in place. A
row that read a file whose text has changed since is dropped, and its class runs
until it is recorded again.

| Setting | Where | Default | |
| --- | --- | --- | --- |
| `includes` | agent option | the checkout's own classes | Colon-separated class-name globs, with `*` and `?`, as JaCoCo's. |
| `sources` | agent option | `src/main/java:src/test/java:src/main/kotlin:src/test/kotlin` | Colon-separated source roots, relative to the test JVM's working directory. |
| `va.suite` | system property | none | The declared suite this JVM records into. |
| `va.out` | system property | the suite's directory in the cache | A directory of your own for `record.jsonl`, `coverage.va` and `events.tsv`, read with `variance select --execution <va.out>/coverage.va`. It is not checked against your configuration, and naming it with `va.suite` fails the JVM. |
| `va.commit` | system property | none | The commit `coverage.va` names as its baseline. |
| `va.parts` | system property | `VARIANCE_AUTHORITY_PARTS` | A service's parts directory. See [a service a Jest case calls](#record-a-service-a-jest-case-calls). |
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

A suite's record is read the way a Node suite's is, as the
[execution record](execution-record.md) describes. A record in your own `va.out`
is named with `--execution`:

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
the record, and `entered`, the ones the diff reaches. Paths are relative to the
checkout, whichever module ran, so they match a diff taken at its root.

## Record a service a Jest case calls

A Jest case that calls a service over HTTP runs code in another process, and
nothing in the case's own record shows it. To join the two, every request
carries the case's [journey](journeys.md), an opaque id the Jest seam mints per
case. The service writes what it ran under each journey to files in a parts
directory. After the run, `variance journeys finalize` joins those parts to the
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

`VARIANCE_AUTHORITY_PARTS` works in place of `-Dva.parts`. Start the service
from its module directory inside the checkout, because the `sources` roots are
relative to that directory. Files are named relative to the nearest directory
above it that holds `.git`, so they match the names Jest records; in a container
that means mounting the checkout rather than only the module.

When the JVM exits through its shutdown hooks, on `SIGTERM` or `System.exit`,
the agent writes two files to the parts directory: one frame per journey, plus
one frame for what ran between journeys, and the regions those frames name. A
`SIGKILL` writes nothing. The files are named for `VARIANCE_AUTHORITY_HEAD` when
the service's environment sets it, and `jvm` otherwise; `variance journeys
finalize` compares the heads that wrote parts with the run before, so give each
service its own.

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

The fold charges each journey's frame to the case that minted it. It charges the
between frame, which holds the service's startup and anything not attributed to
a journey, to every case that sent this process at least one request.

A class that is `unknown` goes into its journey's frame by class name, with no
regions. No record holds that name, so `journeys finalize` lists it among the
modules cases ran that no record holds: a change to it selects nothing, and the
finalize prints which classes those are.

### Concurrent requests

Each journey's enter and close ends a window. The methods drained in a window
go to each journey that was open during it. So two journeys in flight at once
share their windows, and each one's row gains what the other ran. That widens
selection and never drops a method a journey ran. Work that outlives its request
lands in whichever window drains it.

## Record a service browser specs drive

When the tests are browser specs that no JavaScript record can join, your
driver sets the journey cookie itself and keeps a table, `journeys.tsv`, of
`<journey>\t<spec file>`. Record the service with `-Dva.out` instead of a parts
directory, and pass the table to `Coverage` as its last argument, from the
directory the service ran in, at the commit it ran at:

```bash
java -cp variance-agent.jar dev.varianceauthority.jvm.Coverage <va.out>/record.jsonl <out> [commit] [sources] journeys.tsv
```

Each journey row goes to its spec, and each between row goes to every spec.
`Coverage` fails when the table is not empty and the service recorded none of
its journeys: a service that was never watched looks the same as one that ran
nothing. [Testing across dimensions](across-dimensions.md) scores this against
`variance reach` on a Java shop driven through a browser.
