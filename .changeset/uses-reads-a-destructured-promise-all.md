---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/package': patch
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
promise's: `.then` is no longer listed as a use of an export named `then`.

An assignment destructures an `import()` as a declaration does:
`({ a } = await import('./x'))` and
`[{ a }, { b }] = await Promise.all([import('./x'), import('./y')])` take `a` and
`b`.

A name read off the module's `default`, as in
`const { a } = (await import('./x')).default`, is listed as a use of `a`
"through `default`", one level deep, beside the use of `default` itself: under
CommonJS interop `default` is the module, and the reader cannot tell which one
it is.

A module held whole that leaves the reader's sight — passed to a call,
returned, assigned to a property, stored in an array, read by a key the reader
cannot spell, or loaded lazily — is recorded at that line as a read of the
whole module. `variance ask uses` lists the site for every name of the module,
marked "passed on whole: what it reads is not recorded", and the headline says
how many of the sites are of this kind, where it used to say nothing imported
the name.

The source index format moves to version 32, so the first `variance index`
after upgrading reads every file again.
