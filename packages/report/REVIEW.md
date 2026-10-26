# Reviewing `@variance-authority/report`

The `RunReport` a run leaves behind, a reader that validates it, and the
derivations over it: `clusterChanges`, `adjudicateRun`, `promotionOf` and
`changelogOf`. The CLI writes it and calls the derivations; `mcp` and
`tribunal` read it. It compares nothing and touches a disk only through `/file`.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/report/`.

## Contracts

- **The reader returns a whole report or throws.** An unknown `runVersion`, a
  malformed `notObserved` entry, a transition missing a side of its evidence and
  the removed `incomparable` verdict are refused; an absent `notObserved` stays
  absent. Written in the [README](README.md#what-the-reader-refuses) and pinned
  by [`src/file.test.ts`](src/file.test.ts) › "refuses the incomparable verdict
  ADR-0090 removed".
- **A shape settles a subject only when it is the whole difference.** A subject
  where something else moved, or moved somewhere unnamed, is in `subjects` and
  not in `settles`. Written in the
  [README](README.md#turn-a-run-into-a-review-plan) and pinned by
  [`src/cluster.test.ts`](src/cluster.test.ts) › "does not offer to settle a
  subject where something else also moved".
- **A subject with no fingerprint is `ungrouped`, and every tie is broken.**
  Pinned by [`src/cluster.test.ts`](src/cluster.test.ts) › "counts subjects
  with no fingerprint anywhere rather than inventing a change" and "breaks
  every tie, so the docket does not wobble between runs".
- **`undelivered` needs the census.** Without `composition.components` a held
  component is `unobservable`, with the missing census as its `because`. Written
  in [README › Check a run against what you said you were
  doing](README.md#check-a-run-against-what-you-said-you-were-doing); pinned by
  [`src/intent.test.ts`](src/intent.test.ts) › "refuses to say it when the run
  kept no census at all".
- **The tally counts what each line prints.** Pinned by
  [`src/intent.test.ts`](src/intent.test.ts) › "counts each claim by the verdict
  word its line prints".
- **Promotion refuses what it cannot vouch for.** No image, a capped region
  list, or a difference that vanishes in a clean world is refused, and "already
  the baseline" is not a refusal. Pinned by
  [`src/promotion.test.ts`](src/promotion.test.ts) › "refuses a subject whose
  region list was capped, however its regions look" and "keeps "already the
  baseline" apart from "refused"".
- **A changelog is never empty.** Nothing accepted, or no run id, is an
  `Unrecordable` with a `because`; entries are the intersection with `accepted`;
  `at` is injected. Written in the
  [README](README.md#record-why-a-baseline-is-what-it-is) and pinned by
  [`src/changelog.test.ts`](src/changelog.test.ts) › "refuses when nothing was
  accepted, because there is no update to explain".
- **Trailers survive a squash and refuse what they do not know.** Pinned by
  [`src/changelog.test.ts`](src/changelog.test.ts) › "survives a squash merge,
  where the trailers stop being the last paragraph" and "refuses an encoding it
  does not know rather than reading the half it recognises".

## Where to look for a counterexample

- `src/file.ts` and `src/presentation-record.ts`: a field read with `??` or an
  optional chain that turns a malformed entry into an absent one.
- `src/intent.ts`: a claim whose root rendered in no subject, with and without a
  census; a `maxSubjects` equal to the reach.
