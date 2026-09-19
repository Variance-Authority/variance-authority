---
'@variance-authority/core': minor
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

Changes before and beyond reach

A run reads left to right: the harness starts it, the tests enter your code,
your code goes out into the install and never comes back. Selection lives in the
middle, and both ends were invisible for opposite reasons.

The far right already arrived — a package is a node, a bump is a seed, the same
backwards walk answers it. The far left is this. Nothing imports a
`vitest.config.ts`, a setup module, a CI workflow or a `.nvmrc`, so no walk
reaches one and the honest structural answer about a change to one is *no
component moved*: a skipped suite over the file that decides how every test in
it runs. A diff that was *wholly* outside the graph already widened. The hole
was a config edited beside an ordinary source file, where the walk had a seed
and answered confidently about a change it never looked at.

`source.before` names those files, repository-root-relative, and a directory
claims everything under it. What a declaration buys beyond its own name is
everything below it: `beforeReach` in `@variance-authority/core/relate` walks
*along* the arrows from each entry — the one question whose subject has no
dependents — and collects the setup module, the fixture only that setup
imports, and the packages the environment rests on. The descent stops at the
first file `source.dirs` already covers, because that file has dependents and a
change to it is answered exactly by walking them; everything below it is
reached through it and does not arrive either.

The two ends meet there. A `jsdom` bump is named by the install comparison,
reaches `jest-environment-jsdom`, and reaches a config no file in the
repository imports — a change beyond reach arriving before it.

`scanRelations` takes `before` to seed those paths by name, since a harness
lives above every directory a component scan is pointed at. A named path that
is absent or has no reader is dropped rather than recorded unreadable: an
unknown file seeds every walk forever, so a typo would otherwise widen every
run in the repository. A declared entry the graph does not hold contributes
only its own name, which is the whole answer for a `.nvmrc` and a symptom for a
harness config, so the run reports it as a note rather than guessing.

`source.before` requires `source.relations: true`.
