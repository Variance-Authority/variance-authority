---
"@variance-authority/help": minor
"@variance-authority/sense": minor
---

`variance ask symbol --from <path>` answers as the workspace that owns the path

For an installed third-party name, `--from` takes a file or a directory, and the answer uses the manifest that owns it: the version installed for that workspace and the signature declared in that version. Two workspaces that install different versions of one package each get their own signature. When that manifest neither declares nor imports the package, the answer says the name is not usable from the path and lists every manifest that offers it, each with its version.
