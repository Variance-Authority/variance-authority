# Specs

What is decided and not yet built.

An ADR records a decision that constrains code that exists. A spec here records a
capability that does not exist yet: its contract, its normative behaviour, and
the acceptance criteria that decide whether it is done. When a spec is
implemented, the decisions it forced become ADRs and the spec is deleted.

Each spec states **what**, not **how it was arrived at**.

## Sequence

Ordered by dependency. Later entries assume earlier ones.

| # | Capability | Depends on | Why it is here |
|---|---|---|---|
| [0001](0001-component-hashing.md) | Per-component band hashing | — | Every history question is asked against it. `SemanticSnapshot` hashes at subject level only. |
| [0002](0002-history-store.md) | History store and drift queries | 0001 | Accumulated change over time. No single-run tool can compute a sum. |
| [0003](0003-cli.md) | Command-line interface | — | The packages are a library. Nothing can be run from a terminal, a pre-commit hook, or CI. |
| [0004](0004-artifact-storage.md) | Artifact storage: git-LFS and remote | 0003 | Baselines live in a local directory and go nowhere. |
| [0005](0005-ci-integration.md) | CI integration and PR feedback | 0003, 0004 | A run produces a report nobody sees. |
| [0006](0006-storybook-adapter.md) | Storybook adapter | 0003 | Story-shaped subjects work; nothing reads a real Storybook. |
| [0007](0007-linux-verification.md) | Linux verification | 0003 | Every measurement comes from one Mac and one Chromium. |
| [0008](0008-locale-runs.md) | Locale runs | 0003 | `compareLocales` answers two questions no image can be asked, and nothing calls it from a run. |
| [0009](0009-inspection-rules.md) | Inspection rules, and where they stop | 0003 | Five rules exist. Whether the list grows toward axe or stays at what a stored snapshot can decide is undecided, and an undecided rule list rots. |

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
