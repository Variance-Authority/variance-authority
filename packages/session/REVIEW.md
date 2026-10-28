# Reviewing `@variance-authority/session`

## Contracts

- **A finding is directional.** Written in
  [README](README.md#reading-a-finding); pinned by
  [`src/session.test.ts`](src/session.test.ts).
- **A subject is not blamed for itself:** its own stylesheet, its own output as
  body residue, a class on its own node as root coupling. Pinned by
  [`src/session.test.ts`](src/session.test.ts).
- **Every write a later subject reads is reported,** one finding per victim,
  culprit and key; a rule that matched but lost the cascade is a read. Pinned by
  [`src/session.test.ts`](src/session.test.ts).
- **A rule rewritten in place, and a sheet removed, are writes.** Written in
  [README](README.md#what-the-probe-watches); pinned by
  [`src/session.test.ts`](src/session.test.ts).
- **`suspected` is overlap; `confirmed` is a hash that moved on a re-run.**
  Pinned by [`src/session.test.ts`](src/session.test.ts).
- **No culprit is invented.** Written in [README](README.md#limits); pinned by
  [`src/session.test.ts`](src/session.test.ts).
- **A mount is settled, single and non-empty before a snapshot.** Written in
  [README](README.md#sharp-edges); pinned by
  [`src/readiness.test.ts`](src/readiness.test.ts).
- **The probe stays below 15% of session time.** Written in
  [README](README.md#cost); pinned by
  [`src/cost.measure.ts`](src/cost.measure.ts).
