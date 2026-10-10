---
'@variance-authority/core': minor
'@variance-authority/dom': minor
'@variance-authority/presentation': patch
'@variance-authority/unit-test': patch
---

`::before` and `::after` are read as children of the element they hang from

Restyling or rewording a `::before` or `::after` box used to repaint the page
and move no hash: the rules written for it were matched against the element,
failed, and were dropped from both the snapshot and the render document. A
generated box now enters the capture as a child node tagged `::before` (first)
or `::after` (last), carrying the rules written for it. In a browser it carries
its computed style, projected onto the allowlist, and the text its `content`
says as a `#text` child; a box whose `content` is `none` or `normal`, or whose
`display` is `none`, is not in the tree. A `content` that is not a string, such
as `counter()` or `open-quote`, is carried as written.

Under JSDOM, which computes no generated content, a box is in the tree when the
winning declared `content` gives it one, with the rules that style it and no
computed style or text. It carries `unread` on `RawNode` and `SemanticNode`,
saying what was not read; `unread` is outside every hash. A change to the words
alone of such a box does not move the snapshot under JSDOM.

`RULESET_VERSION` moves from `r1` to `r2`, the same `r2` that keeps the served
port out of a render. It is part of the render identity, so **every existing
baseline is `incomparable` after this upgrade**. Where a subject's render document is unchanged, `variance accept
--all` adopts the new images; a subject with a `::before` or `::after` rule has
a new render document, and its image needs review before it is accepted.
