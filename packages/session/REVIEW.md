# Reviewing `@variance-authority/session`

Runs many subjects in one standing DOM and reports cross-pollution: which
earlier subject wrote shared document state a later one read, through what key.
A runner or collector calls `createSession` and `session.run`, or `probe` and
`diffProbes`; it snapshots through `@variance-authority/dom` and `core`.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/session/`.

## Contracts

- **A finding is directional.** Only an earlier subject can be a culprit, and a
  write made after a subject ran is never blamed on it. Written in the
  [README](README.md#reading-a-finding) and pinned by
  [`src/session.test.ts`](src/session.test.ts) › "does not report a write that
  happened after the subject ran".
- **A subject is not blamed for itself:** its own stylesheet, its own output as
  body residue, a class on its own node as root coupling. Pinned by
  [`src/session.test.ts`](src/session.test.ts) › "does not blame a subject for
  its own stylesheet".
- **Every write a later subject reads is reported,** one finding per victim,
  culprit and key; a rule that matched but lost the cascade is a read. Pinned
  by [`src/session.test.ts`](src/session.test.ts) › "counts a rule that matched
  but lost the cascade".
- **A rule rewritten in place, and a sheet removed, are writes.** Written in
  the [README](README.md#what-the-probe-watches) and pinned by
  [`src/session.test.ts`](src/session.test.ts) › "notices a rule rewritten in
  place, not just a sheet appended".
- **`suspected` is overlap; `confirmed` is a hash that moved on a re-run.**
  Pinned by [`src/session.test.ts`](src/session.test.ts) › "confirms
  order-dependence by re-running and comparing hashes" and "confirms nothing
  when the session is clean".
- **No culprit is invented.** A subject unstable alone is confirmed with
  `culprit` absent; with no `provenanceOf`, `culpritComponents` is empty.
  Written in the [README](README.md#limits) and pinned by
  [`src/session.test.ts`](src/session.test.ts) › "reports a subject that is
  unstable on its own, with no culprit".
- **A mount is settled, single and non-empty before a snapshot.** A subject
  that rendered nothing, or failed to mount, is refused; a second run during an
  unsettled mount throws. Written in the [README](README.md#sharp-edges) and
  pinned by [`src/readiness.test.ts`](src/readiness.test.ts) › "refuses to
  snapshot a subject that mounted nothing" and "refuses to start a subject
  while another is still mounting".
- **The probe stays below 15% of session time.** Written in the
  [README](README.md#cost) and gated by
  [`src/cost.measure.ts`](src/cost.measure.ts) › "keeps the safety net cheaper
  than the thing it replaces".
