---
'@variance-authority/playwright': minor
'@variance-authority/route-collector': minor
'@variance-authority/storybook-collector': minor
---

An image, font or media request still unanswered when the network wait runs
out refuses the subject, naming the URL. The subject used to be read without
it, with a `network-not-quiet` warning. `NetworkObservation.settle()` now
resolves that refusal, or `undefined` once nothing is in flight; a caller that
ignores it reads a subject whose bytes nobody hashed.
Only the requests a subject started count against it: one still open from an
earlier subject on the same page was named in that subject's refusal.
One the read itself asks for and never gets makes `acquireFromAgent` throw
`UnansweredAssets`, which both collectors turn into that subject's refusal.
