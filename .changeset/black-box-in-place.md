---
'@variance-authority/cli': patch
'@variance-authority/core': patch
'@variance-authority/playwright-test': patch
---

A subject that holds a `<canvas>` or `<video>` is no longer compared from a replay of its markup, which draws it blank and reads `unchanged` whatever the drawing does. The deferred capture, in the Playwright fixture and in `observe`, refuses it and names the fix: `materialization: { kind: 'in-place', browser }`, which photographs the live page.
