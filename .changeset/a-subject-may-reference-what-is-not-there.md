---
'@variance-authority/core': minor
'@variance-authority/unit-test': minor
'@variance-authority/playwright': minor
---

A subject is allowed to reference something that is not there

A fixture that points an `<img>` at a path nobody serves is testing the fallback,
and the broken state is the subject. Capture had no way to say so: the resolver
returned bytes or the capture was refused, so Material UI's CardMedia,
ImageListItem and Avatar suites — which all reference a deliberately absent
`/fake.png` — could not be captured at all.

`resolveResource` may answer `{ absent: true }`. The resource is recorded with
its status, and the renderer answers that status instead of counting the request
as one the document failed to carry.
