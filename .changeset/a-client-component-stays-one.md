---
'@variance-authority/sense': patch
---

A probed client component stays one

`testSelectionProbes` put its collector import on the first line of every
module, ahead of a `"use client"` or `"use server"` directive. A directive is
one only in the prologue, so a React Server Components build read every probed
client component as a server one. The import now goes after the last line, so
the prologue stays first and no position in the module moves; an import is
hoisted from wherever it is written, so the collector still evaluates before the
module's body.
