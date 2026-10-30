---
'@variance-authority/route-collector': patch
'@variance-authority/cli': patch
---

A route read stops at the first refused connection

When the server a route read was reading stopped partway through, every route
left was visited anyway, each recorded as failed with
`net::ERR_CONNECTION_REFUSED`, and the run exited 1 as if it had found changes
to review. The read now stops at the first refused connection: the run exits 2
with one error that names the origin nothing is listening at and the route it
was reading. An empty response or a reset is still recorded as that one page
failing, and the read goes on.

`variance run` and `variance collect` also stop asking a collector for
subjects once it has thrown. At a concurrency above one, the subjects already
queued behind the one that threw were still collected.
