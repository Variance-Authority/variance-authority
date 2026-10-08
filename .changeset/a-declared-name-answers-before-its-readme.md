---
"@variance-authority/help": patch
"@variance-authority/sense": patch
---

`variance ask symbol` answers an installed name from its declaration first. A
package whose main entry declares the name is no longer also reported through
its other entry points that declare nothing: `ask symbol --name config
--package dotenv` prints `dotenv · config [function]` and its signature, without
the `dotenv/config` and `dotenv/lib/*` entries and their README passages above
it. A package that declares nothing still points to its README, now after any
declared match. Its entry points are listed one per line, with the README path
and passage printed once below them instead of once per entry point.
Only entry points of the same installed copy are left out: a second copy of the
same version, in another workspace, that declares nothing still points to its
README.
