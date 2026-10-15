---
'@variance-authority/presentation': patch
---

`sensePresentation` rejects a subject whose React Suspense boundary is still
pending when the `suspense.timeoutMs` bound is reached, and names the subject.
It used to sense the fallback as the presentation.
