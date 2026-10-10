---
'@variance-authority/sense': patch
---

A JavaScript module with JSX in it is recorded

The probes read a module in the dialect its extension names, and `.js`,
`.mjs` and `.cjs` name JavaScript without JSX. A React component written in a
`.js` file did not parse, so it ran without probes and was reported as not
instrumented, while the reader that finds its imports read it with JSX and
found them. On MUI's `mui-material` that left `Button.js` and every other
component out of the record. The probes, the cuts and the readers now share
one dialect, which reads those three extensions with JSX; `.ts` keeps its own,
where `<string>value` is a cast.
