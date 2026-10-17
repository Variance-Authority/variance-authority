---
'@variance-authority/sense': patch
---

`uses` counts each name destructured from an `import()` resolved through `Promise.all`

`const [{ a }, { b }] = await Promise.all([import('./x'), import('./y')])` takes
`a` from `./x` and `b` from `./y`, as `const { a } = await import('./x')` does.
The module reader now pairs each element of the array pattern with the
`import()` at the same position, in a declaration and in the callback of
`Promise.all([...]).then(([...]) => ...)`, so `variance ask uses` lists the file
for each name. A hole skips its position, and a spread leaves every later
position unpaired.

A TypeScript cast around the awaited call, as in
`(await import('./x')) as typeof import('./x')`, no longer hides the names
destructured from it, and a rest element such as `{ a, ...rest }` holds the
module, so `rest.b` is a read of `b`.

A property read off the promise an `import()` returns, without `await`, is the
promise's: `.then` is no longer listed as a use of an export named `then`. The
source index format moves to version 31, so the first `variance index` after
upgrading reads every file again.
