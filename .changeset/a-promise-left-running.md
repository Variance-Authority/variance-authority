---
'@variance-authority/sense': patch
---

What a handler's unreturned promise runs is recorded against its request

A handler can start work it does not return: a write behind, an analytics
call, a cache warmed after the response. That work still runs as the request,
but once the request's scope had reported, the head forgot where the request's
reports went. So everything the promise ran was dropped, with nothing counted
and nothing said, and the next `--since` could skip the spec that caused it.

The head now remembers where each journey reports after its scope closes, for
the last 4096 journeys. What such a promise runs goes back as a scope of its
own, which the driver waits for like any other. If a journey is too old to be
remembered, the account is counted as lost, which retires the run.
