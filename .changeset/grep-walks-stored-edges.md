---
'@variance-authority/cli': minor
'@variance-authority/help': minor
'@variance-authority/mcp': minor
'@variance-authority/sense': minor
---

`ask grep --from` and `--to` walk the imports `variance index` resolved

A scoped `ask grep` drew the import graph of the whole checkout at question time: every tsconfig and manifest read, every specifier resolved, every mock of every test resolved, to search the few thousand files a start point reaches. It now walks the source tree `variance index` publishes, and only ripgrep's search costs the area. On Kibana a search from one file whose area holds 14,686 files went from 10 s to 0.6 s.

The published tree carries the modules a test loads for real beside its mocks (`vi.importActual`, `jest.requireActual`, a factory's `require`), resolved when the tree is published, so `ask uses`, `ask symbol` and `docs_search` with a start point reach them too, as `ask grep` did. Its format version moves to 2, and a tree published by an earlier version is read again.

A `grep` answer now names the generation it was read from, and is asked again of the checkout as it is when a file of its area changed since; a file that just began importing into its area, or was written under a folder it starts from, waits for `variance index` or the hour.
