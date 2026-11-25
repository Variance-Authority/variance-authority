# Trace: a recorded test run on a time axis

`variance trace` draws one recorded test run as spans on a clock: the run, each
test file, the phases the runner spent in it, and the cases inside. It reads
the timing the [execution record](execution-record.md) already keeps, so it
needs no instrumentation and no second run, and any OpenTelemetry trace viewer
shows it as a waterfall. It is not Playwright's own trace viewer: that one
replays a single test's browser actions, and this one shows where a whole
run's time went.

## What a trace shows, and what it does not

A trace is one trace id, a `run` span over every file with a start, and under
it:

- **a file span** per test file, from the moment the runner started the file
  to the end of its recorded cost;
- **a phase span** for each stretch the runner timed — `prepare`,
  `environment`, `setup`, `collect`, `cases` — laid one after another from the
  file's start, in the order the runner works through them;
- **a case span** per test, inside the `cases` phase.

The record keeps how long a case took and not when it began, so cases follow
one another inside `cases` in recorded order, even where the runner ran them
in parallel. Read a case's width as its duration and its position as an
approximation. A file the runner gave no start has no spans at all, because
placing it would be an invention. Only Playwright records a start today, so a
Jest or Vitest run prints an empty trace and says so on stderr.

## Record a run

Run your Playwright suite with the [Playwright integration](start-playwright.md)
and the run writes [the execution record](execution-record.md#where-the-file-is-and-what-to-do-with-it)
that `variance trace` reads. In CI, pass `coverageFile` to put the record at a
path you name and upload it as an artifact: the record carries the run's
timing and its cases, so there is no second file.

## Print the trace

```bash
variance trace --format otlp > trace.json
```

`--suite <name>` reads the record of one declared suite when the repository
has more than one. The command reads the record and prints; it runs nothing
and sends nothing. The output is a single JSON document, and printing and
sending are two steps.

## What OTLP is

OTLP is the OpenTelemetry Protocol, the wire format trace viewers and
collectors accept. `--format otlp` prints OTLP/JSON, which is the body of an
HTTP `POST` to a receiver's `/v1/traces` path, conventionally on port 4318.
Everything under [where to put it](#where-to-put-it) is that one request sent
to a different address.

## Where to put it

### Jaeger on your machine

```bash
docker run -d --rm --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one
curl -X POST -H 'Content-Type: application/json' --data @trace.json http://localhost:4318/v1/traces
```

Open `http://localhost:16686`, choose the service `variance`, and the run is
one trace. The receiver answers `200` when it took the document.

### Grafana Tempo

Send the same document to the OTLP HTTP receiver of your Tempo distributor,
`/v1/traces` on port 4318 unless you configured another. Grafana's Explore
opens it by trace id.

### Honeycomb

```bash
curl -X POST -H 'Content-Type: application/json' \
  -H "x-honeycomb-team: $HONEYCOMB_API_KEY" \
  --data @trace.json https://api.honeycomb.io/v1/traces
```

The key belongs to your environment: keep it in a secret and never in a
file. Use `api.eu1.honeycomb.io` for an account in the EU region.

### An OpenTelemetry Collector

Any Collector with an `otlp` receiver on its HTTP protocol accepts the same
request, and its exporters forward the trace to whatever backend you run.

## In CI

The record is what CI already carries: upload it as an artifact, as [Record a
run](#record-a-run) says, and run `variance trace` anywhere that holds it.
Sending the trace to a backend from the job itself is not built: the action
has no input for it, and no `variance` command posts a trace. Until it does,
the `POST` above is yours to run from a machine that reads the artifact.

## Limits

- Playwright only. Another runner's record has no start.
- Cases are laid out in recorded order, not at their real start.
- The trace covers the run's own clock. The processes a test reached, the
  [journeys](journeys.md), hold regions reached and no timing, so they have no
  spans.
