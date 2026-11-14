# @variance-authority/vantage

## 0.33.0

### Minor Changes

- 08f6331: `variance ask ran --story` shows what each function of a live execution was handed

  A server head started with `VARIANCE_AUTHORITY_STORY=1`, beside `VARIANCE_AUTHORITY_JOURNEYS` and a watcher, now tapes each execution it reports to the watcher and sends its story with the account: the functions entered in order, their branches, and `» handed name=value` for the arguments each was handed, spelled as a test story spells them. It shows arguments only, never a local or module variable. Two requests that run at once are taped apart, and a request whose promises run on after it settled is told again with only what it ran since. Without the variable nothing is taped and nothing changes.

  `variance ask ran --story` (`variance_ran` with `story: true`) prints those stories in place of each execution's regions, a step drawn as `variance story` draws it, with what the tape lost said above it. Asked of heads that told none, it says no head was started with `VARIANCE_AUTHORITY_STORY=1` and lists the regions as before. A page that calls `reportPage` tells no story yet.

  `variance ask` takes a true-or-false tool argument as a bare flag. The watcher keeps the first 8 stories a head sent of an execution, up to 1 MiB, as `stories` on that head, and counts the rest as `untold`. `@variance-authority/sense/story` exports the reading `variance story` draws a route by, so both draw a step the same way.

## 0.32.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.32.0

### Minor Changes

- 12e277d: `variance ask ran --at <address>` and the MCP tool `variance_ran` list what an application used by hand ran: one execution per request no test drove, each with the regions it ran as `file:line name`.

  An application reports when its build places the probes, its request handler runs inside `collectJourneys().enter`, and it is started with `VARIANCE_AUTHORITY_JOURNEYS=1` and the watcher's address in `VARIANCE_AUTHORITY_VANTAGE`. A head given an address that is not an http address on this machine refuses to start; an empty address is read as none. `--name` and `--limit` narrow the listing, and `variance ask self` counts the executions a watcher holds.

  A question only a watcher answers (`self`, `run-signals`, `test-signals`, `waiting`, `ran`) no longer reads `variance.config.json`, so it can be asked where no visual suite was configured.

## 0.31.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.30.0

### Patch Changes

- edc6d7d: The README and the skill print `variance`, the command a package manager runs from the install, where they printed a runner that fetches another package when the install is missing.

## 0.29.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.28.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.27.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.26.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.25.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.24.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.24.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.23.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.22.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.21.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.20.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.19.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.18.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.16.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.15.0

### Patch Changes

- ef496ad: READMEs name what the program does

  The package READMEs, and the `@variance-authority/vantage` and
  `@variance-authority/playwright-test` descriptions, no longer write a test, a
  record or a run as something that says, asks or knows. Each sentence names what
  the program does: a command prints, a record holds a field, a test runs or
  covers. Where a value is filled in from configuration or a default rather than
  recorded, the README says so. Four renamed headings change their anchors:
  `help`'s "Where the declaration is undocumented", `playwright`'s "Where a
  component is declared, read from the engine", `storybook`'s "What a pass sends
  the preview" and `sense`'s "Correct what a file's text declares it imports".

## 0.14.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.13.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.12.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.11.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.10.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.9.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.7.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.6.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.10

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.9

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.8

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.7

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.6

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.5

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.4

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.3

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.2

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.3.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.2.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

### Minor Changes

- a87d008: Hold what a running suite is saying in a process an agent can ask, so a test in
  flight is something to look at rather than something to wait for.

  A suite already knows what nothing outside it can see: which realms answered and
  in what order, which work began and never finished, that a service is plainly
  talking while the test hearing it hears nothing. All of it is spent settling
  waits and then discarded, so nobody can ask it while it is true. A runner's
  timeout reports what a test *wanted* — the last thing the failure knows and the
  first thing the reader already knew.

  `@variance-authority/vantage` is the second reader. A watching process listens,
  the run reports, and the signals live in memory that outlives the test.
  `variance-authority-mcp --watch` is that process for an agent: it prints the one
  line the suite has to be started with, then answers `variance_run_signals` for
  where the run has got to and `variance_test_signals` for everything one
  execution has heard, in order, with the realm that said each and the work that
  started and never ended. Both answer while the test is still running, which is
  the point.

  The address is in the handshake, not only on stderr. A `Served` may carry
  `instructions`, and the watching one does: a set of tools about a run nobody has
  started yet reads as broken, and an agent told the variable after it has started
  the suite has been told one run too late.

  None of it is about visual regression. A test that takes no screenshot reports
  exactly what one that does reports, and a run started without
  `VARIANCE_AUTHORITY_VANTAGE` pays one environment read per worker.

  The medium is the wire the announcements already travel: one participant, `run`,
  and `channelTo` for a participant handed an address rather than sent one.
  `createEventLog` takes `onRecord` and `onRemark`, called at the moment of
  recording rather than at teardown — an answer that arrives when the test
  finishes answers a different question. `varianceWatched` is automatic so a
  listing has no holes.

  Still nothing written down. There is no report directory and no artifact to
  mistake for evidence later; what changes is only how long one execution lasts
  when somebody is watching.
