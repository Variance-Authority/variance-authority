---
'@variance-authority/sense': patch
---

A mock factory that loads its original keeps the edge, whatever it names the loader

Vitest calls a `vi.mock` factory with a function that loads the original
module, and the test names that parameter. The mock taint counted the
factory as loading the original only when it spelled the word
`importOriginal`. So `vi.mock('./api', async (original) => ({ ...(await
original()) }))` cut the edge to `./api`, and a change to `api.ts` did not
select a test that runs it. A factory now loads the original when it refers to
its first parameter under any name, called, aliased or passed on. A `function`
factory that reads `arguments` loads it as well. A property that is merely
named `importOriginal` no longer keeps an edge the mock replaced.
