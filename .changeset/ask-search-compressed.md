---
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`variance ask search` answers in fewer lines. When the repository answers, the installed names and the packages that describe your words are each one line naming up to five, and the line saying no installed name matched is left out; a suite whose recorded cases were not read is named on one line, and only when no case matched; the near-match and loose headings are one short line; and an answer with a published or exported row ends with `Next:` and the command for its first row. Each list shows at most 20 published rows and 10 of every other kind unless `--limit` says more.
