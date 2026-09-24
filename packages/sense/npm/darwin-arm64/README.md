# @variance-authority/sense-darwin-arm64

The prebuilt source scanner for **macOS on arm64**, loaded by
[`@variance-authority/sense`](https://www.npmjs.com/package/@variance-authority/sense).

Install `@variance-authority/sense` instead of this. It names one of these
packages per platform as an optional dependency, and your package manager
unpacks the one your machine matches. Nothing imports this package by name.

The scanner it carries is an acceleration, not the implementation of record: a
machine that does not get a binary builds the same source index in TypeScript,
more slowly.

Recording a test run needs this binary: it places the probes, and without it
the run stops at its first module.
