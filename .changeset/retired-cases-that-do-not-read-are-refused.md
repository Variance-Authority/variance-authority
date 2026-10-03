---
'@variance-authority/cli': patch
---

Retired cases that do not read are refused

`variance covering --cases last` and `variance review` compare a run with the
cases it retired, kept in the record's `cases.before` section. When that section
was there but did not decode, the report said the record held none of these
cases, as if nothing had come before. It now stops with an error that names the
record and why the section did not read. A record that kept no `cases.before`
still says there was nothing to compare.
