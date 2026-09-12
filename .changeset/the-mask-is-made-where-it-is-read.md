---
'@variance-authority/tribunal': minor
'@variance-authority/cli': minor
'@variance-authority/png': minor
---

The difference mask is computed on the review page, not uploaded

A mask is new bytes by definition whenever anything moved, so it is the one image
content addressing can never deduplicate: `before` is always a hit and an
unchanged `after` is a second copy of a baseline, but a mask matches nothing and
never will. `variance push` now leaves it at home. The review surface holds both
captures and makes its own when a reviewer opens the difference — through the
same function, at the same policy, so the two cannot disagree about a threshold,
an anti-aliasing rule, or what a grown capture does to the union box. Builds
pushed by earlier versions kept a mask and are still served it.

Runs are unchanged: the report still writes a diff PNG, because that is the
picture a developer opens without a deployment, and a deployment is optional.

`@variance-authority/png` gains a `./mask` subpath — the padding rule and the
difference, over pixels somebody else decoded — so a caller holding RGBA reaches
the arithmetic without a codec, and a bundler following it finds no `pngjs`.
