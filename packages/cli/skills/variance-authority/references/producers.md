# Connect the producer that owns a missing reading

Every command in this skill reads evidence and creates none of it. When a
reading, a field or a domain is unavailable, wire the package that produces it
and re-run the suite with the project's own runner. Treat the missing domain as
unknown until then, never as an empty reading.

## Eyes attention

The journal of what a test looked at and acted on, per phase.

- **Playwright.** Compose `eyesFixtures` from `@variance-authority/eyes/playwright`
  into the suite's existing extension, and add `@variance-authority/eyes/reporter`
  with an `archive` path to the config's reporters. The reporter folds every
  worker's journals into that archive. The fixture installs the React commit tap
  before navigation.
- **React Testing Library.** Start `watchTest` from `@variance-authority/eyes/rtl`
  in per-test setup. Publish its closed journal with `recordEyesTest` from
  `@variance-authority/eyes/collect`, and fold the run directory once in global
  teardown with `gatherEyesArchive` and `writeEyesArchive` from the same
  entrypoint. That pair writes the `eyes.json` that [distill](distill.md) reads.
  The React commit tap must be installed before `react-dom` loads.

In either host, declare `arrange`, `act` and `assert` with the adapter log's
`phase(...)`; do not infer them from query or click names. Read the README of
the installed `@variance-authority/eyes` before wiring either adapter.

## Runtime journey

`variance covering`, `variance_source_tests`, `variance_changed_tests` and
`variance_distill` need an `ExecutionIndex` with stable per-test ids. Under
Vitest, every run wrapped in `withTestSelection(config)` from
`@variance-authority/sense/vitest` writes one beside its snapshot, except a run
whose files run in a page. The test-selection snapshot is per test *file* and
cannot take its place. Any runner, debugger, editor integration or other
collector that records per-test crossings can supply the index instead.

## Live journey and events

Compose `varianceFixtures` from `@variance-authority/playwright-test`. Start
`variance watch` or `variance-authority-mcp --watch` first, then start the suite
with the exact `VARIANCE_AUTHORITY_VANTAGE` assignment it prints. The address
belongs to that watcher and that run. See [live run](live-run.md).

## Visual report

Run `variance run`. It writes the `RunReport` to the `report` path in
`variance.config.json`, default `.variance/report.json`, resolved against the
config file's own directory. Supply that file, not the configuration and not a
reconstructed comparison. The config is a JSON file named `variance.config.json`
in the directory you run from, or the file `--config <path>` names. Its required
keys are `project`, `profile`, `viewport`, `retention` and `subjects`, and its
schema ships at `@variance-authority/cli/schema`.

## Presentation reading

Call `sensePresentation` from `@variance-authority/presentation/playwright` on a
live subject and supply the `PresentationReport` it returns. A presentation
signal kept in a run report is a different, smaller reading.

## Scenario arrange and act

Use `@variance-authority/scenario` to record authored Arrange state and Act
transitions from semantic snapshots the host produces. Use its archive
entrypoint when those executions must outlive the process.
