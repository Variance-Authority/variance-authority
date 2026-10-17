---
'@variance-authority/sense': patch
---

A Jest test file now fails when Jest's module registry holds a module whose probes ran and that the file's journal does not name, rather than writing a journal that selects too little. Modules that `jest.resetModules`, `jest.isolateModules` or an automock evaluated outside the registry are not held against it.
