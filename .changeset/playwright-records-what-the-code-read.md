---
'@variance-authority/cli': patch
'@variance-authority/event': patch
'@variance-authority/playwright-test': minor
'@variance-authority/sense': minor
---

A Playwright case records what the code under test read, as a Vitest, Jest or Rstest case does. `varianceBreadcrumb` called in the worker lays its read on the running case, and one called in the page the case drives is carried home with the page's execution journal and laid on that case, misuses included; `variance covering` and `variance review` print them beside what the case said. A Playwright row now holds `read` and `misused`, empty for a case whose code read nothing, where before they were absent. The page reader is the recorder Node runs, sent with the execution collector, so a page records reads only when the collector is on it. `SAID_NOTHING` is gone from `@variance-authority/sense/journal`; a seam that listened for preconditions alone takes what the listener's `nothing` gives it.
