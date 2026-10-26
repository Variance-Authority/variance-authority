# Reviewing `@variance-authority/eyes`

## Contracts

- **Attribution is copied when the element is addressed.** Written in
  [README](README.md#what-this-is-for); pinned by
  [`src/rtl.test.tsx`](src/rtl.test.tsx) and
  [`src/page-agent.test.tsx`](src/page-agent.test.tsx).
- **Watching changes no result.** Pinned by
  [`src/rtl.test.tsx`](src/rtl.test.tsx) and
  [`src/playwright-proxy.test.ts`](src/playwright-proxy.test.ts).
- **`complete` is derived, never asserted.** Written in
  [README](README.md#what-you-get); pinned by
  [`src/rtl-case.test.tsx`](src/rtl-case.test.tsx).
- **No tap is a recorded refusal, not silence.** Written in
  [README](README.md#record-a-react-testing-library-run); pinned by
  [`src/rtl.test.tsx`](src/rtl.test.tsx).
- **One journal per attempt, under the case id, attempt as a column.** Written
  in [README](README.md#one-journal-per-attempt); pinned by
  [`src/access.test.ts`](src/access.test.ts) and
  [`src/rtl-case.test.tsx`](src/rtl-case.test.tsx).
- **Watched is said, and absent stays absent.** Pinned by
  [`src/case.test.ts`](src/case.test.ts) and
  [`src/archive.test.ts`](src/archive.test.ts).
- **No phase is inferred.** Written in [spec
  0054](../../docs/specs/0054-eyes-attention-is-read-as-test-steps.md).
