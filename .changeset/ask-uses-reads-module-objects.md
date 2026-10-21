---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`ask uses` finds a name read off a module object wherever your code holds one. It now counts `typeof ns.x` and `ns.T` in a type, a read off a default import, and a read off a value a cast, an annotation, a top-level alias or a call's one type argument types as `typeof import('./x')`. A bare `typeof import('./x')` no longer counts as using every name the module exports, so a mock factory that spreads `await importOriginal<typeof import('./x')>()` no longer lists the test as reading every name. CommonJS is read on a best-effort basis: the static keys of the object `export =` or `module.exports =` assigns at the top level are exports, and a read of one through a default import is marked "through `default`".
