---
'@variance-authority/sense': patch
---

The probes go in first, and a workspace library loaded from its build is recorded as its source

Every seam now places its probes on the text you wrote, before any other
transform: `testSelectionProbes` and the Vitest plugin at `enforce: 'pre'`, the
Jest transformer ahead of the one it wraps, and the Rstest loader ahead of SWC.
A record is named after the file, digested as its text and placed on its own
lines, so nothing a compiler writes — decorator helpers, a generated
constructor — is recorded, and Jest stack traces keep their lines.

A module that ends in a `//# sourceMappingURL=` comment naming a sibling map of
exactly one source outside `node_modules` is recorded as that source, on its
lines, when `include` accepts it: `ui/dist/Button.js` counts as
`ui/src/Button.ts`. A library an application imports through its `tsc` build
is now recorded by a Vite dev server and by `vite build` alike, where before the
default include refused it. Anything else — an inline map, a bundle's many
sources, a map that cannot be read — is recorded under its own name.
