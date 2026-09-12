---
'@variance-authority/tribunal': patch
---

A page that has nothing yet says what it is missing, and wears its chrome while it waits

Two states on the review surface threw away what the page already knew.

A deployment nobody has pushed to said `No builds have been posted yet` and
stopped. Every other absence here is a fact about the project, and a sentence is
the whole right response to those — but this one is a fact about a setup
somebody is still finishing. It now prints the `review` block with the endpoint
this page is reachable at already filled in, the `variance push` line under it,
and which of the two tokens that is: the ingest one, not the review token, which
is what a person decides a subject with. A failed build list still never reaches
this screen, because instructions over a service that answered 503 send a reader
off to check a config that is not the problem.

A build that was still loading, or one that failed to load, rendered an empty
ground with a single grey line on it — no brand, no crumb, nothing to click.
Both now wear the topbar the loaded page wears, with the crumb back to the build
list, which was knowable before the build was; the body is drawn as bars the
height of what is landing, so nothing jumps when it does. `Waiting`, `Skeleton`
and `Stalled` are exported for hosts that render the pages themselves.

`ReviewClient` gained an optional `endpoint` — the base it was built with — so
the one screen that has to name an address rather than use it can.
