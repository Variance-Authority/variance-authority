---
'@variance-authority/page-broker': minor
---

A new package for Playwright tests. An action declares the outcomes it can end in — a part of the page, or staying — and performing it returns the one the app reached. `.to('payment')` insists on one and fails with `expected payment, reached signIn`. Staying is reported only once the page has gone quiet, and the app announces nothing for it.
