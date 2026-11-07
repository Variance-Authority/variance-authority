---
'@variance-authority/sense': patch
---

A Jest run that instruments no module no longer tells you to check `include` or
the plugin, which Jest's wrap does not have. The `instrumented 0 modules` warning
now sends you to the failures Jest printed above it, and, with no failures, to
your `transform` patterns.
