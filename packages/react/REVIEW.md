# Reviewing `@variance-authority/react`

## Contracts

- **No fiber is a reason, never an empty chain.** Written in
  [README](README.md#limits); pinned by
  [`src/provenance.test.ts`](src/provenance.test.ts) and
  [`src/hydration.test.ts`](src/hydration.test.ts).
- **A renamed React field reads as not committed.** Pinned by
  [`src/root-state.test.ts`](src/root-state.test.ts).
- **A props digest excludes `children` and agrees across records.** Pinned by
  [`src/provenance.test.ts`](src/provenance.test.ts) and
  [`src/props.test.tsx`](src/props.test.tsx).
- **Arrival has three states, and no clock decides hydration.** Written in
  [README](README.md#waiting-for-a-subject-to-arrive); pinned by
  [`src/suspense.test.tsx`](src/suspense.test.tsx) and
  [`src/root-state.test.ts`](src/root-state.test.ts).
- **A late tap refuses rather than reporting silence.** Pinned by
  [`src/commits.test.tsx`](src/commits.test.tsx).
- **A bound is reported, never a short answer.** Written in
  [README](README.md#component-level-quiet); pinned by
  [`src/traversal.test.ts`](src/traversal.test.ts).
- **Holding is written into no hash.** Written in
  [README](README.md#what-else-the-same-fiber-answers).
