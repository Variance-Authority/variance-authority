# Reviewing `@variance-authority/eyes`

Records, per test attempt and in order, every element a test queried, acted
on, read or asserted on, with the React attribution copied when it was
addressed, and hands the journal to the case the run records. Its entry points
wrap Testing Library's `screen` and Playwright's `page`; `distill`, `mcp` and
the report read the journals from the record.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/eyes/`.

## Contracts

- **Attribution is copied when the element is addressed.** A click handler
  that unmounts its target leaves the entry attributed. Written in the
  [README](README.md#what-this-is-for) and pinned by
  [`src/rtl.test.tsx`](src/rtl.test.tsx) › "copies attribution before a click
  handler removes the element it fired on" and
  [`src/page-agent.test.tsx`](src/page-agent.test.tsx) › "copies attribution
  before a React click handler unmounts its target".
- **Watching changes no result.** A query that resolves, finds nothing or
  throws returns what it would have; a lost post-action read never fails a
  passing action. Pinned by [`src/rtl.test.tsx`](src/rtl.test.tsx) › "records
  absence and thrown queries without changing their result" and
  [`src/playwright-proxy.test.ts`](src/playwright-proxy.test.ts) › "keeps a
  successful action passing when the post-operation read is lost".
- **`complete` is derived, never asserted.** A sequence that starts above zero
  or skips a number marks the journal partial with the count. Written in the
  [README](README.md#what-you-get) and pinned by
  [`src/rtl-case.test.tsx`](src/rtl-case.test.tsx) › "says a journal is
  partial when the log had already been drained".
- **No tap is a recorded refusal, not silence.** Written in the
  [README](README.md#record-a-react-testing-library-run) and pinned by
  [`src/rtl.test.tsx`](src/rtl.test.tsx) › "records why no commit can arrive,
  rather than leaving the log silent".
- **One journal per attempt, under the case id, attempt as a column.** A
  journal repeating an attempt is refused; one closed twice is handed once.
  Written in the [README](README.md#one-journal-per-attempt) and pinned by
  [`src/access.test.ts`](src/access.test.ts) › "keeps each attempt of one
  test, and refuses a journal that repeats one" and
  [`src/rtl-case.test.tsx`](src/rtl-case.test.tsx) › "hands one journal
  however often teardown closes it".
- **Watched is said, and absent stays absent.** A case that opened a journal
  is told apart from one that never handed one over; an archive that did not
  say which tests were watched leaves it absent. Pinned by
  [`src/case.test.ts`](src/case.test.ts) › "tells the case it is watched, so a
  test that never hands one over is told apart from one that opened none" and
  [`src/archive.test.ts`](src/archive.test.ts) › "carries which tests were
  watched across the boundary, and leaves it absent when the producer did not
  say".
- **No phase is inferred.** Arrange, Act and Assert begin only at a declared
  phase. Written in
  [spec 0054](../../docs/specs/0054-eyes-attention-is-read-as-test-steps.md).
