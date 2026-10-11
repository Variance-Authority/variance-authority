---
'@variance-authority/sense': patch
---

The Jest seam declares the packages it requires

`@variance-authority/sense/jest-setup` requires `@jest/globals` and
`jest-circus` inside Jest's sandbox, and the manifest did not name either for
you: `@jest/globals` was a development dependency and `jest-circus` was not
listed. Both are now optional peers at `^30.0.0`, beside `jest`. Your Jest
answers both, as before: the runtime answers `@jest/globals` itself, and
`jest-circus` is Jest's default runner, read only when it resolves.
