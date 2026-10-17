---
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/package': patch
'@variance-authority/sense': patch
---

`variance ask uses` lists the lines that use a name in the file declaring it
under that file, `Used in <file>, which declares it:`, one heading for each
declaring file. Before, a name declared in several files had the lines of all
of them under one heading that said they were in the file that declares it.

The export heading names the kind of the declaration the name is published or
exported as, as the source index holds it: "`addTax` [function] is imported in
1 place", "`orphan` [const] is exported, without being published". An export
that passes the name on with `export … from` names no kind. `Named` carries it
as `declaration`, and the Help snapshot moves to version 7.
