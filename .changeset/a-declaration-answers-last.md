---
'@variance-authority/sense': patch
---

A relative import of a declaration-only sibling resolves to its `.d.ts`

In a package of shared types, where `config.d.ts` imports `./context` and only `context.d.ts` exists, the import was unresolved, and a change to one declaration reached none of the files that import it. A declaration file is now tried last, when the request finds no other file inside your repository or outside it, and `./context.js` finds `context.d.ts` the way `nodenext` writes the request. A module, a stylesheet or a `.json` file of the same name stays the target, and so does a `.js` beside the declaration, because the `.js` is what a runtime import loads. A declaration under a build's `outDir` never answers this way, so a request into built output resolves the same whether you have built or not. Stored records are read again once, because the rule changes what they hold.
