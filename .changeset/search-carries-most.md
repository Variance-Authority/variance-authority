---
'@variance-authority/cli': patch
'@variance-authority/help': patch
---

A search that reaches rows by one common word no longer lists them: a row is shown when the words it holds weigh at least half of the question, the rarer words counting for more, and a question of two words, one of which the repository never writes, is told as a none. Two common words can still outweigh a third word nothing holds.
