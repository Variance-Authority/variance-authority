# Reviewing `@variance-authority/presentation`

## Contracts

- **Evidence, never a verdict.** Written in [ADR-0050][adr-0050]; pinned by
  [`src/analyze.test.ts`](src/analyze.test.ts).
- **Unobserved layout is absent, not empty.** Written in
  [README](README.md#analyze-a-capture-with-no-browser); pinned by
  [`src/analyze.test.ts`](src/analyze.test.ts).
- **A missing side is a change, never a clean list.** Pinned by
  [`src/analyze.test.ts`](src/analyze.test.ts).
- **Equal counts are not preserved content.** Pinned by
  [`src/analyze.test.ts`](src/analyze.test.ts).
- **A reading stays at its owner.** Pinned by
  [`src/focus.test.ts`](src/focus.test.ts),
  [`src/alignment.test.ts`](src/alignment.test.ts) and
  [`src/hierarchy.test.ts`](src/hierarchy.test.ts).
- **A pending Suspense boundary refuses, naming the subject.** Pinned by
  [`src/browser-agent.test.tsx`](src/browser-agent.test.tsx).
- **The caller's page is read, never driven.** Written in [ADR-0088][adr-0088];
  pinned by
  [`src/playwright.chromium.test.ts`](src/playwright.chromium.test.ts).

[adr-0050]: ../../docs/context/adr/0050-presentation-relationships-are-evidence-not-a-design-policy.md
[adr-0088]: ../../docs/context/adr/0088-a-page-is-read-as-nobody-is-using-it.md
