---
'@variance-authority/sense': minor
---

The native scanner arrives prebuilt, for three platforms

The Rust scanner that reads, parses, resolves and records a cold checkout used
to exist only where somebody had a Rust toolchain and had run the build. It now
ships: `@variance-authority/sense-darwin-arm64`,
`@variance-authority/sense-linux-x64-gnu` and
`@variance-authority/sense-win32-x64-msvc` are optional dependencies of this
package, your package manager unpacks the one your machine matches, and nothing
compiles on install — there is no install script here and no `cargo` in the
picture.

**Three platforms, not nine.** An Apple Silicon laptop, a Linux x64 CI runner,
a Windows x64 desktop. The list is short because it can afford to be: the
TypeScript scanner is the implementation of record and the addon is an
acceleration of it, held to the same answers by differential tests, so a Linux
arm64 runner or an Alpine image builds the same source index and pays what the
TypeScript scan costs. Adding a platform is a decision about a machine somebody
ships from, not a completeness exercise.
