---
"@variance-authority/help": patch
---

`ask symbol` answers a re-exported name through the door the workspace imports it by

When several packages publish one declaration, as every TanStack Query adapter re-exports `@tanstack/query-core`, the answer led with the first package read and its own count, so `QueryObserver` came back as imported from `@tanstack/angular-query-experimental` and "used by nothing outside its own package". The door with the most importing packages, then the most imports, now leads; the others follow under "Also published by".
