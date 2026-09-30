---
"@variance-authority/package": patch
"@variance-authority/help": patch
"@variance-authority/cli": patch
---

A pnpm workspace's packages open, and `reach` walks past a file the diff deletes

A root manifest with no `workspaces` reads its members from `pnpm-workspace.yaml`, so `ask entrypoint --package @mui/material` answers on Material UI. The list is read as YAML and its entries as globs, so an entry starting with `!` excludes what it matches, a `**` glob reads every member under it, and a list written at its key's own indent, in flow style or under a byte-order mark reads the same as any other. A member two entries match is read once. A bare `.js` export opens by the `.d.ts` written beside it, and a published name followed through a JavaScript module reads that declaration. A workspace that publishes no package says so in a sentence, where it printed an empty list.

`variance reach --since <ref>` takes the files the diff deletes out of the walk and names them on stderr. A diff that only deletes refuses, and the refusal names the deleted files.
