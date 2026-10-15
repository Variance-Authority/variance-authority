---
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

`variance index` says which step it is on, and how long each one took

On a large checkout, `variance index` used to print nothing for a minute or
more, so a slow step looked the same as a hung one. It now writes one line to
stderr as each step starts, such as listing the checkout with git, reading what
changed, reading the package manifests or publishing the questions, and writes
the line again with the time the step took when it ends. In a terminal the step
that is running stays on one line, with a clock that counts up while it runs
and a note of how many other steps are running beside it. A log gets the start
line and the end line, and nothing in between. A command that waits on another
process's follow-ups shows that process's latest line, and how long it has
waited. stdout still holds only the answer.
