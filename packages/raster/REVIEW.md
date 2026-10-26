# Reviewing `@variance-authority/raster`

## Contracts

- **A store that could not look never reads as one that found nothing.** Written
  in [README](README.md#contracts-the-rest-of-the-pipeline-is-written-against);
  pinned by [`src/store.test.ts`](src/store.test.ts).
- **`settle` says `unchanged` only for the exact document and machine.** Pinned
  by [`src/settle.test.ts`](src/settle.test.ts).
- **The ephemeral store has no past.** Pinned by
  [`src/store.test.ts`](src/store.test.ts).
- **One sample is `unknown`, never stable, and the gate never retries.** Written
  in [README](README.md#decide-whether-a-subject-is-worth-photographing); pinned
  by [`src/gate.test.ts`](src/gate.test.ts).
- **Changing the system changes the address.** Pinned by
  [`src/plan.test.ts`](src/plan.test.ts).
- **A difference is measured, never adapted.** Written in
  [README](README.md#images-that-do-not-match); pinned by
  [`src/difference/difference.test.ts`](src/difference/difference.test.ts).
- **The default policy counts a colour change above 1%.** Written in
  [README](README.md#contracts-the-rest-of-the-pipeline-is-written-against).
