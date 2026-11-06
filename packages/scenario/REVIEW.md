# Reviewing `@variance-authority/scenario`

## Contracts

Written in
[ADR-0047](../../docs/context/adr/0047-a-runtime-scenario-is-a-witnessed-path.md)
and pinned by [src/scenario.test.ts](src/scenario.test.ts), unless a contract
names its own source.

- **It records and compares, and decides nothing.** Written in [README › What
  this is for](README.md#what-this-is-for).
- **Three variances stay three.**
- **Acts align by `(key, occurrence)` on the common prefix, never shifted.**
- **An unobserved outcome ends the path**, and `firstDivergence` is
  `unresolved`, never `none`.
- **A blind side is named, never agreement.**
- **An unread cause is `unread`, never a flake.**
- **A fold keeps every witnessed edge and invents none.**
- **A precondition link is carried, never inferred.** Written in
  [README](README.md#record-two-paths-and-compare-them).
- **The archive admits before it writes, and never reconstructs.** Written in
  [ADR-0048](../../docs/context/adr/0048-a-scenario-archive-holds-semantic-objects.md);
  pinned by [src/archive.test.ts](src/archive.test.ts).
