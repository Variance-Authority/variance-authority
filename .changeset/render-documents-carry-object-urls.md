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

`acquireDocument` now reads each `blob:` URL the document carries, in an
attribute that names a file (`src`, every `srcset` candidate, `poster`, `data`
on `<object>`, `href` on SVG's `<image>` and `<use>`) or in a `url()` of an
element's `style`, a `<style>` in the subject, a rule the subject is painted
with, a value it inherits, or a box it sits in, and writes its bytes into the
document as a `data:` URL. An object URL that cannot be read, such as one
revoked after the image loaded, keeps its URL and is reported as an
`unreadable-object-url` error, which holds the run open. Under a host that
paints nothing, such as jsdom, it is a warning, since no page there showed the
picture.

A `srcset` is now read by HTML's rule, where a URL is a run of anything but ASCII whitespace.
Splitting on every comma cut a `data:` candidate in two, and `referencedAssets`
listed the second half as a file next to the page.
