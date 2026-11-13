---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A story no longer shows what a module holds

A story no longer lists a module's top-level variables as a `» holds` line;
it shows only what each function was handed, as `» handed`. To find where an
object came from, follow its ref back through the `» handed` lines to the
first step handed it. Story files recorded before this change still read, and
a `» holds` line in one is shown as a printed line.
