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
`display` is `none`, is not in the tree. Strings are joined and `attr()` reads
the element's attribute; a part such as `counter()` or `open-quote` is carried
as written.

Under JSDOM, which computes no generated content, the declared rules answer,
picked by the same cascade order normalization uses: a box is in the tree when
the winning `content` gives it one and the winning `display` is not `none`, with the rules that style it and no computed style.
When that `content` is strings and `attr()`, the box says its words as a
`#text` child, as in a browser, so rewording it moves the snapshot. When it
holds a `counter()`, a quote, a `var()` or a `url()`, the box has no text and
carries `unread` on `RawNode` and `SemanticNode`, naming the parts it could not
resolve; `unread` is outside every hash. JSDOM's own parser drops a `content`
that is a single `attr()` or `counter()` and nothing else, so no box is read
for one.

This is part of `RULESET_VERSION` `r2`, the same `r2` that keeps the served
port out of a render. A subject with a `::before` or `::after` box has a new
render document, so after this upgrade its image shows the box and reads
`changed`; `variance accept --all` and Playwright's
`--update-snapshots=changed` adopt it.
