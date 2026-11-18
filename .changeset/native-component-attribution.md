---
'@variance-authority/storybook-collector': minor
'@variance-authority/route-collector': minor
---

Collector component attribution reads the published native source index instead
of walking and parsing source again. The collector brings the index up to the
checkout before it reads, in CI too, so no `variance index` step is needed
first. Source directories must be inside the checkout, and untracked ignored
files enter only through explicitly reached relative imports.
`SourceScan.extensions` and `SourceScan.exclude` keep their meaning and their
defaults. `scanSource` is now asynchronous.
