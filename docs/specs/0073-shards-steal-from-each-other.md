# Spec 0073 — shards steal from each other

**Missing:** a queue the shards of one build share. Today each shard computes its
own slice of the suite before it collects anything, either from the costs
mainline recorded or from a checksum, and works that slice to the end. Inside a
shard the workers already steal from one queue (`steal` in
[`lanes.ts`](../../packages/cli/src/commands/lanes.ts)), so no world sits idle
while another has files left. Across shards nothing does: a shard whose files
were cheaper than the record said finishes and exits while another is still
collecting, and the build waits for the slowest one.
**Built on:** `assign` and `groupOf` in
[`shard.ts`](../../packages/cli/src/commands/shard.ts) (file groups, placed
longest first), `steal` and the per-lane queue, `costMs` on every observation,
the subject costs published under a commit, and `tribunal`'s Worker, which
already holds the history and the baselines of a project.

## Purpose

A split planned before the run is only as good as the record it was planned
from. A new file is priced at the median, a story that got slower is priced at
what it used to cost, and a runner that starts late starts late. Each of these
leaves one shard with work after the others are done. The spread between the
first shard to finish and the last is what the build pays for a stale record.

A shared queue removes that spread. Every shard pulls the next file group from
one place, longest first, and stops when the queue is empty. The split then
follows what each group costs today, and the record only orders the queue.

## What would discharge it

**1. One queue per build, keyed by what the shards already share.** The build
is named by the run identity the shards already agree on (`GITHUB_RUN_ID` and
`GITHUB_RUN_ATTEMPT`, or `--run`). The queue is a Durable Object addressed by
that identity and the commit, so every shard of one attempt reaches the same
queue and a re-run reaches a fresh one.

**2. The first shard to arrive fills it.** It pushes the file groups in the
order `assign` produces with no shard given: longest first by recorded cost, or
plan order when nothing was recorded. A shard that arrives later finds it
filled. Two shards that plan different suites are a finding, not a race: the
queue refuses the second plan and that shard runs its own checksum slice.

**3. A lease, not a claim.** A shard takes a group for a bounded time and
renews while it collects. A lease that expires puts the group back, so a
runner that dies costs the build one group's time, not the group.

**4. The report says who took what.** An exclusion reads *taken by shard k*,
the same shape as *assigned to shard k/n*, so the merge's check that every
subject was observed somewhere holds unchanged.

**5. The queue is never required.** When the queue cannot be reached, the shard
places by recorded cost or checksum exactly as it does now. The run does not
fail, and it says which placement it used.

## Acceptance

- Three shards over a suite whose record prices one file at a tenth of what it
  now costs finish within one file group's time of each other.
- A shard killed mid-run leaves no subject unobserved in the merged report.
- A run with the queue unreachable produces the same report as `--shard k/n`
  does today, with a warning naming the queue.

## Out of scope

**Stealing a single story out of a file.** A file group stays whole, for the
reason it does on one machine: its stories load the same modules.

**Balancing across builds.** The queue lives for one attempt. What the next
build should expect is still the published subject costs.
