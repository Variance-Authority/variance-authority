---
'@variance-authority/sense': patch
---

The mock reader reads `jest.requireActual` and `vi.importActual` anywhere in a test file as an import of that module, and a mock of the same module no longer shadows it. A test that hands its mock the original implementation — `jest.fn(jest.requireActual('./x').X)`, or a `beforeEach` that restores it — is selected again when that module or anything under it changes. Cached mock readings from earlier versions are read again once.
