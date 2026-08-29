---
'@variance-authority/tribunal': minor
---

Run the review service on a machine you own — a SQLite file, a directory, a port.

The package shipped one deployment and named none: every module above the
bindings takes a `D1Like` and an `R2Like`, so what stood between it and a laptop
was two adapters and a shell. `@variance-authority/tribunal/node` supplies them.
`openDatabase` opens, creates and migrates a SQLite file through `node:sqlite`
and reports the version it settled on; `createDirectoryBucket` puts objects in a
directory through `node:fs`, each written to a staging file and renamed so a
reader never sees half of one, and refusing a key a case-folding volume would
land on another key's file. `serveTribunal` binds a `node:http` server over the
same `createTribunalRoutes` the Next.js adapter uses, so the token-attaching rule
has one implementation rather than two.

`variance-authority-tribunal` is that service as an executable, configured by the
environment. It refuses an unnamed project, refuses a non-loopback bind unless
`VARIANCE_TRIBUNAL_TRUST_NETWORK` says so, and on a network bind serves no review
surface at all — there would be nothing between an approve button and the
internet. On loopback it serves the surface and treats an untokened caller as the
reviewer, because anything that can open the port is already the person who
started the process. No token is written into the page or into the startup line.

The SQLite adapter `testing.ts` had privately is now that shipped adapter, so
what the suite exercises is what an operator runs.
