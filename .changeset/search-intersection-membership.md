---
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

Keep the same search candidates inside an intersection

`variance ask intersection` now retains the files found by every evaluated
section of a search, including private declarations, members, nested functions,
import aliases, recorded test names and described or loose candidates. Matches
beyond display caps and other matching files of a grouped name remain eligible.
The search's scope, matching rules and standalone output stay the same.
