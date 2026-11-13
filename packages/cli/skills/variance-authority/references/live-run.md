# Ask a suite that is still running

A finished run left a file. A suite that is still running has not, and what it
reports exists only in the process that was listening at the time. So start the
listener first, in its own shell.

That listener is a **vantage**: one process that keeps one run in memory and
answers at the address it prints. `VARIANCE_AUTHORITY_VANTAGE` passes that
address to the suite's environment.

```bash
variance watch                     # prints VARIANCE_AUTHORITY_VANTAGE=…, stays up
```

```
variance-authority is watching. Start the suite with this in its environment:

  VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:64655

Ask it, from any other shell, with the same address:

  variance ask self --at http://127.0.0.1:64655

It holds the run in memory and writes nothing down. Stop it and the run is gone.
```

`watch` reads no config and can be started in any directory. Start the suite
with that exact assignment in its environment; an address added after the suite
started belongs to the next run. Then ask from any shell that can connect to
it. A question only the watcher answers reads no config; `diff` also reads a
finished run, and needs a `variance.config.json` or a `--config <path>`.

```bash
variance ask self         --at "$VARIANCE_AUTHORITY_VANTAGE"  # where it listens, what it has
variance ask run-signals  --at "$VARIANCE_AUTHORITY_VANTAGE"  # tests in opening order
variance ask waiting      --at "$VARIANCE_AUTHORITY_VANTAGE"  # tests stopped at variance.observe()
variance ask test-signals --at "$VARIANCE_AUTHORITY_VANTAGE" --test <id>
variance ask diff         --at "$VARIANCE_AUTHORITY_VANTAGE"  # what changed since the last reading
variance ask ran          --at "$VARIANCE_AUTHORITY_VANTAGE"  # what an application used by hand ran
```

## Ask `self` first

`self` answers before any run has arrived:

```
Nothing has reported to this vantage yet.

A run reports here when it is started with this in its environment:

  VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:64655

That is the same env block `VARIANCE_AUTHORITY_EVENTS` goes in. The suite needs `varianceFixtures` from `@variance-authority/playwright-test` and nothing else — a test that takes no screenshot reports exactly what one that does reports, and a run started without the variable pays nothing.
```

A suite reporting to a different address and a suite that never started look
the same to every other question, and both look like a quiet run. An empty
announcement list for a listed test is a wiring or application signal. It is
not permission to reconstruct a trace from source.

## Ask what an application ran

`ran` is about an application somebody uses by hand, not a suite. The
application reports when its build placed the probes, its request handler runs
inside `collectJourneys().enter` from `@variance-authority/sense/journey`, and
it was started with `VARIANCE_AUTHORITY_JOURNEYS=1` and the same
`VARIANCE_AUTHORITY_VANTAGE` assignment: the first turns the reporting on, the
second says where it goes. Each request no test drove is one execution.

Where a framework owns the request and no handler can be wrapped, the
application hands its Sentry or OpenTelemetry SDK to the head instead:
`collectJourneys({ trace: sentry(Sentry) })` or `openTelemetry(api)`, with the
same two variables. The listing is then one execution per trace, named by the
trace id. A browser SDK that propagates its trace makes that one per page view,
with every request the page made listed together.

A page reports too when its build placed the probes and it calls
`reportPage(address)` from `@variance-authority/sense/page`, with the address
`variance watch` printed. Each load is then one execution with a `head page`,
and so is each click or submit; a click and the submit it causes are one. A
server the click reached is a second head under the same id. A request sent
after the next click is listed under that later click, and the request for a
document under the last execution of the page it replaces.
Without the call, nothing the browser ran is listed. The call installs nothing
for an address that is absent or not `http` on this machine, or on a page a
test drives.

```bash
variance ask ran --at "$VARIANCE_AUTHORITY_VANTAGE"
variance ask ran --at "$VARIANCE_AUTHORITY_VANTAGE" --name quote --limit 1
```

| Flag | Narrows to |
|---|---|
| `--name <name>` | executions that ran a region of that name: a declaration, or one segment of `Cart/render` |
| `--limit <n>` | the `n` most recent; 20 by default |
| `--story` | nothing; prints each execution as a story instead of its regions |

Executions are listed oldest first, so the request just made is the last one.
`▸` marks one a process still holds open. Each region is `file:line name`,
followed by its branch. What a process ran outside every request, or while a
module loaded, is listed once after them, narrowed by the same flags, with the
regions past the fortieth counted. `--limit` does not narrow a `--name` search:
every execution is read for the name.

`--story` (MCP: `story: true`) needs a server head started with
`VARIANCE_AUTHORITY_STORY=1` as well. Each execution is then its steps in the
order they ran, each `file:line name` with its branches, and under each entry
`» handed name=value`, the arguments only: no local or module variable is
shown. Concurrent requests are taped apart. An execution told again lists what
ran since under `told again`. A head without the variable tells no story, and
the answer says so and lists regions. A `head page` tells none yet.

A region arrives as a number and is named from the checkout `ask` runs in, so
ask from the repository the application was built from. A module whose regions
cannot be named is counted, with the reason:

| Reason | What to do |
|---|---|
| the file has changed since the application was built | rebuild the application, then repeat the request |
| the file is not in this checkout | ask from the repository the application was built from |
| numbered by an instrumentation this build does not read | install the CLI version the application was built with |
| its build placed no probe in it | nothing; the module is known only to have loaded |

A request a test drove answers that test's run and is not listed. The watcher
keeps the 200 newest executions and the answer counts what it dropped. Never
fill a missing execution in from source.

## Nothing is written down

Stop the watcher and the run is gone. Once the process is gone, the question
belongs to a retained file, not to a reconstruction. To wire a suite that sends
nothing, read [producers](producers.md).
