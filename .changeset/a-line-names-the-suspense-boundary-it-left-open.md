---
'@variance-authority/react': minor
'@variance-authority/sense': minor
---

A story line names the Suspense boundary it left open

With `@variance-authority/react/story` in a suite's setup files, each test line that opened or resolved a React `Suspense` boundary carries a note: `suspense 1 opened, 1 still open: CheckoutPage › Suspense`, then `suspense 1 resolved` on the line its promise settled. A boundary is named by the components that wrote it, outermost first, and every boundary still open when the line ended is listed in tree order. A line that changed no boundary has no note, so `--compare outcome` over a test that timed out waiting on data lists the open boundary on the side that threw.

Sense's story tap knows no framework. At the end of each test line it asks the functions a realm puts in its `Symbol.for('variance-authority.story.line')` array what that line did, and writes a non-empty answer as the line's note; a hook's line is asked and not noted, and a reader that throws is passed over.
