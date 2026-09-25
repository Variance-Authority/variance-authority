---
'@variance-authority/sense': minor
---

A service with no host filesystem, such as a Cloudflare Worker, can now write journey parts. Set `parts` or `VARIANCE_AUTHORITY_PARTS` to an `http(s)://` address, and start `receiveParts(directory)` from `@variance-authority/sense/journey` on the host to serve it. Each journey's frame is sent before its scope's promise settles, so a runtime that ends a request's work with its response still delivers it.

`testSelectionProbes({ journeys: true })` installs the journey head under the build's `label` before any instrumented module runs. A realm now holds one collector: `collectJourneys()` returns the installed one until it is closed. A part file is named on its first write, so a head can be installed at a Worker's global scope.
