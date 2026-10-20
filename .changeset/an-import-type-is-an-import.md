---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/package': patch
---

An `import()` type is a type-only import

`import('./x').T` and `typeof import('./x')` are TypeScript's other spelling of
`import type`, and the reader skipped both: a file that reached a module only
through one, such as a test handing `typeof import('./x')` to a `vi.mock`
factory's original, had no edge to it, and `ask uses` did not list it. Each is
now a `type` request, an edge every walk but a runtime one follows. The name its
qualifier starts with is the name it takes; with no qualifier the module is
held whole, and `ask uses` lists the line as a type-only site that may read any
name, never as an `import()` that loads the module. The source index format
moves to version 33.
