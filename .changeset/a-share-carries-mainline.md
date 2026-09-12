---
'@variance-authority/core': minor
'@variance-authority/store': minor
'@variance-authority/cli': minor
---

Mainline's evaluation can travel, so the next machine does not derive it again

A suite index is bytes addressed by the commit they were written at, which is
exactly the shape a cache already wants. What was missing was anywhere to put
them: every checkout that wanted to know what `main` looked like had to run
`main`, and in CI that is the whole suite, twice, on every pull request.

`@variance-authority/core/share` is the transport, and it has two backends
because there are two. A **directory** is what `actions/cache`, `aws s3 sync`, a
network mount and a laptop all are once the bytes are on disk; an **HTTP
endpoint** is what a bucket, a presigned URL and a tribunal deployment all are.
`createDirectoryShare` in `@variance-authority/store/share` is the filesystem
half, kept out of `core` because `core` takes no platform.

A share never fails a run. `get` answers `null` and `put` resolves, whatever the
network did — a share that is down, misconfigured or empty is indistinguishable
from a cold one, and the run derives its own index and continues. The cost is
deliberate: a typo in an endpoint is a suite that quietly got slower rather than
a build that went red, and the `behind` count `variance share` prints is the
signal that publishing has stopped.

The CLI gained a `share` section in its config, a `variance share` command that
says what the share holds for mainline or publishes what this run derived, and a
line on `variance run` naming where the index went. A lookup walks the lineage —
`merge-base` with the configured `mainline`, then first-parent — and asks this
machine's own cache for every commit before it asks the share, because the run
that just published is usually the one asking.

`docs/sharing.md` is the arrangement end to end, GitHub Actions first.
