---
'@variance-authority/sense': patch
---

Jest: a test file that names its own environment with `@jest-environment` now runs under it, and that environment's entry and the repository files it loads are recorded as inputs of that test file alone. The environment is found the way Jest found it, and a project's own `runtime` still runs.
