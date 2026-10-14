---
'@variance-authority/sense': patch
---

A probed module is read from disk once

Placing probes after your compilers read each module's file up to three times:
once in the half that runs ahead of them, and twice more in the half that
places the probes. Every seam now reads it once — Vitest, Vite, Rstest, and the
Rspack and webpack loader — and hands the text on, so the probes cost less per
module. Nothing read is kept past the module it was read for.
