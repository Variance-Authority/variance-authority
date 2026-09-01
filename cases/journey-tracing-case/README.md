# Journey tracing case

This case proves that one execution, driven through a real browser into a
service the driver cannot see inside, comes back as two different kinds of
evidence under one id.

The page asks a service for a price. The service picks a branch by locale and
announces the decision; the same request, in the same instrumented module, also
records which regions of that source it entered. The spec waits on the
announcement and then asserts the screen once, with polling switched off.

Both instruments travel on one medium. The service is handed a `Cookie` header
naming the execution and where to answer, and nothing else — no report
directory, no configured port, no second channel to keep in step. What the
service says about a decision and what it says about coverage differ only in
which participant was speaking.

The outer Vitest file drives two specs concurrently and then asks the coverage
index a question neither spec can answer for itself: given a diff touching the
euro branch, which specs must run? The line executed in another process, so the
answer exists only because the service reported it home under the id the driver
minted.

The only artifact is the coverage index the driver merges into at teardown, in a
directory the outer file made. The head inventory is keyed by repository, so
`XDG_CACHE_HOME` is the whole of what keeps this run out of a developer's own
cache.
