---
"@variance-authority/cli": patch
---

`variance ask` refuses a word after the question when the question reads no
report, and exits 2. Every word after the question is a report path, so a
question about the code and a question asked of a watcher had no use for one
and dropped it: `ask packages @kbn/name` listed every package, and `ask search
--query rule executor` searched for `rule`. The refusal names the word and the
flags the question takes, in the sentence a flag it does not take is refused
in:

```
`executor` is not an argument `variance ask search` takes; it takes --query, ...
A value of more than one word is one argument, in quotes.
```

To ask about one package, ask `variance ask entrypoint --package <name>`.
