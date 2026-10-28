---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

A namespace a file imports and exports by its local name, `import * as ns from './x.js'; export { ns }`, is read as the `export * as ns from './x.js'` it is: `variance ask uses` lists `ns.name` read off it in a file that imports `{ ns }`, and `lib.ns.name` off `import * as lib`, and no longer lists the barrel itself as a place that may read the name.
