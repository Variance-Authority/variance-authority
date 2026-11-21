---
'@variance-authority/page-broker': minor
---

A new package for any test that drives a page. Name the regions of a page once, and an action declares the region it starts from and the outcomes it can end in — a region, or staying — and performing it returns the one the app reached. `.to('payment')` insists on one and fails with `expected payment, reached signIn`. The same declaration runs over a document from `/dom` (jsdom, happy-dom, a runner's browser mode) and over a Playwright page from `/playwright`. Staying is reported only once the page has gone quiet, and the app announces nothing for it. An app that navigated, opened a page or opened a modal dialog no outcome declares fails the action with `Unreached`, naming where it went.
