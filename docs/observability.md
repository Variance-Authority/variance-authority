# Ask a question the test did not ask

An assertion is a question written before the run, and the answer is one bit.
That bit is the whole of what a suite conventionally reports about an execution
that knew a great deal more: which elements it addressed, which components
rendered, which instance scheduled each render, and which branch a service took
while the page was waiting on it. All of it exists for a few milliseconds, and
teardown is the end of it.

The cost is not paid when a test fails. It is paid afterwards, when the only
question anyone can ask is the one somebody already wrote down. `Unable to find
element` names the question. It does not name the button, the component that
owned it, the code that put it there, or the update that removed it — and the
process that knew all four has exited by the time the line is printed.

## The record, rather than the breakpoint

None of this is secret. Open dev tools on a live page and every one of those
facts is reachable: the component that produced a node, the update that scheduled
a render, the branch a module took. Three conditions have to hold for that to
work — the page is running, execution is stopped, and a person is watching. In
CI none of the three holds, and for anything reading a result an hour later none
of them ever will.

So the record is taken while the page is alive and kept once it is gone. The test
does not change. Same queries, same expectations, same pass and same fail; what
the run leaves behind is what changes.

## Attribution is copied before it can be destroyed

React removes its Fiber pointer from a DOM node when the node unmounts. A click
handler that removes the element it fired on has destroyed that element's
attribution before the test's next statement runs. The information is not hidden
and not expensive — it is gone, between two adjacent lines of the test file,
which is why a retry, a screenshot, or a trace replayed afterwards all arrive
too late for it.

Eyes listens on `document` in the capture phase, ahead of React's delegated
handler on the root container, and copies the owner chain, the props digest at
each boundary, the authoring component and the JSX coordinate into a plain value
in that same synchronous turn. The copy holds no DOM node and no Fiber, so
delaying it and retaining the element is not the same operation.

The element is then detached and unreachable from the document, and the record
still names the component that owned it, the component whose JSX put it there,
and the file and line where that was written.

## The identity crosses; the name does not

A page under test talks to services, and a service is the wrong shape to ask
about a suite. It outlives every subject in the run, it answers several of them
at once, and nothing inside it can evaluate a test — a time window is not an
execution.

What crosses instead is one opaque id per execution, minted by the driver and set
on the browser context before the first navigation. The browser sends it on
requests it was already going to send. A service instrumented by its own build
reads the id off the request and reports what it entered, to a loopback address
it also read off a cookie. Only the driver holds `journey → subject`, so only the
driver can join, and a report cannot claim an execution by writing one down: the
execution is in the address the report arrived on, never in the body.

This is distributed tracing with the runner as the collector, and what it buys is
not correlation but separation. Two specs running at once, against one service
process, inside one module, come back apart. Counters are keyed by async scope
rather than by the process, and the global the probes read is an accessor rather
than a value, so a cached factory invalidates exactly where two executions
interleave. A process-global counter array cannot do that, and neither can a
module-global one.

The sentence that falls out is one no single instrument can produce: _this spec
entered that branch of that service and the other spec never did_ — with the
service never told what a spec is.

## An absence is never reported as a measurement

Every reading here separates _nothing was there_ from _nobody looked_, and does
it in the shape rather than in prose. Update initiators the renderer did not
expose are unavailable; an empty list is a completed reading. A node with no
reachable Fiber says which of the two reasons applies. The tally of work a run
opened and never closed is exact no matter what was dropped from the bounded log
beside it.

The case that costs something is the one worth reading. A declared head that
reports nothing retires the whole run's right to narrow anything:

```text
heads api reported nothing: a service that was not watched cannot be told from
one that executed nothing, so no subject in this run may justify an exclusion
```

An instrument that reads silence as zero is confidently wrong in the direction
that skips a test. This one gives up the narrowing and prints why.

## A carried value joins; a derived one agrees until it stops

An answer spanning two instruments is worth what its key is worth, and two kinds
of key run through this system.

A **carried** value is produced once and propagated. The props digest is computed
by one function and read back by the diff and by the commit record; the JSX
coordinate is written by the transform; the journey id is minted by the driver
and handed back by the browser. Comparing one of these across a process boundary
compares a value to itself.

A **derived** value is computed independently at each end from something both
ends can see — a display name, a title, a wall clock. Those agree until they do
not, and nothing announces the day they stop.

So a cross-instrument answer joins on exact identities both producers emitted, or
it refuses and names the half that was missing. A name match is good enough when a
person looks something up by hand, and never between two instruments. It is also
why a joined view concludes _less_ than either half alone: a file that executed
with nothing addressing it is a replay candidate, and neither instrument
establishes that it is safe to mock.

## What the suite is for afterwards

None of this changes a verdict. The suite passes and fails on the assertions
somebody wrote, and nothing here reaches a baseline or an exit code. What changes
is that the run stops being the only thing that knew, and a question nobody
thought to write down in advance has somewhere to be asked.

Then: [see what a test addressed](eyes.md), [watch a run that has not
finished](vantage.md), [trace a flake to its cause](flakiness.md).
