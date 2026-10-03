---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A base row on a region of another path is not read as motion

When the diff carried a base row onto lines where no region now has its
structural path, case motion took whichever region stood there: a base
`if#0/then` that landed on `if#1/then` was compared with it, and review said
that branch lost every case it had. Now a row pairs with a region of its own
path, or with the same branch renumbered or nested deeper by an edit inside its
function, before it. Any other row is not compared: `CaseMotion.mismatched`
names it with the region it landed on, coverage counts neither of them deleted
or written, and `variance covering` and `variance review` list it as not
compared.

A row an edit touched pairs only with a region of the same branch, so a `then`
never pairs with an `else`.
