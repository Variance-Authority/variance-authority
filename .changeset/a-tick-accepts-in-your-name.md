---
'@variance-authority/cli': minor
---

The action's comment can carry a box. With `tick-to-accept: 'true'` and a workflow
on `issue_comment` running `Variance-Authority/action/tick@v1`, a reviewer with
write access ticks it and the check runs again and accepts, naming them in its log,
its intent and the approval row. A tick from anybody else, or on a head the pull
request has left, accepts nothing. Adding a label still works.

`variance accept --by <name>` writes who accepted on the approval row, for a caller
that knows.
