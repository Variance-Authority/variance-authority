---
'@variance-authority/playwright': minor
---

While a test story records, a page opened through `createHarness` writes into it what it did that the test cannot see from Node: each console line as `page console.log <text>`, a page error as `page error <first line>`, a crash as `page crashed`, and each document its top frame loaded as `page navigated <address>`, without its query, with ` (reload)` where the browser reports a reload. Each lands on the step it happened during. With no story recording, the harness adds no listener.
