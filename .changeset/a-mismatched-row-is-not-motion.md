---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A base row on a region of another path is not read as motion

When the diff carried a base row onto lines where no region now has its
structural path, case motion took whichever region stood there: a base
`if#0/then` that landed on `if#1/then` was compared with it, and review said
that branch lost every case it had. Now a row pairs with a region of its own
path, or with a sibling whose occurrence an edit inside the enclosing function
changed. Any other row is not compared. A row an edit touched pairs only with
a region of the same path shape, so a `then` never pairs with an `else`. `CaseMotion.mismatched` names it with
the region it landed on, and coverage counts it neither deleted nor written.
`variance covering` and `variance review` list these rows as not compared: the
base does not match its own text.
