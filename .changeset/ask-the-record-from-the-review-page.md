---
'@variance-authority/tribunal': minor
---

Serve every history path, and let a reviewer ask what the record already knows.

Three of the eight protocol paths were unserved and two fields were dropped on
the way in, and none of it presented as an error. Without `/v1/current` a run
compares against nothing, so every component reads as new and drift is never
detected. Without `/v1/approvals` every observation stays unapproved, so churn
answers *this component has never changed* about a component that changed forty
times. Without `instabilities` and `run.swept` a flake has no denominator. All
three failures sound like a stable suite.

The derived reads — churn, reach, flakiness, the value journey, the last change —
now answer the review capability as well as the ingest one. They write nothing,
and the browser drawing a review page holds the review token; refusing them there
meant a surface that can approve a change it cannot put in context. The writes
and `/v1/current` stay the ingest token's.

On the page: a **Changelog** tab grouping every approval by the shape that was
approved, counting the approvals nothing could attribute rather than dropping
them, and a per-subject **record** panel — how often this subject read
differently, whether it has since, how often its cause caused an approved change,
and how far that component reaches. Fetched when the reviewer asks, because a
build with three hundred changed subjects would otherwise make nine hundred
requests to draw a page on which one is read. A flake rate stays absent until
something swept: `0%` is the confident answer to a question nobody asked.
