---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance job --suite <name> -- <command>...` runs a command under `strace` and
records what it read and wrote, in any language. `variance select --suite <name>`
selects the whole job from that record: by a file it read, a file appearing where
it found nothing, or a file landing directly in a folder it listed. A file it only
wrote does not select it. A job with no record, an incomplete one or a failed
command runs.
