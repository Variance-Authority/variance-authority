---
"@variance-authority/sense": patch
---

A Vitest run that loads one module as its source and as its build — a package's
own tests import `src/cart.ts` while another package's reach it as
`dist/cart.js` — records the same regions for it on every run. Both readings
are named `src/cart.ts`, and the record used to be whichever the runner
transformed last, so its regions and digests changed between runs over the same
code and tests. The source reading is now the record whenever the run loaded it,
which is the record a run that never loads the build writes too.
