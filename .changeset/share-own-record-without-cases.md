---
'@variance-authority/cli': patch
---

`variance share --suite <name>` names the checkout's own record when that record keeps no cases. The mainline's record is not laid over a record the checkout already holds, so the line names that file, says the mainline's record was not laid over it, and says to delete it and run `variance share --suite <name>` again to take the mainline's. It no longer says the base record was read without its case index, which it now says only when the record it laid keeps none.
