---
'@variance-authority/sense': patch
'@variance-authority/sense-darwin-arm64': patch
'@variance-authority/sense-linux-arm64-gnu': patch
'@variance-authority/sense-linux-x64-gnu': patch
'@variance-authority/sense-win32-x64-msvc': patch
---

A call that throws while a function's parameters bind now counts as entering
the function. Before, `f('label')` against `function f(label, { required })`
threw before the body ran, so the test was never recorded as entering `f`. An
edit that gave the parameter a default then selected nobody. The function's
`length`, its `arguments` and the order its parameters bind in are unchanged.
The one exception is a first parameter that is an object pattern: its text
stays as written, because Vitest, Playwright and Rstest read fixture names from
it.

An edit to any line of a multi-line `await` now also selects the tests that
entered the function, not only the tests that resumed after it. The awaited
expression is evaluated before the await settles, so a test whose promise
rejected ran that line too.
