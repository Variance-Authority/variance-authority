---
'@variance-authority/cli': patch
'@variance-authority/mcp': patch
---

An unstable subject is described as read twice in a row, not seconds apart

The second reading is taken as soon as the first has finished, each one once
the page says it is ready. Nothing waits between them. The `[unstable]` reason
and the `UNSTABLE:` summary line used to say "seconds apart", which read as a
deliberate delay.
