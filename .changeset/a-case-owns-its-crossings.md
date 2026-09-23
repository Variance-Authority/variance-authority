---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A mock no longer disowns what a case crossed. The runner installs a mock before the file's first case, so every crossing recorded inside a case or a hook ran the real module and selects that case, even in a module its file mocks. A mock still cuts what ran only while the module was evaluated, which is how a runner shapes an automock.
