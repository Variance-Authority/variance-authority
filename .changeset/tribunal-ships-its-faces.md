---
'@variance-authority/tribunal': patch
---

The review surface ships the faces it is set in

`REVIEW_STYLES` names Inter and JetBrains Mono first, and the package shipped
neither, so a reviewer without them installed, and every renderer of its
stories, read the surface in a system fallback. Both faces now ship under the
SIL Open Font License as `@variance-authority/tribunal/fonts.css`, which a host
imports beside `REVIEW_STYLES`. The page `tribunal serve` writes links it, and
serves the sheet and its two files under `/ui/fonts/`.
