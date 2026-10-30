---
'@variance-authority/cli': patch
---

The config schema accepts a config that only selects

`schema/variance.config.schema.json` required `project`, `profile`, `viewport`,
`retention` and `subjects` in every file, so an editor following `$schema`
flagged a `variance.config.json` that declares only `suites`, `tiers`,
`entrypoints` or `share`, which every configless command reads without
complaint. The five are now required together: a file that names any of them
renders, and names all five; a file that names none of them is a valid config
for `select`, `covering`, `layers` and the other configless commands.
