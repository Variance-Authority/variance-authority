# Spec 0087 — every suite is compared with its own base

**Missing:** the whole capability. `variance coverage --against <record>` names
one base, and `coverage` refuses it when the root config declares more than one
suite and `--suite` is not given (`packages/cli/src/commands/coverage.ts:87`).
Without `--against`, a suite's base comes only from the share (`baseOf`,
`mainlineBase`), so a suite carried by `actions-cache` has no base unless it is
the one suite counted. `Coverage.base` is present only when every recorded suite
has a base, so one suite without a base drops the comparison for all of them.
**Built on:** [spec 0080](0080-coverage-is-counted-per-kind.md) (the count, the
overlap by kind, and `coverageChange`), `baseOf` in
`packages/cli/src/commands/coverage.ts` (where a base comes from today),
`testCoverageFile` in `packages/sense/src/test-selection/suites.ts` (where a
suite records).

## Purpose

A repository with a unit suite, an e2e suite and a visual suite wants one
comment that says how each one changed on this pull request. In CI the three
records usually come from three jobs and from two carriers: the unit record from
the runner cache, the visual record from the mainline's share. Today the only
multi-suite comparison is the one where the share holds every base. Any other
arrangement forces a single `--suite`, so the overlap by kind — the number spec
0080 exists to print — is never compared.

## What would discharge it

**1. `--against <suite>=<record>` is repeatable, and names one suite's base.**

```bash
variance coverage --against unit=.variance-base/unit/cases.bin \
                  --against e2e=.variance-base/e2e/cases.bin \
                  --packages --format markdown
```

A suite with no `--against` still takes its base from the share. A suite named
by `--against` and not declared in the root config is an operator error that
lists the declared names. The same suite named twice is an operator error.

**2. The bare `--against <record>` keeps its meaning.** With one suite counted
(one declared, or `--suite` given) it is that suite's base. With more than one
it stays refused, and the refusal names the `<suite>=<record>` form.

**3. A suite with no base does not remove the others' comparison.** Each suite
prints its own arrow, or its own `baseMissed` line. The overlap by kind is
compared only when every recorded suite has a base, because the regions of a
base with one suite missing are a different set of regions. When it is not
compared, the output says which suite's base is missing.

**4. Each base's commit is printed beside its suite.** Two bases may be recorded
at different commits — the visual suite's at the last push that ran the gate,
the unit suite's at the merge base. The markdown prints one line per suite,
`<suite> is compared with the record made at <sha>`, and the heading does not
name one commit for all of them.

## Decided

**Per suite, not per kind.** A root config may declare two suites of one kind
(`checkout` and `admin`, both `e2e`). A base belongs to a record, and a record
belongs to a suite.
