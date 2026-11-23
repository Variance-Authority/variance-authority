---
'@variance-authority/cli': minor
---

The review action's `coverage-page: 'true'` also keeps the page on a push to the
default branch: `coverage.html`, the one file of a commit with no parent at
`refs/coverage/<branch>`, replaced on each push the way the badge is, so the
default branch's page has an address that stays the same. The job that posts
the comment pushes it with the badge, and needs `contents: write`; with
`comment: 'false'` the page is handed on with the review to the job with `from`.
