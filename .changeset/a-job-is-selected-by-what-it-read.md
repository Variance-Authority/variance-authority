---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance job --suite <name> -- <command>...` runs a command under `strace` and
records what it read and wrote, in any language. `variance select --suite <name>`
selects the whole job from that record: a change to a file it read selects it, and
a change to a file it only wrote does not. A job with no record, an incomplete one
or a failed command runs.
