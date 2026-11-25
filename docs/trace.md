# Trace: a recorded test run on a time axis

`variance trace` draws one recorded test run as spans on a clock: the run, each
test file, the phases the runner spent in it, and the cases inside. It reads
the timing the [execution record](execution-record.md) already keeps, so it
needs no instrumentation and no second run, and any OpenTelemetry trace viewer
shows it as a waterfall. It is not Playwright's own trace viewer: that one
replays a single test's browser actions, and this one shows where a whole
run's time went. It needs a Playwright run recorded with the Playwright
integration; Jest and Vitest runs give an empty trace.

## What a trace shows, and what it does not

A trace is a tree of spans, shown here for a run of one file:

```
run
└─ tests/cart.spec.ts          file
   ├─ prepare                  phase
   └─ cases                    phase
      └─ the cart survives…    case
```

It has one trace id, a `run` span over every file with a start, and under it:

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

Install `@variance-authority/playwright-test` and `@variance-authority/cli`,
which provides `variance` (the
[install column](supported-frameworks.md#record-which-tests-ran-each-line) lists
each package), wrap `defineConfig` with `withTestSelection` as the Playwright
row of that table shows, then run:

```bash
npx playwright test
```

The run writes [the execution record](execution-record.md#where-the-file-is-and-what-to-do-with-it)
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

Nothing here needs Docker. The quickest start is a hosted backend, which needs
nothing on your machine; the local one is a downloaded binary.

### Honeycomb

Honeycomb is a hosted observability service that takes OTLP directly, and its
free tier is enough for this: make an account, create an API key, and send the
file with one `curl`. Not run here.

```bash
curl -X POST -H 'Content-Type: application/json' \
  -H "x-honeycomb-team: $HONEYCOMB_API_KEY" \
  --data @trace.json https://api.honeycomb.io/v1/traces
```

The key belongs to your environment: keep it in a secret and never in a
file. Use `api.eu1.honeycomb.io` for an account in the EU region.

### Jaeger on your machine

Jaeger is a free, open-source trace viewer (a CNCF project) that draws an
OpenTelemetry trace as a waterfall. It runs as a single binary, and it is only
the quickest viewer to run locally: any OTLP tool, such as Tempo, Honeycomb or
a Collector, opens the same file.

Download the archive for your system from
[Jaeger's releases](https://github.com/jaegertracing/jaeger/releases), named
`jaeger-<version>-<os>-<arch>.tar.gz` (`darwin`, `linux` or `windows`; `amd64`
or `arm64`), unpack it, and run the `jaeger` binary it holds. By default it
serves the UI on port 16686 and takes OTLP over HTTP on port 4318. Not run
here: the archive names are from the releases listing and the ports from
Jaeger's README, and I ran the same Jaeger in a container.

```bash
./jaeger
curl -X POST -H 'Content-Type: application/json' --data @trace.json http://localhost:4318/v1/traces
```

The receiver answers `200` when it took the document, and `http://localhost:16686`
is the UI. If you already run Docker, `docker run -p 16686:16686 -p 4318:4318
jaegertracing/jaeger` is the same Jaeger in a container.

### Grafana Tempo

Grafana Tempo is Grafana's open-source trace store, read through Grafana. Send
the same document to the OTLP HTTP receiver of your Tempo distributor,
`/v1/traces` on port 4318 unless you configured another. Grafana's Explore
opens it by trace id.

### An OpenTelemetry Collector

The OpenTelemetry Collector is the project's vendor-neutral relay: it receives
telemetry and forwards it to the backend you choose. Any Collector with an
`otlp` receiver on its HTTP protocol accepts the same
request, and its exporters forward the trace to whatever backend you run.

## Read the trace

**In Honeycomb**, open the dataset your key writes to, find the `run` span and
open it as a trace to see the waterfall. Honeycomb's interface was not seen
here, so its layout is not described.

**In Jaeger**, which was seen here running in a container, with its UI at
`http://localhost:16686`:

1. In **Service**, choose `variance`, then press **Find Traces**.
2. Open the trace named `variance: run`.

The trace opens as a timeline: a bar per span on one time axis, nested under
its parent, with the span's duration printed beside the bar and a minimap
above for zooming into one stretch.

- **The run** is the top bar, from the earliest file's start to the end of the
  last.
- **A file** is a row named after its path. Its bar starts at the clock time
  the runner started that file, so files that ran on parallel workers overlap
  and a file that waited for a worker starts later.
- **A phase** is a row under its file, `prepare`, `environment`, `setup`,
  `collect` or `cases`, laid end to end from the file's start. A file whose
  runner timed fewer phases has fewer rows.
- **A case** is a row under `cases`, in recorded order and not at its real
  start, as [Limits](#limits) says.

Click a row in Jaeger to open its span: the duration, the start time as an
offset from the run's start, and its tags, among them `code.filepath`, the
file's path.

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
