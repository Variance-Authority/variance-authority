---
'@variance-authority/sense': minor
---

Sense has one module reader now: the native addon. The JavaScript reader it used without the addon is gone. On a machine where the addon does not load, reading a module fails with the reason instead of falling back to a slower second copy. That copy had already fallen behind: it never recorded the names read off `import()` or a namespace.

A React component in a `.js`, `.mjs` or `.cjs` file now reads with its JSX, both in the file graph and when test selection reads a change. The addon used to leave JSX off for those extensions. A scan without the addon hid the problem, and on a machine with the addon those files got no edges, and a change to one was charged as a file that does not parse.
