---
'@variance-authority/sense': patch
---

A `pnpm-lock.yaml` that aliases a package to a tarball URL is read. pnpm writes that key unquoted, `zod443@https://registry.npmjs.org/zod/-/zod-4.4.3.tgz:`, and the reader split it at the first colon, refused the file, and `variance select` ran every test on any commit that changed the lockfile. A plain key now ends where YAML ends it, at the first colon followed by a space or the end of the line.
