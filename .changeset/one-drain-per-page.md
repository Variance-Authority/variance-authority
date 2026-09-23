---
'@variance-authority/sense': patch
---

A page with two instrumented bundles reports what it ran

Every bundle built with `testSelectionProbes()` brings its own copy of the page
collector. When a page loaded two of them, such as an application and a widget
built separately, or a collector module that was evaluated a second time, the
second copy wrote its crossings to the first copy's log. It then replaced the
first copy's drain with its own, which reads a log nothing writes to. The driver
then drained an empty journal, recorded that the page ran nothing, and the next
`--since` skipped the subject over lines it had run.

The drain now belongs to the collector that installed the log. A later copy
adds its crossings to that log and leaves the drain in place.
