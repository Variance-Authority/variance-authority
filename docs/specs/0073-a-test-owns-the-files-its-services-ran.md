# Spec 0073 — a test owns the files its services ran

**Missing:** a trustworthy test-attempt-to-source-file record when the test
driver and the code under test run in different processes. The JVM Phase 0
harness divides one JaCoCo store at top-level test-class boundaries; it neither
attributes concurrent service work nor records individual test methods.
**Built on:** [0036](0036-a-journey-crosses-processes.md) (the observed request
edge and the second hop), [0029](0029-what-a-run-remembers.md) (an incomplete
observation cannot justify a skip), and
[ADR-0056](../context/adr/0056-a-journey-is-the-places-visited.md) (presence,
not a count or a trace). The
[Phase 0 harness](../../tools/jvm-phase0/README.md) is an experiment for
selection accuracy and cost, not this recorder.

## Purpose

A test may make several requests, and one request may pass through several
services. The useful selection fact is **this test attempt entered this source
file in this build**. The driver owns the test identity. A service can report
only the execution identity it received and the files its own code entered; it
cannot infer which test caused a request from the time the request arrived.

### The concurrency problem

JaCoCo's execution data is one set of probe flags for an agent in one JVM. A
flag records that a probe was hit, once; a second hit leaves no trace. To see
the next attempt's hits, a recorder must drain the flags and **reset** them:
`getExecutionData(true)`. Each attempt gets the hits between its reset and its
dump, its **window**. A session id or an `.exec` filename labels the dump; it
does not partition the flags.

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

A read that erases nothing removes the reset, and with it the need for
exclusive ownership. Each probe stores the epoch of its last hit in place of a
flag; the driver advances the epoch at attempt boundaries. At its end, an
attempt reads the probes stamped since its start. A later hit by another
attempt overwrites the stamp with a later epoch, which is still inside the
first attempt's range if it happened before that attempt ended. Nothing is
cleared, so concurrent attempts each get a superset of their own hits:
concurrency costs precision, not soundness. It still needs containment, since
a task that outlives its attempt stamps a later epoch. JaCoCo has no such
probe; it is a store of one long in place of one boolean, and the cost is
measured under item 7, not assumed.

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
class runs, and a service can do the same: **one attempt at a time per service
instance, and parallelism by instances.** The driver resets and dumps the
service's agent at the attempt's boundaries, as the test listener does
in-process. Extra
instances cost memory and startup; for a suite whose selection skips most of
it, that is the smaller price, and it is where recording starts.

What an instance cannot give by itself is the thread fact: the driver does not
see when a service's asynchronous tail has finished. The service must report
it (item 3).

Two modes remove the reset, and with it the need for exclusive instances.
Epoch-stamped probes (item 4) let attempts share an instance and cost only
precision: a row widens by whatever ran beside it. Identity-keyed presence
(item 5) makes each probe write under the attempt's execution identity, which
keeps rows exact at the price of carrying the identity through every runtime
boundary. All three produce the same selection fact; none is assumed to have
the lower cost before measurement.

## What would discharge it

**1. The driver names an attempt and accounts for its calls.** A runner seam
mints an opaque identity for each test attempt, including a retry, and retains
the mapping to the runner's test identity. A browser driver installs the carrier
before the first product request; an HTTP driver attaches it to its requests.
The driver observes the outbound request edge as in [0036](0036-a-journey-crosses-processes.md).
The carrier may be a cookie, a header or an existing request-context field;
which one works is established at each boundary. A cookie on the first request
does not prove that a service forwarded it to the next service. The service
reports only the opaque identity and never the test name.

**2. Every participating service reports file presence and its scope.** A JVM
participant maps an entered class to a source file in a known build inventory,
then emits a set of file identities for each execution identity. A class's
`SourceFile` basename alone is not a unique source path. The record names the
build, participant, attempt, watched origins or service boundary, and whether
every claimed execution was observed. A file hit by an unclaimed request is
kept separate. Process initialization and other work shared by all attempts
may be charged to all of them. Work with an unknown owner may widen a row by
time, never complete one: hits between two windows are added to the attempt
before them.

**3. Exclusive-instance recording is the first mode.** Each service instance
serves one attempt at a time, and the suite runs in parallel across instances,
as Surefire forks run test classes. A router that binds all requests of an
attempt to its instance, or identifies and merges the instances that served
them, satisfies this. The driver resets each participating agent before the
attempt and dumps it after, and records the gap between windows as its own
dump. Before the dump, the service reports that the attempt's work has
settled: no request in flight, no task it queued still pending, no thread it
started still running. That report is the service's side of the listener's
thread audit. A service that cannot report it gives rows that are partial, and
a partial row cannot exclude a test. Unrelated traffic in a window only widens
the row; it does not make it partial.

**4. Epoch-stamped recording shares an instance without a reset.** A JVM
instrument stores, per probe, the epoch of its last hit. The driver advances the
epoch at each attempt's start on every participating instance and records the
epoch it got back. At the attempt's end, after the settle report of item 3,
each participant returns the files whose probes carry an epoch at or after that
start. Nothing is cleared. Attempts that overlap on one instance each receive
their own hits plus their neighbours'; the report counts how many attempts
overlapped each row, so the widening is visible. A task that outlives its
attempt is caught by the settle report, as in item 3.

**5. Identity-keyed recording is the exact mode.** A purpose-built JVM
instrument may mark source-file presence at class or method entry into a
concurrent set keyed by execution identity, so no read clears another
attempt's presence. The request adapter establishes the identity at ingress. Each async
or reactive boundary must carry it into the code where probes run; each
outbound boundary must forward it to declared participants. An existing
carrier, such as the OpenTelemetry Java agent's context and W3C baggage, is
ridden rather than rebuilt. A thread-local alone covers only work that stays
on that thread. Background work without a causal identity remains unclaimed.
The instrument records the file grain the selector needs; it need not write
one JaCoCo `.exec` per attempt or convert those files through a coverage
report. This mode permits interleaved attempts
in one JVM, but only where the carrier and runtime scope have been verified.

**6. The join refuses silence.** The driver joins participant reports by its
attempt identity and retains the observed call edges. A declared participant
that fails to report, a missing build inventory, a lost report, an unverified
hop, a still-running async tail or a worker the driver cannot account for
makes the affected observation incomplete. Absence of a file from such a row
cannot justify skipping that test. The report distinguishes a complete empty
file set from no file set, and tells the operator which boundary prevented a
narrower selection. This follows [0029](0029-what-a-run-remembers.md), rather
than treating a timeout as zero coverage.

**7. Cost and correctness are measured separately.** The Phase 0 harness may
continue to compare method, shape, line and file selection against faults.
The implementation must also measure full test-phase wall time and artifact
size for a bare run, exclusive-instance JaCoCo recording, epoch-stamped
recording, and identity-keyed file recording on the same suite, and, for the
epoch mode, how much rows widen at each level of overlap. It must count
incomplete rows and attribution errors under concurrent load. The
exclusive-instance mode is acceptable even if it is slower; the measurement
makes that price visible instead of ruling it out by architecture.

## Acceptance

1. Tests run one at a time per service instance, across several instances.
   JaCoCo yields each attempt's file set, including a task the attempt queued
   that finishes after its last response: the dump waits for the settle report.
   A second request from one test, routed to another instance, is merged into
   that test's row or makes it incomplete.
2. A health request or a scheduled job inside a window adds its files to that
   row and nothing else. A service that cannot report settling produces
   partial rows, and their tests run.
3. In a test JVM, a class whose started thread outlives it, or classes that
   overlap under parallel execution, produce incomplete rows for those classes.
4. A JVM record carries its warmth as a key. Compared against an `alone`
   reading, the static initializers a class entered only when it ran first are
   reported by name, as [0038](0038-a-journey-is-read-against-the-committed-tree.md)
   reports a place that moved with its inputs fixed.
5. Two tests whose requests interleave in one JVM enter different source files.
   A reset between them is refused: a JaCoCo dump taken while another attempt
   is open is marked unsuitable for per-attempt exclusion. Epoch-stamped
   recording returns each attempt both files and counts the overlap.
   Identity-keyed recording returns each file only for its own attempt, even
   when both requests resume on different threads.
6. A browser's first request, a service-to-service call, and an asynchronous
   continuation retain one attempt identity wherever the deployment claims
   coverage. Removing the carrier at any hop produces an incomplete row and
   runs the potentially affected test.
7. An unknown binary class, a missing participant and a failed report cannot
   create a complete negative observation.
8. A changed source file selects the test that entered it in another process;
   a test with a complete record that did not enter it may be excluded, subject
   to the existing selection and change-reading rules.

## Boundary

This specifies the observation and its trust conditions, not a single agent or
router. JaCoCo serves the exclusive-instance mode, which comes first, and the
Phase 0 selection experiment. The epoch-stamped and keyed collectors are more
broadly applicable because they never reset, so they do not require exclusive
service ownership; the keyed one still requires real
propagation through every runtime boundary it claims. A request edge without
an instrumented participant can narrow only to tests that called the observed
endpoint, under [0036](0036-a-journey-crosses-processes.md); it cannot claim
that a particular source file executed.
