# Spec 0089 — this repository reports every kind of suite it runs

**Missing:** the `stories` record and an e2e record from
`@variance-authority/playwright-test`. The visual gate in
`.github/workflows/variance.yml` runs over `cases/storybook-case` on every pull
request and every push to `main`, and records nothing of what its stories
executed: no suite of kind `visual` is declared, so the coverage comment has no
visual row. No job runs an e2e suite through `@variance-authority/playwright-test`.
**Built on:** [spec 0087](0087-every-suite-is-compared-with-its-own-base.md)
(a base for each suite) and [spec 0088](0088-a-suite-is-carried-alone.md) (each
suite saved and restored alone), both required first; the storybook collector's
`tests: { suite }` option with the collector listed in the preview's
`addons`, which probes a `storybook build --test`
(`packages/storybook-collector/src/options.ts`, `preset.ts`); `withTestSelection` in
`packages/playwright-test/src/with-test-selection.ts`;
[spec 0080](0080-coverage-is-counted-per-kind.md) (the overlap by kind).

## Purpose

The project sells a coverage number counted per kind and an overlap between
kinds. Its own pull requests count no visual suite, so the table that shows the
overlap has no visual row, and nothing in this repository has ever printed `run
by visual alone` over a real change. Running the product on
itself is the cheapest end-to-end test those rows have.

## What would discharge it

**1. The root config declares `stories` and `e2e`.** `stories` (kind `visual`)
and `e2e` (kind `e2e`), each with its carrier, beside the suites it declares.

**2. The visual gate records `stories`.** `cases/storybook-case` lists
`@variance-authority/storybook-collector` in its `addons` and builds its preview
with `storybook build --test`, its variance config passes
`tests: { suite: 'stories' }`, and the gate saves the record on a push to
`main`. A pull request compares with the record `main` saved last, and the
comment says which commit that is. The gate does not wait for the unit suite,
and the unit suite does not wait for the gate.

**3. `check.yml` runs an e2e job.** It runs `cases/playwright-storybook-case`
under `withTestSelection(config, { suite: 'e2e' })` in the pinned Playwright
image, saves the record on a push to `main`, and on a pull request uploads it
for the coverage step.

**4. The coverage comment is written after every suite.** One job restores
each suite's record and its base, runs `variance coverage --packages
--format markdown` with an `--against <suite>=<record>` for each base that did
not come from the share, and posts under the existing marker. A suite whose job
failed or was skipped is printed as `unrecorded` or with its `baseMissed` line;
the others are still compared.

**5. The regions the kinds share are regions of the case apps.** The visual and
e2e suites run page-side code: the case apps, not the packages. The comment's
per-package table shows that difference, and nothing changes the denominator to
hide it.
