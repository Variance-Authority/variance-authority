---
'@variance-authority/cli': patch
'@variance-authority/sense': minor
---

An application whose framework owns the request can be watched without wrapping a handler. A head handed the application's tracing as `trace` (`sentry(Sentry)` or `openTelemetry(api)`) and started with a watcher's address reports each traced flow to the watcher under its trace id, so `variance ask ran` lists it with no `enter` call. The listing is one execution per trace: where a browser SDK propagates its trace, that is one per page view. An id `enter` named still outranks the trace, and a head handed `trace` with neither a watcher's address nor a parts target still refuses to start.
