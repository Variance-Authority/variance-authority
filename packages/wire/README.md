<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/wire

> How a process under test answers the run that started it: one id per
> execution, one address to answer on, and nothing written down.

Part of [Variance Authority](https://variance-authority.dev), which retains what
a test run knows — what it rendered, which code it entered, what the workspace
exposes — so the next question is answered from the record, not another run.

## What this is for

You arrive here for one of two reasons.

**A report went missing.** Your server announces what it decided, or accounts
for which source an execution entered, and the run heard none of it. The
resolution order and the status codes below are the two places that answer why.

**You are writing a driver that is not
[`@variance-authority/playwright-test`](https://variance-authority.dev/reference/packages/playwright-test).** That
package already holds a listener per worker and wires both instruments to it,
so you never touch this package while you use it. For a different runner, a
watcher, or a harness of your own, this is the whole medium: one listener, one
address per execution, three functions.

Words this project coined, which you need for the rest of the page:

| Word | What it names |
| --- | --- |
| driver | The process running the tests. It listens; everything else reports to it. |
| execution | One run of one test, named by a UUID the driver mints. Every report is filed under one. |
| realm | Where the reporting code happens to be: a browser page, another process, or the driver's own process. |
| carrier | A function on `globalThis` that takes a report, installed by a driver in a realm it is inside. |
| instrument | One of the three things that report. `@variance-authority/event` says what the code decided; `@variance-authority/sense/journey` says which source an execution entered; a run being watched reports on itself. |

The `Participant` type is not a process — it names which of those three
instruments is speaking, and it is the only thing the driver routes on:
`'events' | 'journeys' | 'run'`. It is a closed union; adding a fourth means
changing this package.

## Requirements

Node 22 or newer. ESM only (`"type": "module"`) — there is no CommonJS entry
point. No dependencies and no peers.

| Entry point | Runs in | Imports |
| --- | --- | --- |
| `@variance-authority/wire` | Any realm — page, service, driver | Nothing. Uses global `fetch`. |
| `@variance-authority/wire/listen` | Node only | `node:http` |

Bundling the root entry into a page pulls in no server: it imports no module at
all, `node:` or otherwise. Keep `/listen` on the driver's side.

## See a report go end to end

```bash
npm install --save-dev @variance-authority/wire
```

Both halves fit in one file. The listener is the driver's end; `channelFrom` is
what a process under test calls. Save as `wire-demo.mjs` and run it with
`node wire-demo.mjs`:

```js
import { channelFrom, JOURNEY_COOKIE, RETURN_COOKIE } from '@variance-authority/wire';
import { installCarrier, listen } from '@variance-authority/wire/listen';

// The driver's end.
const wire = await listen();
wire.on('events', (execution, body) => console.log('events', execution, body));

// What the driver puts on the page's cookie jar, and what a request carries
// back in. A real driver mints this id with randomUUID and sets both cookies.
const execution = 'bbb3b0c4-4298-4f1b-9ca9-7a0d0f0a0001';
const cookie = `${JOURNEY_COOKIE}=${execution}; ${RETURN_COOKIE}=${wire.addressFor(execution)}`;

// A service in another process: this reports over a POST to loopback.
const channel = channelFrom(cookie);
console.log('journey', channel.journey);
await channel.deliver('events', {
  version: 1,
  head: 'checkout',
  phase: 'end',
  location: 'CheckoutScreen',
  subject: 'order',
  action: 'placed',
});

// The same line, in a server the suite started inside itself. The carrier wins
// over the address, so this report is a function call and the socket is never
// touched — the case every design that assumes a socket gets wrong.
const uninstall = installCarrier(wire.carrier);
await channelFrom(cookie).deliver('events', {
  version: 1,
  head: 'checkout',
  phase: 'once',
  location: 'CheckoutScreen',
  subject: 'receipt',
  action: 'shown',
});
uninstall();

await wire.close();
```

### What you get

```
journey bbb3b0c4-4298-4f1b-9ca9-7a0d0f0a0001
events bbb3b0c4-4298-4f1b-9ca9-7a0d0f0a0001 {
  version: 1,
  head: 'checkout',
  phase: 'end',
  location: 'CheckoutScreen',
  subject: 'order',
  action: 'placed'
}
events bbb3b0c4-4298-4f1b-9ca9-7a0d0f0a0001 {
  version: 1,
  head: 'checkout',
  phase: 'once',
  location: 'CheckoutScreen',
  subject: 'receipt',
  action: 'shown'
}
```

Both reports arrived at the same handler under the same execution, and the
handler cannot tell which realm either came from. That is the whole product.

## What goes in a body

Any JSON-serialisable value. This package imposes no schema and no size limit;
it calls `JSON.stringify` on the way out and `JSON.parse` on the way in, and a
body that fails to parse is refused rather than passed on. The shape is the
instrument's business, not the medium's. The three that ship look like this.

`events` — one thing the code decided, from `@variance-authority/event`. `head` is the
name the reporting process answers to; `subject` and `action` are the words the
announcing code used, not this package's:

```json
{ "version": 1, "head": "checkout", "phase": "end", "location": "CheckoutScreen", "subject": "order", "action": "placed" }
```

`journeys` — one account of what a request entered, from
`@variance-authority/sense/journey`, abridged to two modules. `scope` is
`"journey"` for what this execution entered and `"process"` for module
initialisation that belongs to every execution; `lost` appears only after a
delivery failed and is the count so far:

```json
{
  "version": 1,
  "instrumentation": "f1c0…",
  "head": "checkout",
  "scope": "journey",
  "modules": [
    { "id": 12, "hits": [0, 3, 4], "shared": [0] },
    { "id": 41, "hits": [7], "shared": [] }
  ]
}
```

`run` — one thing that happened to a test, from
[`@variance-authority/vantage`](https://variance-authority.dev/reference/packages/vantage), reported by the suite to
a watcher:

```json
{ "version": 1, "kind": "opened", "title": "places an order", "file": "checkout.spec.ts", "worker": 0 }
```

## How a process under test finds its way home

`channelFrom(cookieHeader)` resolves a channel out of the realm it is called in,
in this order. The caller writes one line and gets whichever applies:

| Order | What it looks for | How the report travels |
| --- | --- | --- |
| 1 | A carrier on `globalThis.__VAW__`, installed by the driver | A function call. No hop, no socket. This is a page, and equally a server the suite started in-process. |
| 2 | A return address on the `variance-authority-return` cookie the request carried | `POST http://127.0.0.1:<port>/<execution>/<participant>` |
| 3 | Neither | `undefined`. The request was not driven by a run, and reporting to nobody is not an error. |

```ts
import { channelFrom } from '@variance-authority/wire';

// Excerpt: `cookie` is the request's own Cookie header — in Node,
// request.headers.cookie; in a framework, whatever it calls the same string.
export function announce(cookie: string | undefined, decided: unknown): void {
  channelFrom(cookie)?.report('events', decided);
}
```

The execution id rides on its own cookie beside the address rather than inside
it, so a process that only announces never has to parse an address to find its
id. A `Channel` exposes the id as `journey`, so code that wants to say which
execution it is reporting for reads it from the same object it got the channel
from.

`channelTo(origin, journey)` is the same channel for a process that was handed
an address rather than sent one — a suite reporting to a watcher reads the
origin out of its own environment. It skips the carrier lookup on purpose: a
driver has a carrier of its own installed, and resolving through `channelFrom`
would route the run's reports back to itself. It applies the same address guard.

The four names are exported values, not conventions to retype:

| Export | From | Value |
| --- | --- | --- |
| `WIRE_SINK` | `@variance-authority/wire` | `'__VAW__'` — the global the carrier is installed on |
| `JOURNEY_COOKIE` | `@variance-authority/wire` | `'variance-authority-journey'` |
| `RETURN_COOKIE` | `@variance-authority/wire` | `'variance-authority-return'` |
| `WIRE_REPORT` | `@variance-authority/wire/listen` | `'__VAW_REPORT__'` — the function a driver exposes in a page |

## `report` and `deliver`

```ts
interface Channel {
  readonly journey: string | undefined;
  readonly report: (participant: Participant, body: unknown) => void;
  readonly deliver: (participant: Participant, body: unknown) => Promise<void>;
}
```

`report` returns immediately and swallows every failure, including a driver that
has already exited. Use it where a lost message surfaces as a loud timeout in
front of somebody already reading a failure.

`deliver` resolves when the driver has taken the body and rejects when it cannot.
Over a socket that is **three attempts**, with a 20 ms pause after the first and
40 ms after the second; it rejects with the last error, which for a refusal
reads `Error: http://127.0.0.1:53154/<execution>/journeys answered 404`. Through
a carrier there is no retry: `deliver` awaits whatever the carrier returned and
rejects with whatever it threw. Use it where a lost message is silent and wrong
in the direction that hides a defect — an account of what a request entered,
lost, is a test skipped on the next run, so a caller that loses one owes the run
a sentence.

Ordering is per address and instrument: reports you make for `events` under one
execution arrive in the order you made them, which is what a wait needs —
*start* before *end*. Two channels resolved for the same execution share that
chain; two instruments do not, so an `events` report and a `journeys` report
have no order between them. Through a carrier a report is a direct call, so the
order is your call order.

Nothing is written down. There is no report directory and no file to clean up.

## The driver's end, from `@variance-authority/wire/listen`

```ts
import { listen } from '@variance-authority/wire/listen';

const wire = await listen();
```

| Member | What it gives you |
| --- | --- |
| `origin` | `http://127.0.0.1:53154` — where this listener is, with no execution in it. Give it to something that will name its own executions as it goes. |
| `addressFor(journey)` | `http://127.0.0.1:53154/bbb3b0c4-…` — one address per execution. Put it on `RETURN_COOKIE`. |
| `on(participant, handler)` | Takes one instrument's reports; returns the call that gives them up. One handler per instrument — a second `on` replaces the first. |
| `carrier` | The same listener as a plain function, for a realm the driver is inside. Pass it to `installCarrier`, or expose it in a page. |
| `close()` | Stops listening and drops open connections. |

`listen` binds an ephemeral port, so nothing is agreed in advance and several
workers listen at once without a word between them. Each worker has its own
listener and its own port, and a process under test never has to know which one
it is talking to: the address arrived on the cookie the driver set for that
execution. `ListenOptions` takes `host`, defaulting to `127.0.0.1` — anything
outside loopback makes `addressFor` hand out an address that `channelFrom`
refuses, and reports stop arriving.

The listener never reads an execution id out of a body. It reads back the key it
minted itself, out of the path, so a report cannot claim an execution by writing
one down.

### When a report does not arrive

Three answers, and they are distinguishable:

| The listener answers | Because |
| --- | --- |
| `204` | Taken. A handler for that instrument had it. |
| `404` | No `on` handler for that instrument, or the body would not parse, or the path had no execution in it. |
| Connection refused | The listener is closed, or the port belongs to a worker that has finished. |

`report` shows you none of these; `deliver` rejects with the status. If a
process under test is silent, check in this order: whether `channelFrom` returned
`undefined` at all (no carrier and no return cookie), whether the address on the
cookie is loopback `http` (anything else resolves to `undefined` and sends
nothing), and whether the driver called `on` for that instrument before the
report landed.

### Reading back, with `answer`

A listener is somewhere to report *to*. Pass `answer` and it also serves `GET`
on its own origin — one address, not two, and reading is separated from
reporting by method rather than by path, so a reader's surface cannot collide
with an execution id:

```js
import { listen } from '@variance-authority/wire/listen';

const released = new Set();
const wire = await listen({
  answer: (path) => (path.startsWith('/waiting/') ? released.has(path.slice(9)) : undefined),
});

console.log(wire.origin);
console.log(await fetch(`${wire.origin}/waiting/t1`).then((r) => [r.status, r.headers.get('content-type')]));
console.log(await fetch(`${wire.origin}/waiting/t1`).then((r) => r.json()));
console.log((await fetch(`${wire.origin}/elsewhere`)).status);
await wire.close();
```

```
http://127.0.0.1:53154
[ 200, 'application/json' ]
false
404
```

Whatever the handler returns is `JSON.stringify`d with `content-type:
application/json`; returning `undefined` is a `404`, which is how the handler
declines a path. A listener with no `answer` answers `404` to every `GET`.
That is the shape a stopped run polls when a watcher is holding it — see
[`@variance-authority/vantage`](https://variance-authority.dev/reference/packages/vantage).

### The page's half

`wireCarrierSource()` returns source for a driver to evaluate in a page before
navigation — a string, because it has to run before the page has a module graph.
In Playwright that is `page.addInitScript(wireCarrierSource())`, paired with
`page.exposeFunction(WIRE_REPORT, …)`. Exactly this, and nothing else:

```js
(() => {
  const held = [];
  const journey = () => {
    const found = /(?:^|;\s*)variance-authority-journey=([^;]*)/.exec(globalThis.document?.cookie ?? '');
    return found === null ? undefined : decodeURIComponent(found[1]);
  };
  globalThis["__VAW__"] = (id, participant, body) => {
    const report = globalThis["__VAW_REPORT__"];
    const said = { journey: id ?? journey(), participant, body };
    if (typeof report !== 'function') {
      held.push(said);
      return;
    }
    while (held.length > 0) report(held.shift());
    return report(said);
  };
})();
```

It reads the execution off the document's own cookie, so a page reports under
the same execution as a service behind it. The two halves install in either
order: anything said before the driver's function exists goes into `held` — no
cap, nothing dropped — and is released in order the first time the function is
there. `held` lives with the document, so a navigation before the function
arrives takes the backlog with it.

## What this does and does not guard

**Outbound.** An address read off a cookie or an environment variable is
accepted only if it is `http:` and the host is `127.0.0.1`, `localhost` or
`::1`. Anything else makes `channelFrom` and `channelTo` return `undefined`, and
nothing is sent. That check runs in whichever process resolves the channel — the
service, not the driver — which is what keeps an instrument from becoming a way
to make your server fetch an address somebody else chose.

**Inbound.** The listener has no authentication. It binds loopback, and anything
on the machine that knows the port and the execution id can POST a report; the
id is a v4 UUID the driver mints and never writes to disk. Responses carry no
CORS headers, so a browser refuses to read one cross-origin, but a `no-cors`
POST would still reach the listener. What that buys is a fabricated report
inside one run: nothing posted here is executed, and nothing is written to disk.
Passing a non-loopback `host` widens that to the network, and stops reports
arriving anyway.

`close` drops open connections rather than draining them, so a run that has
finished leaves whether or not something is still talking. There is no flush: a
`deliver` in flight when you close rejects. Await what you care about first.

---

**[@variance-authority/wire](https://variance-authority.dev/reference/packages/wire)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
