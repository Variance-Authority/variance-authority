# Code forge

## What it is

Wherever the adopter proposes a change and argues about it: GitHub, GitLab,
Bitbucket. It runs the job, holds the artifacts, and carries the conversation
the review attaches to.

## Good at

Being where people already are. A comment on a pull request reaches a reviewer
without asking them to open anything, hold an account, or learn a second place
to look.

## Bad at

Holding a decision durably. A comment is prose; it cannot be queried, cannot be
counted, and is replaced the next time the job runs.

## How it breaks

Its artifact store loses a shard, so a **subject** nobody looked at is
indistinguishable from one that passed. Its API rate-limits the comment update
and the run reports a failure of the machine as a failure of the product.

## How you talk to it

One comment, found by a marker and updated in place, plus an exit code — `0`
nothing to review, `1` a **verdict** about the product, `2` the run did not
happen. The system renders the comment body; the forge's own integration posts
it. Nothing else crosses.

## Their chart

—
