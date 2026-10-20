# @variance-authority/sense-linux-arm64-gnu

The prebuilt source scanner for **Linux on arm64, against glibc 2.17 or newer**,
loaded by
[`@variance-authority/sense`](https://www.npmjs.com/package/@variance-authority/sense).

Point your coding agent at [`llms.txt`](https://variance-authority.dev/llms.txt).

Install `@variance-authority/sense` instead of this. It names one of these
packages per platform as an optional dependency, and your package manager
unpacks the one your machine matches. Nothing imports this package by name.

The scanner it carries is an acceleration, not the implementation of record: a
machine that does not get a binary builds the same source index in TypeScript,
more slowly.

Recording a test run needs this binary: it places the probes, and without it
the run stops at its first module.

---

**[@variance-authority/sense-linux-arm64-gnu](https://variance-authority.dev/reference/packages/sense)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · [GitHub](https://github.com/Variance-Authority/variance-authority/tree/main/packages/sense/npm/linux-arm64-gnu) · MIT
