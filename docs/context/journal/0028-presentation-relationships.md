# Journal 0028 — Presentation relationships

**Date:** 2026-08-26

The supplied milestone asked the browser analysis engine to expose presentation
relationships without turning density or whitespace into design policy. The
first move derived a pure report from the capture already crossing the collector
boundary, then exercised it against eight constructed cases.

The cases separated four readings that a single heuristic would merge: dense and
coherent, sparse with large margins, collapsed repeated records, and intentional
state-driven variance. They also pinned low-distinction surfaces, alignment and
inferred-baseline outliers, absent layout, and before/after information counts.
The final gate added two adversarial cases: absent, empty, and partial ARIA move
the report identity independently, and equal character counts do not make
substituted text look preserved. All ten passed with this command:

```bash
yarn exec vitest run packages/presentation/src/analyze.test.ts
```

The first browser move placed presentation inspection inside the existing
visual-regression Playwright package. That made the acquisition convenient but
gave the offering the wrong owner: this work senses a live interface and
supports an edit; it does not observe against a baseline or decide a regression.
The browser entry therefore moved into `@variance-authority/presentation`, with
no baseline or verdict API.

The browser loop used a real Chromium page containing 31 repeated demand records.
The report correlated the Playwright ARIA snapshot with rendered nodes, detected
the repeated pattern and four calibrated collapse findings, serialized as plain
JSON, and painted 31 individually identified instances. A second page retained a
256px margin and dense typography as telemetry while an `aria-invalid` surface
variant remained explained rather than becoming grammar drift.

```bash
yarn exec vitest run packages/presentation/src/playwright.chromium.test.ts
```

Both browser cases passed. Chromium required execution outside the macOS process
sandbox; the first in-sandbox launch was refused by Mach port registration before
any test ran.

The benchmark in the supplied specification named an Underwriter page but
provided no page artifact or URL. The 31-record browser case fixes the specified
relationship shape and acceptance claims; it does not establish behaviour on
that external presentation.
