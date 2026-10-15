---
'@variance-authority/playwright': minor
'@variance-authority/route-collector': patch
'@variance-authority/storybook-collector': patch
---

An image, font or media request still unanswered when the network wait runs
out refuses the subject, naming the URL. The subject used to be read without
it, with a `network-not-quiet` warning. `NetworkObservation.settle()` now
resolves that refusal, or `undefined` once nothing is in flight; a caller that
ignores it reads a subject whose bytes nobody hashed.
