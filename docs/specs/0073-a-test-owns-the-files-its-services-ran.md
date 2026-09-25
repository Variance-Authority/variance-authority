# Spec 0073 — a test owns the files its services ran

**Missing:** a trustworthy test-attempt-to-source-file record when the test
driver and the code under test run in different processes. The JVM Phase 0
harness divides one probe store at top-level test-class boundaries; it neither
attributes service work nor records individual test methods.
**Built on:** [0036](0036-a-journey-crosses-processes.md) (the observed request
edge and the second hop), [0029](0029-what-a-run-remembers.md) (an incomplete
observation cannot justify a skip), and
[ADR-0056](../context/adr/0056-a-journey-is-the-places-visited.md) (presence,
not a count or a trace), and [changes before and beyond](../changes-before-and-beyond.md)
(what a change no record can name selects). The
[Phase 0 harness](../../tools/jvm-phase0/README.md) is an experiment for
selection accuracy and cost, not this recorder.

## Purpose

A test may make several requests, and one request may pass through several
services. The useful selection fact is **this test attempt entered this source
file in this build**. The recorder is our own Java agent, and this spec
arranges the run around its one constraint.

### The recorder

The agent sets one flag per method, on entry: a store into a fixed
`boolean[]` on the boot class path, with no lookup, branch or line probe. A
drain returns the methods whose flag is set, clears them, and writes each
attempt's row in the record format directly, with the file, the method and
every line the method holds. There is no execution-data file and no analysis
step. A row names every line of a method it entered, so a line-grain selection
from it can only widen. Synthetic methods other than lambda bodies are not
probed: accessors and bridges forward to a method that is.

On Commons Lang, against a bare test phase of 130 s (median of three,
interleaved):

| Recorder | Test phase |
| --- | --- |
| JaCoCo, probes only | +7.0% |
| JaCoCo, a dump per test class, then analysis | +5.6%, plus the analysis |
| This agent, probes only | +3.2% |
| This agent, a row per test class | +1.5% |

Its record holds every method the JaCoCo record holds for every test class.
The only additions are compiler-generated default constructors and enum
`values()`, which JaCoCo's analysis filters out.

### The concurrency problem

The agent's store is one set of flags per JVM. A flag records that a method was
entered, once; a second entry leaves no trace. To see the next attempt's
entries, a recorder must drain the flags and **reset** them. JaCoCo is the
same: `getExecutionData(true)`. Each attempt gets the hits between its reset
and its drain, its **window**. A label on the drain does not partition the
flags.

Overlapping windows are not the damage. The two ways a hit can land in the
wrong window are not equally dangerous:

- **Another attempt's work lands in this window.** This attempt's row gains
  files it never needed. It is selected more often than necessary. That costs
  time and never misses a failure.
- **This attempt's work lands outside its window.** Its row lacks a file it
  entered. A change to that file skips it. This is the miss.

The reset produces the second kind. When attempt A dumps and resets while B is
still running, every probe B set before that moment is erased from B's window,
and B's row loses the files it entered first. Overlap alone would only widen
both rows; the reset turns it into a miss. So under reset, the record is
sound only when one attempt at a time owns the flags, and every attempt's work
is **contained** in its window. Health checks, scheduled jobs and other
unrelated traffic do not break containment; they only widen rows.

### Why a test JVM survives the reset

A Maven project's own unit tests reset only when nothing else is running, and
their work is contained in their windows. The reasons are structural:

- **The boundary runs on the thread that does the work.** JUnit Platform
  fires the class's start and finish events on the thread that runs the class.
  Every probe hit on that thread falls between them in program order, so it
  cannot leave the window.
- **Only other threads can leak, and a test waits for its threads.** A test
  that starts a thread, an executor or an async task asserts on the result, so
  it joins, awaits or shuts them down before it finishes. In Commons Lang, 17
  test classes start threads. The one that starts threads and never waits
  for them is `@Disabled`, and `BasicThreadFactoryTest` creates threads it
  never starts. No main code runs on a thread the JVM owns: no finalizer,
  cleaner or shutdown hook.
- **Surefire runs one class at a time per JVM.** `forkCount` above one adds
  JVMs, each with its own probe flags, so parallelism by process is safe.
  Parallelism by thread inside one JVM (`junit.jupiter.execution.parallel.enabled`,
  Surefire `parallel`) breaks containment exactly as a shared service does.

The listener checks rather than trusts this. At each class end it logs every
thread the class started that is still alive, and a common pool that is not
quiescent. Either line marks work that can land in a later window. On Commons
Lang it names four: a parked executor thread left by `TimedSemaphoreTest`,
JUnit's timeout watcher, and two JVM threads (attach listener, process reaper).
None of them put Lang code in a later window: recording each of the 316 test
classes in its own JVM and comparing, the suite record gains 2 methods in
total, both reached through a cache or a timed wait that an earlier class set
up. The same suite run twice records identically.

### Work done once per JVM

A static initializer, a lazy singleton or a cache runs for the first attempt
that touches it and never again in that JVM. This is memoization as a side
effect the record sees, and it is not new to the JVM: cache warmth is part of
the key two readings compare under, `alone` is a key, and a place entered in one
reading and missed in another under one input is reported by name
([0038](0038-a-journey-is-read-against-the-committed-tree.md), items 2 and 3;
[0012](0012-order-dependence-in-a-run.md) for the `alone` pass). A JVM record
takes the same reading. Surefire's `-DreuseForks=false` is the `alone` pass for
a test class, and `compare-records.mjs` is the comparison.

On Commons Lang it names one warmer. `AbstractLangTest.after()` checks the
`ToStringStyle` registry after every test; the first class to do so runs
`ToStringStyle`'s static initializer, which builds the style singletons and
initializes `ObjectUtils`. Read alone, 312 of 316 test classes enter 11,688
more methods, 1,710 of them static initializers; in the shared reading 210 of
them never enter `ObjectUtils.java`. The shared reading costs 143 s and the
alone reading 336 s.

A service instance has more of it: framework startup, lazy beans, connection
pools. Exclusive instances do not change that, since an instance serving
attempts one after another is warm for all but the first; the same key and the
same report apply. Item 2 charges process initialization to every attempt.

### The same fix for a service

A service JVM serves attempts concurrently, so a reset for one attempt erases
another's hits. Surefire avoids that for tests by never resetting while another
class runs, and a service does the same: **one attempt at a time per service
instance, and parallelism by instances.** Each parallel worker gets its own
lane: one instance of every service the tests call, used by that worker alone.
The driver resets and dumps the lane's agents at the attempt's boundaries, as
the test listener does in-process. Nothing is carried in a request, because
the lane is the attempt. Extra instances cost memory and startup; for a suite
whose selection skips most of it, that is the smaller price.

What a lane cannot give by itself is the thread fact: the driver does not see
when a service's asynchronous tail has finished. The service must report it
(item 3).

### What no probe sees

A probe fires when code runs. Some changes alter behaviour without running any
code in the changed file:

- **Compile-time constants.** javac copies a `static final` primitive or String
  into every class that reads it, so the reader never enters the declaring file.
- **Annotations and reflectively read members.** Jackson, JPA, Spring and
  validation read them without calling the class's code.
- **Kotlin `inline` functions.** The body is compiled into the caller, so the
  flag that is set is the caller's.
- **Classes the agent does not instrument**: excluded packages, the boot class
  path, classes generated or redefined at runtime.
- **Files that are not code**: `application.yml`, `.properties`, SQL,
  templates, `META-INF/services`.

The first four are named by the files that use them, so the static `reach` walk
finds their users: a changed constant, annotation, `inline` function or
uninstrumented class selects by reach rather than by the record. The kind is
read from both texts of the change, not declared. The last is named by a path
string at most, so it is before reach: it is declared under `before`, and a
change to it runs the suite.

## What would discharge it

**1. The driver names an attempt and owns its lane.** A runner seam names each
test attempt, including a retry, and knows which lane it ran in. The driver
records the outbound request edge as in [0036](0036-a-journey-crosses-processes.md),
so a request that left the lane is seen rather than assumed away.

**2. Every participating service reports file presence and its scope.** A JVM
participant maps an entered class to a source file in a known build inventory,
then emits a set of file identities for each attempt. A class's
`SourceFile` basename alone is not a unique source path. The record names the
build, participant, attempt, and whether the attempt's window closed after a
settle report. Process initialization and other work shared by all attempts
may be charged to all of them. Work with an unknown owner may widen a row by
time, never complete one: hits between two windows are added to the attempt
before them.

**3. Each lane serves one attempt at a time.** The suite runs in parallel
across lanes, as Surefire forks run test classes. The driver resets each agent
in the lane before the attempt and dumps it after, and records the gap between
windows as its own dump. Before the dump, the service reports that the
attempt's work has settled: no request in flight, no task it queued still
pending, no thread it started still running. That report is the service's side
of the listener's thread audit. A service that cannot report it gives rows that
are partial, and a partial row cannot exclude a test. Unrelated traffic in a
window only widens the row; it does not make it partial.

**4. A change no probe sees selects by reach.** The change reader classifies a
changed constant, annotation, `inline` function or uninstrumented class, and
the selector answers it with the static walk instead of the record. A changed
file under `before` runs the suite. Neither is an unmeasured file that selects
nothing: that rule is for a file nothing connects to, and these are connected
by use or by the runtime.

**5. The join refuses silence.** The driver joins the lane's reports by
attempt and retains the observed call edges. A participant that fails to
report, a missing build inventory, a lost report, a request that left the lane,
or a still-running async tail makes the affected observation incomplete. Absence of a file from such a row
cannot justify skipping that test. The report distinguishes a complete empty
file set from no file set, and tells the operator which boundary prevented a
narrower selection. This follows [0029](0029-what-a-run-remembers.md), rather
than treating a timeout as zero coverage.

**6. Cost is measured, not assumed.** The Phase 0 harness keeps comparing
method, shape, line and file selection against seeded faults. The
implementation measures full test-phase wall time for a bare run and for lane
recording on the same suite, and the memory and startup the extra lanes cost.
The agent's cost stays under JaCoCo's on the same suite. A probe that reads
anything on method entry is measured against that figure before it ships.

## Acceptance

1. Tests run one at a time per lane, across several lanes. The agent yields each
   attempt's file set, including a task the attempt queued that finishes after
   its last response: the dump waits for the settle report. A request that
   leaves the lane makes the row incomplete.
2. A health request or a scheduled job inside a window adds its files to that
   row and nothing else. A service that cannot report settling produces
   partial rows, and their tests run.
3. In a test JVM, a class whose started thread outlives it, or classes that
   overlap under parallel execution, produce incomplete rows for those classes.
4. A JVM record carries its warmth as a key. Compared against an `alone`
   reading, the static initializers a class entered only when it ran first are
   reported by name, as [0038](0038-a-journey-is-read-against-the-committed-tree.md)
   reports a place that moved with its inputs fixed.
5. Changing a compile-time constant selects every test class whose closure
   reads it, including those whose rows lack the declaring file. The same holds
   for an annotation read by reflection and for a Kotlin `inline` function.
6. A changed `application.yml` declared under `before` runs the suite.
7. An unknown binary class, a missing participant and a failed report cannot
   create a complete negative observation.
8. A changed source file selects the test that entered it in another process;
   a test with a complete record that did not enter it may be excluded, subject
   to the existing selection and change-reading rules.

## Boundary

This specifies the observation and its trust conditions, not a router. The agent
is the recorder in both the test JVM and the lane's services. Sharing one
service instance between concurrent attempts is not supported: it needs an
identity carried through every async boundary and a probe that reads it on
every method entry, and nothing measured so far says the extra lanes cost
more. A request edge without an instrumented participant can narrow only to
tests that called the observed endpoint, under
[0036](0036-a-journey-crosses-processes.md); it cannot claim that a particular
source file executed.
