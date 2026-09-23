---
'@variance-authority/sense': patch
---

Read the collector once per module, which makes recording under Jest much faster

Jest runs each test file inside a `vm` context. Every global read there passes
through an interceptor, and the probe read `globalThis.__VA__` on every hit.
Now each instrumented module reads it once and keeps it. On the same loop in a
`vm` context, 729 ms of probing drops to 12 ms or less. That read was most of
what recording cost under Jest, and it was the likeliest reason recorded cases
ran past their timeouts. Vitest runs in the main realm and gains nothing
measurable.

A collector must now keep the object on `globalThis.__VA__` for the life of the
realm, and redirect counts through its `s` resolver instead of replacing it.
Every collector shipped in this package now does. Jest's transform cache now keys
on the probe text as well, so the first run after the upgrade instruments again
rather than serving the old probe from cache.
