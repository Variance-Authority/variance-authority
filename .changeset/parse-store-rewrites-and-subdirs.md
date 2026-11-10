---
"@variance-authority/sense": patch
---

An index of a directory inside a worktree reads its primary checkout's parse store under the default cache locations, as the worktree's top already did. A checkout where git writes a module as other bytes than its blob — a filter, `ident`, `working-tree-encoding`, `eol=crlf`, `core.autocrlf=true`, or `core.eol=crlf` over a `text` file (`native` on Windows) — reads no parse store and adds to none, so it never takes a parse of bytes it does not hold.
