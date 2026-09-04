# Variance Authority Chart

## Scope

The logical system that observes a piece of software twice, decides whether it
changed, and says which component and which line is responsible.

## Roots

| Root | What it is | Chart |
|---|---|---|
| variance-authority | A set of composable evidence tools for software that changes, of which visual review is one composition | [variance-authority/](./variance-authority/README.md) |

## Out of scope

The public landing page under `site/`, which sells the system rather than
being part of it. The release toolchain, the workspace layout, and the
per-package publishing surface, which are facts about the repository rather
than about the system. The adopter's own application, test suite and CI
provider, which appear here only as external systems.

## Navigating

Registry: [COMPASS.md](./COMPASS.md). Every architectural directory's
identity document is its `README.md`.
