---
'@variance-authority/cli': patch
---

`variance carry take` now prints `against-<suite>` for every declared suite a
restore laid cases for, not only for the suites it takes, so a pull
request's first push, or a push whose last record could not be taken, compares
with the mainline.
