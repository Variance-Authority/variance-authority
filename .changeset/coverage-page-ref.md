---
'@variance-authority/cli': minor
---

With `badge: 'true'`, the review action's `coverage-page: 'true'` also keeps the
page on a push to the default branch: `coverage.html`, the one file of a commit
with no parent at `refs/coverage/<branch>`, pushed with the badge and replaced
on each push the way the badge is, so the default branch's page has an address
that stays the same. With `comment: 'false'` the page is handed on with the
review to the job with `from`.
