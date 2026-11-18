---
'@variance-authority/storybook-collector': minor
'@variance-authority/route-collector': minor
---

Collector component attribution reads the published native source index instead
of walking and parsing source again. Run `variance index` after source edits;
missing publications are built locally and refused in CI. Source directories
must be inside the checkout, and Git-ignored files are outside its inventory.
The `SourceScan.extensions` and `SourceScan.exclude` options are removed; the
native source index owns file eligibility. `scanSource` is now asynchronous.
