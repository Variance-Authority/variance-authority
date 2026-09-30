---
'@variance-authority/help': patch
---

`variance ask search`, and any source question asked with `--just-answer`, refuses with exit code `2` when nothing is published for the checkout, and names `variance index` as the command that publishes it. Before, a fresh checkout or worktree printed the refusal as a defect in the tool, with a stack trace under it.
