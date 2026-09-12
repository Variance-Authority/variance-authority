---
'@variance-authority/tribunal': minor
---

One round trip per question, because a binding call is a subrequest

A Worker may make 50 subrequests per request on the free plan and 10,000 on a
paid one, and D1 and R2 binding calls both count. This service was spending them
one row at a time.

**`/review/have`** asked the ledger and then asked the bucket, per digest,
serially: a suite naming 600 images cost 1,200 subrequests — twenty-four times
what a free Worker may spend, on the one route whose whole purpose is to save
work. It now asks the ledger in groups of 99, which is what D1's 100-parameter
limit permits, and does not ask the bucket at all. The `head` was checking
whether a row had outlived its object, which is a window that opens only when a
process dies between two adjacent writes; the places that actually need the
bytes — serving an image, promoting a baseline — still check, because they are
about to read them. Six queries for those 600 digests.

**Ingesting a build** stored images one subject at a time and made two round
trips per image: about 2,100 for a 300-subject run. It is now three phases for
the whole build — one chunked query for which keys are already here, a `put` for
each one that is not, and a single `batch` claiming every key the build named.
A green suite, where every image is a baseline this deployment handed the run
itself, reaches the bucket zero times and ingests in eight round trips.

**The build listing** ran the four summary queries per build after the listing
query — 201 statements for a page of fifty, issued one after another, which is
where the three seconds went. The summaries are now four `GROUP BY build`
aggregates over the same window of builds, and the page is one `batch`. So is a
build page: `build()` issued thirteen serial statements, read the decisions and
the not-observed rows twice each, and is now one batch of fifteen.

**The crossing fetched the whole build listing** — a page of summaries, four
queries each — to learn the id of the run before this one. `BuildDetail` carries
`previous`, chosen in SQL by the same rule the page always used: by position in
the listing rather than by clock, because two runs pushed from one machine can
share a timestamp to the millisecond.

Two correctness repairs came out of the same reading. The latest-decision join
selected its outer rows on a globally unique sequence number without also
filtering them by project and build, which was right only for as long as that
column stays `AUTOINCREMENT`; it is filtered now, and the index covers it. And
`discard` handed R2 every key it was given in one call while `unreferenced`
defaulted to exactly R2's 1,000-key limit — correct today, and a platform error
for whoever raised that default for any reason. It is chunked.
