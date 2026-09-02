<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/wire

> Distributed tracing for one test run, collapsed to a cookie.
>
> One id per execution, one address to answer on, and nothing written down.

Two instruments talk to a run while it happens.
[`@variance-authority/event`](../event/README.md) says what the code decided, so
a test waits for a decision instead of guessing when it was made.
[`@variance-authority/sense/journey`](../sense/README.md#follow-one-execution-into-a-service)
says which regions of source an execution entered, so the next run can narrow.
They are different questions with the same three answers, and this package is
those three answers and nothing else. A driver listens, a participant answers,
and neither one has to know which realm the other is in.

```bash
npm install @variance-authority/wire
```

You do not install it on purpose. It arrives under whichever instrument you did
install, and it is documented because the properties below are the ones both of
them rest on.

## One medium, whatever the realm

A participant does not know where it is running and must not have to. The page is
in the browser. A service is another process. A server the suite started
in-process is neither, and it is the case every design that assumes a socket gets
wrong. So `channelFrom(cookieHeader)` resolves the way home from the realm it
finds itself in:

1. A **carrier** on `globalThis` (`WIRE_SINK`), installed by the driver. That is
   the page, and it is equally a process the driver started itself: the report is
   a function call, and there is no hop.
2. A **return address** (`RETURN_COOKIE`), which the driver left on a cookie and
   the request carried in. That is a service in another process: the report is a
   POST to loopback.
3. Neither, which is a request the run did not drive. It reports to nobody, which
   is honest and is not an error.

The caller writes one line for all three:

```ts
import { channelFrom } from '@variance-authority/wire';

declare const decided: { readonly action: string };

export function handled(cookie: string | undefined): void {
  channelFrom(cookie)?.report('events', decided);
}
```

`JOURNEY_COOKIE` carries the execution and `RETURN_COOKIE` carries the address,
side by side rather than one inside the other: a head that only announces should
not have to parse a coverage key to find its way home. A `Channel` exposes the id
as `journey`, so a participant that wants to say *which* execution it is
reporting for reads it from the same place it got the channel.

Only loopback `http` addresses are accepted. The address is written by whoever is
talking to the process, so a participant that posted wherever a cookie said would
be a way to make it fetch an address somebody else chose, rather than an
instrument. `channelTo(origin, journey)` is the same channel for a participant
that was **handed** an address rather than sent one — a test run reporting to a
watcher reads it from its own environment — and it refuses the same addresses for
the same reason. It goes to that address rather than through `channelFrom`,
because a driver has a carrier of its own installed and would otherwise prefer
its own desk.

`Participant` is what the driver routes on and the only thing it reads out of a
report. `events` and `journeys` are the two instruments above. `run` is the one
that talks the other way: a run is a participant too when something is watching
it — the same three answers, with the suite reporting and a watcher listening
instead of the other way around. That is
[`@variance-authority/vantage`](../vantage/README.md), and it needed no new
medium.

## Two guarantees, on purpose

`report` is fire-and-forget. `deliver` is acknowledged, retried, and rejects when
it finally cannot. That is not a convenience: the two instruments fail in
opposite directions.

A lost **announcement** is a wait that times out and prints everything it did
hear — loud, in the driver, in front of somebody who is already reading a
failure. A lost **coverage account** is a test skipped on the next run: silent,
and wrong in the direction that hides a defect. So one of them is allowed to
disappear and the other is not, and a caller that loses a `deliver` owes the run
a sentence, because nothing downstream can tell an account that was never sent
from a process that did nothing.

Reports on one channel keep their order. It is the only ordering property
anything above here rests on, and it is the one a wait needs: *started* has to
arrive before *ended*.

Nothing is written down. There is no report directory, no file to clean up, and
no artifact to mistake for evidence later — a message that is worth something for
the length of one execution is worth nothing after it.

## The driver's end, from `@variance-authority/wire/listen`

Written by hand only where the driver is not
[`@variance-authority/playwright-test`](../playwright-test/README.md), which
holds a listener per worker and hands both instruments their end of it.

```ts
import { listen } from '@variance-authority/wire/listen';

const wire = await listen();
wire.on('events', (journey, body) => console.log(journey, body));

const address = wire.addressFor('some-execution-id');
```

`listen` takes one address per driver process on an ephemeral loopback port, so
nothing is agreed in advance and several workers listen at once without a word
between them. `ListenOptions` takes `host`, defaulting to `127.0.0.1`.
`addressFor` hands out one address per execution, `on` registers one handler per
participant and returns the call that gives it up, and `close` stops listening
without waiting for a participant that is mid-sentence. `origin` is where the
listener is, without an execution in it — what to give a participant that will
name its own executions as it goes, rather than one the driver minted a key for
in advance.

**The execution id is in the address, never in the body.** A participant repeats
nothing it was told, and the driver reads back the key it minted itself — so a
report cannot claim an execution by writing one down. A body the listener cannot
parse is answered as a refusal rather than thrown on, which is how a participant
that acknowledges its reports learns it lost one.

`wire.carrier` is the same desk for a realm the driver is inside rather than
beside, and `installCarrier(carrier)` puts it on the global. A suite that starts
its server in-process configures nothing extra and loses nothing: the report is a
call, and the socket is never touched. It is preferred over an address wherever
both exist, so a realm never talks to itself over a socket.

`wireCarrierSource()` returns the source a driver evaluates in a page before
navigation, and `WIRE_REPORT` is the name it calls back on. It reads the
execution off the document's own cookie, so a page reports under the same
execution as a service behind it; anything said before the driver's function
exists is held rather than dropped, because the first decision of the first
script is exactly the one a test most wants.
