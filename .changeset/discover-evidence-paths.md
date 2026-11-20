---
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

Print discovery paths once per evidence group

`variance ask discover` prints each file as a heading, with line numbers and
evidence text beneath it. Numbered evidence lines no longer repeat
the heading's path. Matching, order, limits, counts and warnings stay the same.
