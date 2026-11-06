# Reviewing `@variance-authority/tribunal`

## Contracts

- **Approval promotes an uploaded image, never records one.** Written in
  [README](README.md#review-invariants); pinned by
  [`src/review.approve.test.ts`](src/review.approve.test.ts).
- **A moved baseline refuses where the changes meet, and records nothing.**
  Written in [README](README.md#review-invariants); pinned by
  [`src/review.moved.test.ts`](src/review.moved.test.ts).
- **A store failure is never a verdict, and a row without its object is
  damage.** Pinned by [`src/store.test.ts`](src/store.test.ts).
- **Absent is stored apart from empty.** Pinned by
  [`src/review.test.ts`](src/review.test.ts) and
  [`src/concerns.test.ts`](src/concerns.test.ts).
- **No token reveals a route.** Pinned by
  [`src/worker.test.ts`](src/worker.test.ts).
- **Each token holds only its role.** Written in
  [README](README.md#the-http-api).
- **The service makes no outbound request.** Written in
  [README](README.md#review-invariants).
- **The record is append-only in the database.** Pinned by
  [`src/changelog.test.ts`](src/changelog.test.ts).
- **A sweep keeps what a later run or reader needs.** Pinned by
  [`src/objects.test.ts`](src/objects.test.ts).
