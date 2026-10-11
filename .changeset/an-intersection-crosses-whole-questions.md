---
'@variance-authority/cli': minor
'@variance-authority/help': minor
---

`variance ask intersection` answers the files every one of two or more questions answers

Each operand is a whole question, typed in quotes the way it would be asked
alone — `variance ask intersection 'symbol --name selectBalance' 'discover
--from src/Wallet.tsx'` — and any question whose answer is a set of files can
be one: `symbol`, `uses`, `search`, `grep`, `discover`. Each is read whole,
never capped, so a file past the first fifty of either question still meets.
The answer counts each question's files, then lists the files in all of them,
each with the lines that put it in each question. `variance-authority-help
intersection` and `docs_intersection` answer the same, the tool taking its
questions as `{question, input}` objects.
