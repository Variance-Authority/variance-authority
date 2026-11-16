---
'@variance-authority/cli': minor
'@variance-authority/help': minor
'@variance-authority/mcp': minor
---

A name not found, and every other refusal of a source question, is answered from the generation the question read. It no longer rescans the checkout, rebuilds the dependency lexicon, or publishes a new snapshot first. Before this change, `variance ask symbol` or `ask uses` for an absent name took about ten seconds on a checkout of a hundred thousand files, and now takes about as long as a name it finds. When that generation was made before the question, the answer's last line says the checkout was not compared with it. A function written since then is reported missing until `variance index` runs or `--changed-file` names its file. A found answer whose files changed since its generation is still asked again of one made now, as before. This holds on `variance ask`, `variance serve`, `variance-authority-help` and its server. A server holding a generation, `variance serve` or `variance-authority-help`'s, reads the generation `variance index` published since on its next call, on the same connection and under `--just-answer` too, so the name is found without restarting it; seeing that one was published costs a read of the published value's head.

`caughtUp` no longer takes a lexicon root, and its `again` reads a generation made now with no argument. `madeBefore` says whether a refusal's generation predates the question, and `readAgain` whether a server reads the workspace again before a call: when it holds nothing, a newer generation was published, or, without `justAnswer`, the one it holds has expired. In `@variance-authority/mcp`, `serve` hands `again` only an answer that `outlived` flags, never a refused call, and `answered` receives when the request started.
