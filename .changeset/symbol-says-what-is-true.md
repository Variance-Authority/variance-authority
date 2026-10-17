---
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`ask symbol` answers a member, and says what it checked for a name nothing declares

A method or property of an interface, a type literal or a class is answered
with its container and the file and line that declare it, one block per
declaration, as `ask uses` already lists them. It used to be refused.

A name nothing in the workspace declares is refused with what was read: no file
the source index read declares it at its top level or as a member, and no
installed dependency publishes it. When the dependency lexicon is not published, the refusal says
the dependencies were not checked and that `variance index` publishes it. It
used to answer only `the dependency lexicon is not published`, for a name the
workspace declares as a member or does not declare at all. The files whose
declarations the source index did not read are named last, as not checked.
