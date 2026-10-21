<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/jest-transformer

> Run a project's own Jest transformer inside yours: loaded the way Jest loads
> it, handed its own options, and asked which files Jest calls tests.

Part of [Variance Authority](https://variance-authority.dev).
Point your coding agent at [`llms.txt`](https://variance-authority.dev/llms.txt).

## What this is for

You install this only when you write a Jest transformer that runs around the
one a project already uses — `@swc/jest`, `ts-jest`, `babel-jest` — rather than
replacing it. The transformers in
[`@variance-authority/sense/jest-transform`](https://variance-authority.dev/reference/packages/sense)
and
[`@variance-authority/isolator/jest`](https://variance-authority.dev/reference/packages/isolator)
are two of those, and both reach the project's transformer through this
package. If you use either, it arrives as their dependency and you never import
it yourself.

A wrapper that loads the project's transformer itself has to agree with Jest on
four things, or the wrapped run differs from the one without it:

- where the transformer is resolved from: the project first, and where
  `jest-config` finds it after that, since `babel-jest` is Jest's dependency
  rather than the project's;
- how it is loaded: `require`, `import` when it is an ES module, an awaited
  export, and its `createTransformer` factory when it has one;
- what it is handed: the options its own entry gave it in `transformerConfig`,
  and `{}` when it gave none — never the wrapper's options;
- which files are tests: `testMatch` and `testRegex` read as Jest reads them.

## Requirements

Node 22 or newer, and an ESM consumer. It depends on `picomatch` and nothing
else: no native addon, so a build transform can load it.

## Load the project's transformer

```ts
import { isTestFile, jestCacheKey, loadTransformer } from '@variance-authority/jest-transformer';

export async function createTransformer(config) {
  const theirs = await loadTransformer(config.root, config.transformer);
  return {
    canInstrument: theirs.canInstrument,
    getCacheKey: (source, path, options) => mine(path, theirs.cacheKey(source, path, options)),
    processAsync: async (source, path, options) =>
      isTestFile(path, options.config)
        ? await theirs.processAsync(source, path, options)
        : await theirs.processAsync(rewrite(source), path, options),
  };
}
```

`loadTransformer(root, entry)` takes the entry as a Jest configuration names
it, `'@swc/jest'` or `['@swc/jest', options]`, and returns the transformer
already bound, asked with its own options:

| Member | What it answers |
| --- | --- |
| `name`, `options` | The module and the options its entry gave, for your own cache key and messages. |
| `transformer` | The transformer itself, for a member only your wrapper knows to ask about. |
| `cacheKey`, `cacheKeyAsync` | Its key for a module, or `jestCacheKey`, Jest's own, when it declares none. |
| `process` | Its synchronous transform, absent when it has none. Offer your own `process` only when this is there: Jest takes the synchronous path for every CommonJS module, and a wrapper answering it by blocking on an asynchronous transform hangs. |
| `processAsync` | Its asynchronous transform, or its synchronous one. |

Your own key still has to change with everything your step reads: hash its
inputs together with the one `cacheKey` returns.

## Which files are tests

`isTestFile(path, config)` reads the project configuration Jest hands every
transform: a path matching one `testMatch` glob and no negated one, dotfiles
included, or matching any `testRegex`. `globMatcher(globs)` is the same glob
reading for a list of your own, and `slashed(path)` is Jest's separator rule
behind it: a Windows backslash reads as `/` unless it escapes a glob's special
character.

`jestCacheKey(source, path, options)` is Jest's own default key: it hashes the
source, the path, the `configString` Jest hands every transform, and whether
`instrument` asked for coverage. `JestTransformOptions` types those three, with
the project `config` that `isTestFile` reads.

## License

MIT © Machine Garden

---

**[@variance-authority/jest-transformer](https://variance-authority.dev/reference/packages/jest-transformer)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · [GitHub](https://github.com/Variance-Authority/variance-authority/tree/main/packages/jest-transformer) · MIT
