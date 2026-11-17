---
'@variance-authority/react': minor
---

A story tells when a Suspense boundary falls back and when it unlocks

With `@variance-authority/react/story` in a suite's setup files, the story tells each time a React `Suspense` boundary shows its fallback and each time it unlocks, at the moment it happens, among the other notes of the line that was running: `suspense CheckoutPage › Suspense shows its fallback`, a request that comes back, then `suspense CheckoutPage › Suspense unlocks`. A boundary is named by the component that wrote it (in a production build, the one it sits inside). A boundary that falls back again is told again, and one that never fell back gets no note. `--compare outcome` over a test that timed out waiting on data lists the boundary's `unlocks` note on the side that passed.
