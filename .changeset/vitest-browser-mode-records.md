---
'@variance-authority/sense': minor
---

`withTestSelection` records a Vitest browser-mode suite

A test file that ran in a page recorded nothing. The setup module wrote its
journal with `node:fs`, which a page does not have, so browser mode stopped at
the first import.

In a page, the setup module now installs the collector a Storybook preview
uses. It attaches what the file ran to the file's own task, and Vitest carries
that task back to the reporter. The snapshot is the one a jsdom run writes, per
test file, whether browser mode is set in the configuration or with
`--browser.enabled`. Measured on Vitest 2, 3 and 4, with and without isolation.

`cases` is not recorded in a page. A run that asks for it gets the file-level
snapshot and a warning, rather than an empty case index.
