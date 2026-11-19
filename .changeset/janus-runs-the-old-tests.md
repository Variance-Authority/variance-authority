---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance janus --since <ref> --file <path>... -- <command>` runs a command with each named file rolled back to its text at the ref, in place, so the old tests run on the new code with nothing checked out. Each file must exist in the checkout and at the ref: janus rolls back changes in existing files, and neither adds nor hides one. A run that never read a file it was served fails and names it.
