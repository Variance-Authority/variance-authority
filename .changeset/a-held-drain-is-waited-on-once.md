---
'@variance-authority/playwright-test': patch
---

A drain the page holds is waited on once

When a statement's drain did not settle within its second, every later
statement of the same test still waited a second on that held drain, though it
recorded no line from then on. A test with one held frame paid a second per
remaining statement. Later statements now go through at once, and the teardown
drain reads what they reached, as before.
