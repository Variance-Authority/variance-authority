---
'@variance-authority/playwright': minor
---

While a test story records, a page opened through `createHarness` writes into it what it did that the test cannot see from Node: each console line as `page console.log <text>`, a page error as `page error <first line>`, a crash as `page crashed`, and each document its top frame loaded as `page navigated <address>`, or `page reloaded <address>` where the browser reports a reload, without its query. Each lands on the step that was running when Node heard it. With no story recording, the harness adds no listener.
