---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`ask uses` finds more names read off a module object your code holds by an import or a written type. It now counts `typeof ns.x` and `ns.T` in a type, a read off a default import, `import type` ones included, and a read off a value a cast or an annotation types as `typeof import('./x')`, a cast written in place among them, directly or through a top-level alias, and `M['x']` off such a type. A bare `typeof import('./x')` no longer counts as using every name the module exports, and what a call returns is left to TypeScript, so a mock factory that spreads `await importOriginal<typeof import('./x')>()` no longer lists the test as reading every name: the reader does not tell which module that value came from. CommonJS is read on a best-effort basis: the static keys of the object `export =` or `module.exports =` assigns at the top level are exports when every key is spelled, naming a declaration there is no longer listed as a use of it, and a read of one through a default import is marked "through `default`".
