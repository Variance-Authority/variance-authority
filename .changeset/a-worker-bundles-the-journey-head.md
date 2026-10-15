---
'@variance-authority/sense': patch
---

The journey head bundles for a Worker

`@variance-authority/sense/journey` reached the native addon through the
instrumentation index, so a Worker that imported `collectJourneys` could not be
bundled: the addon is a `.node` file and workerd loads none. The instrumentation
id now lives in a module of its own, and the journey head reaches nothing
native.
