# Ask a suite that is still running

A finished run left a file. A suite that is still running has not, and what it
reports exists only in the process that was listening at the time. So start the
listener first, in its own shell.

That listener is a **vantage**: one process that keeps one run in memory and
answers at the address it prints. `VARIANCE_AUTHORITY_VANTAGE` passes that
address to the suite's environment. The value is both the opt-in and the name of
this watcher, so there is no fixed port to hard-code; a fixed port would not
remove the need for the opt-in.

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
started belongs to the next run. Then ask from any shell that can connect to it
and that has a `variance.config.json` or a `--config <path>`: `ask` loads a
config for these questions too, and never reads it.

```bash
variance ask self         --at "$VARIANCE_AUTHORITY_VANTAGE"  # where it listens, what it has
variance ask run-signals  --at "$VARIANCE_AUTHORITY_VANTAGE"  # tests in opening order
variance ask waiting      --at "$VARIANCE_AUTHORITY_VANTAGE"  # tests stopped at variance.observe()
variance ask test-signals --at "$VARIANCE_AUTHORITY_VANTAGE" --test <id>
variance ask diff         --at "$VARIANCE_AUTHORITY_VANTAGE"  # what changed since the last reading
```

`--at <address>` names the watcher and defaults to `VARIANCE_AUTHORITY_VANTAGE`.

## Ask `self` first

`self` answers before any run has arrived:

```
Nothing has reported to this vantage yet.

A run reports here when it is started with this in its environment:

  VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:64672

That is the same env block `VARIANCE_AUTHORITY_EVENTS` goes in. The suite needs
`varianceFixtures` from `@variance-authority/playwright-test` and nothing else.
```

A suite reporting to a different address and a suite that never started look
the same to every other question, and both look like a quiet run. An empty
announcement list for a listed test is a wiring or application signal. It is
not permission to reconstruct a trace from source.

## Nothing is written down

Stop the watcher and the run is gone. The suite must extend `varianceFixtures`
from `@variance-authority/playwright-test` for any of it to arrive. Once the
process is gone, the question belongs to a retained file, not to a
reconstruction.

A watcher failure must not fail the suite it watches: a watcher that was not
there changes nothing about what the suite did.

Do not add active page callbacks, event replay or browser control to answer an
inspection question. Those are different capabilities and need an explicit
product decision.
