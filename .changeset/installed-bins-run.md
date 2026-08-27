---
'@variance-authority/cli': patch
---

Run when invoked through the symlink a package manager installs.

`npm install` writes `node_modules/.bin/variance` as a link into the package, so
`process.argv[1]` is the link while `import.meta.url` is its target. The
main-module guard compared the two as written, which is true only when the file
is run by its own path — inside this repository. Installed, `npx variance run`
evaluated the module, dispatched nothing, and exited `0`: a gate reporting
success without opening a browser. Both executables now resolve each side
through `realpath` before comparing, and `tools/bin-symlink.check.ts` runs every
declared bin twice, by path and through a link, and requires the two to agree.
