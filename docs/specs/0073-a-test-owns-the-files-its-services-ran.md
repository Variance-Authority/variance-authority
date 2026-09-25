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

JaCoCo's usual execution data is one set of probe flags for an agent in one
JVM. `getExecutionData(true)` snapshots and resets that shared set. If test A
and test B overlap in that JVM, a hit by B before A's dump may be credited to A;
a hit by A after that dump may be credited to B. A different session id or an
`.exec` filename labels the dump; it does not partition the counters. A lock
around dump/reset protects the operation, not the interval in which both tests
ran. The Phase 0 listener's `overlap` log can detect overlapping class
containers; it cannot detect overlapping requests or asynchronous work in the
service JVM.

This is a property of **shared probe-state ownership**, not a reason to reject
JaCoCo. When one attempt exclusively owns a service JVM for the full interval
being measured, its JaCoCo dump can be attributed to that attempt. The
alternative is to make each probe write presence under the attempt's execution
identity. That removes the dump/reset race and admits shared, concurrent service
workers. The two modes can produce the same selection fact; neither is assumed
to have the lower cost before measurement.

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
may be charged to all of them; work with an unknown owner may not be assigned
to the nearest attempt by time.

**3. Exclusive-worker recording is a supported mode.** An operator may run
tests sequentially against a single service worker, or give each attempt its
own fresh worker or process. A prefork or worker-per-request router is a valid
way to provide the latter when it can bind all requests of an attempt to its
worker, or identify and merge the workers that served them. The exclusivity
claim covers the **entire attempt**: its requests, downstream calls and
asynchronous tail, across every service whose hits enter the row. Before
reuse or reset, the recorder waits for that work to settle and drains each
participating worker. JaCoCo's process-wide counters can then supply the file
set. Sequential test scheduling alone does not establish exclusivity if a
previous attempt's work remains active, unrelated traffic enters the worker,
or another service replica handles a request without reporting. Such a row is
partial and cannot exclude a test.

**4. Identity-keyed recording is the broader mode.** A purpose-built JVM
instrument may mark source-file presence at class or method entry into a
concurrent set keyed by execution identity, without resetting process-wide
counters. The request adapter establishes the identity at ingress. Each async
or reactive boundary must carry it into the code where probes run; each
outbound boundary must forward it to declared participants. A thread-local
alone covers only work that stays on that thread. Background work without a
causal identity remains unclaimed. The instrument records the file grain the
selector needs; it need not write one JaCoCo `.exec` per attempt or convert
those files through a coverage report. This mode permits interleaved attempts
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
size for a bare run, exclusive-worker JaCoCo recording, and identity-keyed
file recording on the same suite. It must count incomplete rows and attribution
errors under concurrent load. An isolated mode is acceptable even if it is
slower; the measurement makes that price visible instead of ruling it out by
architecture.

## Acceptance

1. Two tests whose requests interleave in one JVM enter different source files.
   Identity-keyed recording returns each file only for its own attempt, even
   when both requests resume on different threads. A JaCoCo interval dump of
   the same overlap is marked unsuitable for per-attempt exclusion.
2. The same tests run sequentially with exclusive workers. JaCoCo yields the
   correct file sets after all work settles. A second request from one test,
   routed to another worker, is merged into that test's row or makes it
   incomplete.
3. A browser's first request, a service-to-service call, and an asynchronous
   continuation retain one attempt identity wherever the deployment claims
   coverage. Removing the carrier at any hop produces an incomplete row and
   runs the potentially affected test.
4. An unrelated health request, an unknown binary class, a missing participant
   and a failed report cannot create a complete negative observation.
5. A changed source file selects the test that entered it in another process;
   a test with a complete record that did not enter it may be excluded, subject
   to the existing selection and change-reading rules.

## Boundary

This specifies the observation and its trust conditions, not a single agent or
router. JaCoCo remains useful for the isolated mode and for the Phase 0
selection experiment. The keyed collector is more broadly applicable because
it does not require exclusive service ownership; it still requires real
propagation through every runtime boundary it claims. A request edge without
an instrumented participant can narrow only to tests that called the observed
endpoint, under [0036](0036-a-journey-crosses-processes.md); it cannot claim
that a particular source file executed.
