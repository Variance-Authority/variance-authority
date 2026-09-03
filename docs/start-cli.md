# Run an existing collector through review

Use this path when a collector module already owns subject planning, acquisition,
and readiness. The CLI checks the selected environment, runs the collector,
writes one report, promotes reviewed candidates, and returns the exit code CI
reads.

## Before you run

The collector must default-export the CLI collector factory and return one
result or named refusal for every planned subject. This example uses a local
Chromium renderer and a durable directory store:

```bash
npm install --save-dev @variance-authority/cli
npx playwright install chromium
```

Point the config at the existing module. With `subjects.kind: "collector"`, the
module owns its inventory as well as acquisition:

```json
{
  "project": "checkout-ui",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": { "kind": "collector", "collector": "variance/collector.mjs" },
  "baselines": { "kind": "directory", "root": ".variance/baselines" },
  "fonts": [],
  "report": ".variance/report.json"
}
```

The CLI does not start an application or invent a ready condition. Start any
service the collector requires before continuing.

## Run, inspect, accept, rerun

Run `doctor` in the same machine or CI image as the comparison:

```bash
npx variance doctor --config variance.config.json
npx variance run --config variance.config.json
```

The first successful durable run exits `1` because each subject without an
approved baseline is `new`. An operator, collector, browser, or store failure
exits `2`; it is not a visual verdict.

Render the report beside `.variance/report.json`, then open it and copy the exact
id of the intended candidate:

```bash
npx variance report --config variance.config.json --format html > .variance/report.html
```

For a report containing `checkout/empty`:

```bash
npx variance accept --config variance.config.json checkout/empty
npx variance run --config variance.config.json
```

`accept` promotes the image and sidecar from the reviewed run; it never renders
a replacement. The rerun exits `0` when the subject is `unchanged` and nothing
else requires review. Keep `accept --all` out of unattended workflows: it cannot
distinguish a reviewed subject from one nobody opened.

## Go deeper

Read [baseline placement](placement.md) before moving baselines to Git LFS or a
remote store, and [composition](composition.md) before folding observations into
policy. The [`@variance-authority/cli` reference](../packages/cli/README.md) owns
the full config, command, exit, selection, reporting, and CI contracts. If the
collector itself does not exist yet, start with the integration chooser in
[the first-observation guide](start.md).
