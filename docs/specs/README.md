# Specs

Each capability's contract, its normative behaviour, and the acceptance criteria
that decide whether it is done.

An ADR records a decision that constrains code that exists. A spec here records
what a capability must do, written before the code and kept until the decisions
it forced have been lifted into ADRs — at which point the spec is deleted. **A
spec is therefore not a promise that the capability is missing.** Of the nine
below, four are `built` and stay only because nobody has written their ADRs yet,
three more have code that no consumer path reaches, and two are greenfield. The
`Status` column, not the presence of the file, is what says which is which.

Whoever moves a spec to `built` owns the rest of the move: writing the ADRs for
every decision it forced, updating [`docs/context/checkpoint.md`](../context/checkpoint.md),
and then deleting the spec. Until all three are done the spec stays, marked
`built`, and the debt is visible here rather than implied by silence.

Each spec states **what**, not **how it was arrived at**.

## Status vocabulary

| status | means |
|---|---|
| `not built` | no implementation; the spec is the whole of it |
| `built, not wired` | the packages exist and are unit-tested, but no consumer path reaches them, so the acceptance criteria are unmet |
| `built, never run` | committed and reachable, never executed against anything |
| `built` | implemented and exercised; awaiting ADR extraction and deletion |

## Sequence

Ordered by dependency. Later entries assume earlier ones.

| # | Capability | Depends on | Status | Where it stands |
|---|---|---|---|---|
| [0001](0001-component-hashing.md) | Per-component band hashing | — | `not built` | Every history question is asked against it. `SemanticSnapshot` hashes at subject level only. |
| [0002](0002-history-store.md) | History store and drift queries | 0001 | `built, not wired` | `@variance-authority/history` and `@variance-authority/server` implement the rows, the drift arithmetic and the service. `variance run` records nothing, so no row has ever been written by a run. |
| [0003](0003-cli.md) | Command-line interface | — | `built` | `variance run`, `accept`, `report`, `serve`, `comment` and `doctor` ship as the `variance` bin, and drive [`cases/storybook-case`](../../cases/storybook-case) end to end. |
| [0004](0004-artifact-storage.md) | Artifact storage: git-LFS and remote | 0003 | `built` | The directory store, the git-LFS store and the remote store all ship. git-LFS has never been exercised as git-LFS — no clean/smudge filter has run. |
| [0005](0005-ci-integration.md) | CI integration and PR feedback | 0003, 0004 | `built, never run` | [`.github/workflows/variance.yml`](../../.github/workflows/variance.yml) and the composite action around it are committed and have never executed. `variance comment`, which renders the body they post, is a command and has been run against a real report — but never from CI. |
| [0006](0006-storybook-adapter.md) | Storybook adapter | 0003 | `built` | `@variance-authority/storybook` reads an index Storybook wrote; [`cases/storybook-case`](../../cases/storybook-case) runs the whole CLI over a real build. |
| [0007](0007-linux-verification.md) | Linux verification | 0003 | `not built` | Every measurement comes from one Mac and one Chromium. |
| [0008](0008-locale-runs.md) | Locale runs | 0003 | `built, not wired` | `compareLocales` ships in `core/judge` and answers two questions no image can be asked. Nothing calls it from a run; a locale comparison still means hand-writing a test. |
| [0009](0009-inspection-rules.md) | Inspection rules, and where they stop | 0003 | `built` | Nine rules over one snapshot, and a written boundary: the list stays at what a stored snapshot can decide and does not grow toward axe. |

## Standing constraints

These hold for every spec here and do not need restating in each.

- **Nothing is published and nothing is pushed.**
- **No telemetry, no analytics, no phone-home.** The only outbound network call
  in the system is to a renderer endpoint the operator supplies.
- **The cheap path requires no infrastructure.** Any capability that needs a
  backend MUST degrade to a working single-run tool without one, and MUST report
  the absence rather than defaulting to a silent negative.
- **Never store pixels in anything that accumulates.** Images are artifacts with
  their own retention (ADR-0011). History is text.
- **An unobservable difference is never reported as no difference** (ADR-0002,
  ADR-0008).
