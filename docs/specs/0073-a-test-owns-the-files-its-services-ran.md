# Spec 0073 — a test owns the files its services ran

**Missing:** a trustworthy test-attempt-to-source-file record when the test
driver and the code under test run in different processes. The JVM Phase 0
harness divides one JaCoCo store at top-level test-class boundaries; it neither
attributes concurrent service work nor records individual test methods, and it
credits work done once per JVM to whichever class ran first.
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

JaCoCo's execution data is one set of probe flags for an agent in one JVM.
`getExecutionData(true)` snapshots and resets that shared set, so a recorder
divides it by time: each attempt gets the hits between its reset and its dump,
its **window**. A session id or an `.exec` filename labels the dump; it does not
partition the counters. A lock around dump/reset protects the operation, not
the interval in which the work ran.

The two ways a hit can land in the wrong window are not equally dangerous:

- **Another attempt's work lands in this window.** This attempt's row gains
  files it never needed. It is selected more often than necessary. That costs
  time and never misses a failure.
- **This attempt's work lands outside its window.** Its row lacks a file it
  entered. A change to that file skips it. This is the miss.

So a window-based record is sound when every attempt's work is **contained**
in its window. Extra hits from health checks, scheduled jobs or any unrelated
traffic do not break containment; they only widen rows. Two attempts sharing
one JVM at the same time break it for both: each one's hits land partly in the
other's window.

### Why a test JVM does not have it

A Maven project's own unit tests already meet the containment condition, and
the reasons are structural:

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

Concurrency is not the larger loss. A static initializer, a lazy singleton or
a cache runs for the first attempt that touches it and never again in that
JVM. The first attempt's window holds it; every later attempt depends on its
result without entering it.

On Commons Lang this is most of the difference between the suite record and
each class alone: 312 of 316 test classes lack 11,688 methods in total, 1,710
of them static initializers. The main chain is one line of test code.
`AbstractLangTest.after()` checks the `ToStringStyle` registry after every
test; the first class to do so runs `ToStringStyle`'s static initializer, which
builds the style singletons and initializes `ObjectUtils`. In the suite record,
210 test classes never enter `ObjectUtils.java`. A change there does not select
them at file grain, although every one of them ran on its initialized state.
The seeded faults did not expose this because none was planted in code that
runs once.

The loss follows execution order, not concurrency, so exclusive instances do
not remove it: an instance that serves attempts one after another has warm
caches and initialized classes for all but the first. A service instance adds
more of it: framework startup, lazy beans, connection pools. Item 2 charges
process initialization to every attempt; lazy work needs the same treatment,
and a window record cannot tell it apart from the attempt's own work. A record
made with a fresh JVM per test class has none of this loss; on Commons Lang it
takes 336 s against 143 s for the suite in one JVM.

### The same fix for a service

A service JVM has the problem because its boundary is not visible from inside
it, and because it serves attempts concurrently. Both are removed the way
Surefire removes them for tests: **one attempt at a time per service instance,
and parallelism by instances.** The driver resets and dumps the service's agent
at the attempt's boundaries, as the test listener does in-process. Extra
instances cost memory and startup; for a suite whose selection skips most of
it, that is the smaller price, and it is where recording starts.

What an instance cannot give by itself is the thread fact: the driver does not
see when a service's asynchronous tail has finished. The service must report
it (item 3).

The broader mode makes each probe write presence under the attempt's execution
identity. That removes the dump/reset race and admits shared, concurrent
service workers, at the price of carrying the identity through every runtime
boundary. The two modes produce the same selection fact; neither is assumed to
have the lower cost before measurement.

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

**4. Identity-keyed recording is the broader mode.** A purpose-built JVM
instrument may mark source-file presence at class or method entry into a
concurrent set keyed by execution identity, without resetting process-wide
counters. The request adapter establishes the identity at ingress. Each async
or reactive boundary must carry it into the code where probes run; each
outbound boundary must forward it to declared participants. An existing
carrier, such as the OpenTelemetry Java agent's context and W3C baggage, is
ridden rather than rebuilt. A thread-local alone covers only work that stays
on that thread. Background work without a causal identity remains unclaimed.
The instrument records the file grain the selector needs; it need not write
one JaCoCo `.exec` per attempt or convert those files through a coverage
report. This mode permits interleaved attempts
in one JVM, but only where the carrier and runtime scope have been verified.

**5. The join refuses silence.** The driver joins participant reports by its
attempt identity and retains the observed call edges. A declared participant
that fails to report, a missing build inventory, a lost report, an unverified
hop, a still-running async tail or a worker the driver cannot account for
makes the affected observation incomplete. Absence of a file from such a row
cannot justify skipping that test. The report distinguishes a complete empty
file set from no file set, and tells the operator which boundary prevented a
narrower selection. This follows [0029](0029-what-a-run-remembers.md), rather
than treating a timeout as zero coverage.

**6. Cost and correctness are measured separately.** The Phase 0 harness may
continue to compare method, shape, line and file selection against faults.
The implementation must also measure full test-phase wall time and artifact
size for a bare run, exclusive-instance JaCoCo recording, and identity-keyed
file recording on the same suite. It must count incomplete rows and attribution
errors under concurrent load. The exclusive-instance mode is acceptable even if it is
slower; the measurement makes that price visible instead of ruling it out by
architecture.

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
4. Work done once per JVM is charged to every later attempt that depends on it,
   or the record is made in a fresh JVM per class. On Commons Lang, a change to
   `ObjectUtils`' static initializer selects the 210 test classes that ran on
   it without entering it.
5. Two tests whose requests interleave in one JVM enter different source files.
   Identity-keyed recording returns each file only for its own attempt, even
   when both requests resume on different threads. A JaCoCo interval dump of
   the same overlap is marked unsuitable for per-attempt exclusion.
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
Phase 0 selection experiment. The keyed collector is more broadly applicable
because it does not require exclusive service ownership; it still requires real
propagation through every runtime boundary it claims. A request edge without
an instrumented participant can narrow only to tests that called the observed
endpoint, under [0036](0036-a-journey-crosses-processes.md); it cannot claim
that a particular source file executed.
