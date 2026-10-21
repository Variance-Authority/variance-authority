---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`ask uses` finds a name read off a module object wherever your code holds one. It now counts `typeof ns.x` and `ns.T` in a type, a read off a default import, and a read off a value a cast or an annotation types as `typeof import('./x')`, directly or through a top-level alias, and `M['x']` off such a type. A bare `typeof import('./x')` no longer counts as using every name the module exports, and a call's type argument holds nothing, so a mock factory that spreads `await importOriginal<typeof import('./x')>()` no longer lists the test as reading every name. CommonJS is read on a best-effort basis: the static keys of the object `export =` or `module.exports =` assigns at the top level are exports when every key is spelled, naming a declaration there is no longer listed as a use of it, and a read of one through a default import is marked "through `default`".
