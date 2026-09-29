# Spec 0089 — this repository reports every kind of suite it runs

**Missing:** the whole capability. The root `variance.config.json` declares one
suite, `unit`, carried by `actions-cache`, and the coverage comment on a pull
request compares only that one (`.github/workflows/check.yml`, the `coverage`
step, `--suite unit --against "$AGAINST"`). The repository also runs a visual
suite on every pull request and every push to `main` — the gate in
`.github/workflows/variance.yml` over `cases/storybook-case` — and records
nothing of what its stories executed. No job runs an e2e suite through
`@variance-authority/playwright-test`, so there is no `e2e` record either.
**Built on:** [spec 0087](0087-every-suite-is-compared-with-its-own-base.md)
(a base for each suite) and [spec 0088](0088-a-suite-is-carried-alone.md) (each
suite saved and restored alone), both required first; the storybook collector's
`tests: { suite }` option with `testSelectionProbes()` from
`@variance-authority/sense/journal` in the preview build
(`packages/storybook-collector/src/options.ts`); `withTestSelection` in
`packages/playwright-test/src/with-test-selection.ts`;
[spec 0080](0080-coverage-is-counted-per-kind.md) (the overlap by kind).

## Purpose

The project sells a coverage number counted per kind and an overlap between
kinds. Its own pull requests print one kind, so the table that shows the overlap
has a single row, and nothing in this repository has ever printed `run by
visual alone` or `run by e2e alone` over a real change. Running the product on
itself is the cheapest end-to-end test those rows have.

## What would discharge it

**1. The root config declares three suites.** `unit` (kind `unit`), `stories`
(kind `visual`) and `e2e` (kind `e2e`), each with its carrier.

**2. The visual gate records `stories`.** `cases/storybook-case` builds its
preview with `testSelectionProbes()`, its variance config passes
`tests: { suite: 'stories' }`, and the gate saves the record on a push to
`main`. A pull request compares with the record `main` saved last, and the
comment says which commit that is. The gate does not wait for the unit suite,
and the unit suite does not wait for the gate.

**3. `check.yml` runs an e2e job.** It runs `cases/playwright-storybook-case`
under `withTestSelection(config, { suite: 'e2e' })` in the pinned Playwright
image, saves the record on a push to `main`, and on a pull request uploads it
for the coverage step.

**4. The coverage comment is written after all three.** One job restores the
three records and their three bases, runs `variance coverage --packages
--format markdown` with an `--against <suite>=<record>` for each base that did
not come from the share, and posts under the existing marker. A suite whose job
failed or was skipped is printed as `unrecorded` or with its `baseMissed` line;
the other two are still compared.

**5. The regions the kinds share are regions of the case apps.** The visual and
e2e suites run page-side code: the case apps, not the packages. The comment's
per-package table shows that difference, and nothing changes the denominator to
hide it.
