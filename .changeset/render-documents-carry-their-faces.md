---
'@variance-authority/dom': patch
'@variance-authority/playwright': patch
---

A subject set in a web font is painted in it, and a change to the font file changes its key

Pruning kept only the rules that match an element, and an `@font-face` matches
none, so a render document named a family it never declared and every render
painted the fallback. `acquireDocument` now carries each face whose family
appears in a computed `font-family` inside the subject or in a box its
frame generates, such as `body::before`, with its `url()`s
rewritten against the page, and `referencedAssets` adds the face's files to the
asset key. A face the subject is not set in is still pruned. Under jsdom, which
drops a face's `src`, the face is not carried and `acquireDocument` reports
`unreadable-font-face`.

The Playwright renderer paints a document on `about:blank`, where a face its
page served from its own origin is a cross-origin font that the browser refuses
without CORS headers. For a document that is not resource-closed and carries a
face, the renderer now fetches font requests itself and answers them with
`access-control-allow-origin: *`, as it already does for a closed document.

Baselines of subjects set in a web font move on the first run after upgrading:
the image is painted in the face rather than the fallback, and the key holds
the face's file. Review them and accept them once.
