---
'@variance-authority/sense': minor
'@variance-authority/storybook-collector': patch
'@variance-authority/playwright-test': patch
---

One recorder for every visual subject

`@variance-authority/sense/journal` exports `createSubjectRecorder`, which keeps
one row per subject of a visual run with the page and every head joined, and
`driveJourneys`, the driver's listener, cookies and settling wait. The
Storybook collector records through the first, the Playwright fixture through
the second, so a story, a page and a test file record their journeys the same
way.
