---
'@variance-authority/page-broker': minor
---

A new package for any test that drives a page. Each complex part of an app — a checkout form, a combobox, a dialog — gets a broker: the query a person finds it by, and its actions. An action declared with `leads` names the outcomes it can end in — another broker, or staying — and performing it returns the one the app reached, with the broker the test is now in. `.to('payment')` insists on one and fails with `billing.submit: expected payment, reached signIn`. The same brokers run over a document from `/dom` (jsdom, happy-dom, a runner's browser mode) and over a Playwright page from `/playwright`. Staying is reported only once the page has gone quiet with the broker still on it, and the app announces nothing for it. An app that navigated, opened a page or opened a modal dialog no outcome declares fails the action with `Unreached`, naming where it went. `Billing.declared` reads a broker as data: its probe, and where each action leads.
