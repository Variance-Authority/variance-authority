---
'@variance-authority/cli': patch
'@variance-authority/help': patch
---

The `search` tool description, the skill and both READMEs say that `search` lists
candidates, not every match, and that `git grep -i <word>` prints every tracked
line that writes a word. The skill no longer says that a `search` list with no
"more not shown" line is the whole list.
