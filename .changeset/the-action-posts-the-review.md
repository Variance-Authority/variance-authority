---
'@variance-authority/cli': minor
---

`Variance-Authority/action/review` runs `variance review --coverage` after your
tests and posts the review as one comment updated in place, so a project with
only unit tests needs no script of its own to put it on the pull request. Its
README has the cache steps that give the comment a mainline record to compare
with.

`variance carry take` keeps the mainline's record it sets aside out of the
change, in a project that does not ignore `.variance/`, and a review refused for
naming no start says when the clone is shallow and how to check out every
commit.
