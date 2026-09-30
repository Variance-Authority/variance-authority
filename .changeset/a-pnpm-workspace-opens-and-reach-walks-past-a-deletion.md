---
"@variance-authority/package": patch
"@variance-authority/help": patch
"@variance-authority/cli": patch
---

A pnpm workspace's packages open, and `reach` walks past a file the diff deletes

A root manifest with no `workspaces` reads its members from `pnpm-workspace.yaml`, so `ask entrypoint --package @mui/material` answers on Material UI. A bare `.js` export opens by the `.d.ts` written beside it, and a published name followed through a JavaScript module reads that declaration, as TypeScript does. A workspace that publishes no package says so in a sentence, where it printed an empty list.

`variance reach --since <ref>` takes the files the diff deletes out of the walk and names them on stderr. A diff that only deletes refuses, and the refusal names the deleted files.
