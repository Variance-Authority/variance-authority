---
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/mcp': minor
---

`ask uses` names the files whose imports the source index resolved to no file when one could take the name, since a use there is not listed. For a name no file here declares but a file imports from a package outside the workspace or a runtime module, the answer names each source and the `discover --imports <source>#<name>` question that lists the files; over MCP it names the command to run in the checkout, since `docs_discover` there refuses the question. A path alias such as `@/lib`, a `paths` or `baseUrl` mapping a `tsconfig` or `jsconfig` declares, and a package of this workspace are never named as outside sources; an unresolved one of them, or a `#` subpath import, is named among the files that could take the name. `@variance-authority/sense` publishes `outsideSourcesOf(root, name, index?)`, and `importersOf` carries `unresolved`. `@variance-authority/mcp/tools` publishes `conjoined`, which joins words as `a, b and c`.
