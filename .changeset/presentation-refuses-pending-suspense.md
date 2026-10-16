---
'@variance-authority/presentation': minor
---

`sensePresentation` rejects a subject whose React Suspense boundary is still
pending when the `suspense.timeoutMs` bound is reached, and names the subject.
It used to sense the fallback as the presentation. A subject that is its
loading state passes `loading: true`, and its fallback is sensed on purpose.
