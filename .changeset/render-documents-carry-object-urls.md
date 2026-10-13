---
'@variance-authority/dom': patch
---

An image shown through an object URL is painted, and acquired the same way twice

A page that computes an image (a canvas encoded to a blob, a dropped file, a
response read as a blob) shows it through a `blob:` URL, which names memory in
that page alone. The render document carried the URL, so the deferred renderer
painted a broken image where the page showed a picture. The URL's uuid is new on
every load, so one picture was also two documents, and a settled subject was
painted again on every run.

`acquireDocument` now reads each `blob:` URL in an attribute that names a file
(`src`, every `srcset` candidate, `poster`, `href` on SVG's `<image>` and
`<use>`) and writes its bytes into the document as a `data:` URL. An object URL
that can no longer be read, because it was revoked after the image loaded, keeps
its URL and is reported as an `unreadable-object-url` error, which holds the run
open.
