# Reviewing `@variance-authority/presentation`

Measures how a rendered subject groups, separates, aligns and emphasizes its
content: a graph, relationship findings, telemetry and paint, from a
`RawCapture` with no browser, or through a caller's Playwright `Page` under
`/playwright`. Tests and agents call it; it reads through `dom`'s capture.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/presentation/`.

## Contracts

- **Evidence, never a verdict.** No finding comes from telemetry alone, and
  nothing returns a score, a recommendation or a pass. Written in
  [ADR-0050][adr-0050] and pinned by
  [`src/analyze.test.ts`](src/analyze.test.ts) › "treats dense, coherent
  presentation as telemetry rather than a defect" and "records large margins
  without inventing a utilization finding".
- **Unobserved layout is absent, not empty.** A profile that cannot see layout
  leaves `findings` and `patterns` absent; a layout-capable capture missing an
  element rect is refused. Written in the
  [README](README.md#analyze-a-capture-with-no-browser) and pinned by
  [`src/analyze.test.ts`](src/analyze.test.ts) › "keeps unobserved layout
  distinct from observed empty ARIA" and "analyzes a generated box that
  carries no rect of its own, and refuses an element that lacks one".
- **A missing side is a change, never a clean list.** Pinned by
  [`src/analyze.test.ts`](src/analyze.test.ts) › "reports a side without a
  presentation reading as changed, and no reading on either side as no
  signal".
- **Equal counts are not preserved content.** Pinned by
  [`src/analyze.test.ts`](src/analyze.test.ts) › "does not mistake equal
  information counts for preserved content".
- **A reading stays at its owner.** Nested evidence is counted, not folded in;
  a member across the owner boundary, or a contract that erases order, is
  refused. Pinned by [`src/focus.test.ts`](src/focus.test.ts) › "keeps nested
  box evidence out of an owner reading and available to a subtree reading",
  [`src/alignment.test.ts`](src/alignment.test.ts) › "refuses to pull a member
  across the selected ownership boundary" and
  [`src/hierarchy.test.ts`](src/hierarchy.test.ts) › "refuses contracts that
  erase ownership or relationship order".
- **A pending Suspense boundary refuses, naming the subject.** Pinned by
  [`src/browser-agent.test.tsx`](src/browser-agent.test.tsx) › "refuses a
  subject whose Suspense boundary has not resolved, naming it".
- **The caller's page is read, never driven.** Of the four driver tricks only
  `no-focus` is applied and recorded, and focus goes back. Written in
  [ADR-0088][adr-0088] and pinned by
  [`src/playwright.chromium.test.ts`](src/playwright.chromium.test.ts) ›
  "hands focus back to the field that held it once the reading is taken".

[adr-0050]: ../../docs/context/adr/0050-presentation-relationships-are-evidence-not-a-design-policy.md
[adr-0088]: ../../docs/context/adr/0088-a-page-is-read-as-nobody-is-using-it.md
