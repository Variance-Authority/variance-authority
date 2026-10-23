<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/isolator

> A build transform that gives a module's mutable state one value per session, so each test, request or run starts from the values the module was loaded with.

Part of [Variance Authority](https://variance-authority.dev).
Point your coding agent at [`llms.txt`](https://variance-authority.dev/llms.txt).

**Experimental.** Every read of a rewritten variable goes through a JavaScript
frame, and what that costs a hot path has not been measured; the transform's
performance waits on a Rust port.

A module-level `let` outlives the test that changed it, and so does the `Map`
a `const` holds. [`@variance-authority/ioc`](https://variance-authority.dev/reference/packages/ioc) lets the module that owns
that state say how to reset it, which works when you can write a handler for
every variable — and stops working in a codebase with hundreds of them that
nobody is going to annotate.

This package writes the handler for you, at build time. It moves each
module-level variable into a frame that keeps one set of values per *session*,
and lets the environment say what the session is:

- **In a test run**, ioc's per-test driver starts a new session before each
  test, so every test reads the values the module was evaluated with.
- **In Node**, `isolated(fn)` runs `fn` in its own session, carried through
  every `await` by `AsyncLocalStorage`.
- **In React Server Components**, the request is the session, through React's
  `cache`.
- **In a browser**, `nextSession()` starts a new one between runs.

```bash
npm install --save-dev @variance-authority/isolator @variance-authority/ioc
```

## Requirements

Node 22.15 or newer, on macOS (Apple silicon), Linux (glibc, x64 or arm64) or
Windows (x64): which modules declare side effects is read by
[Sense](https://variance-authority.dev/reference/packages/sense)'s native reader. React 19 only for the React entry. The transform is one
function, `isolate(code, file)`; Jest 30, Rspack 2 and webpack 5 get a seam
that calls it, and any other build tool calls it itself.

## What it rewrites

```ts
let count = 0;
const seen = new Set<number>();

export const next = () => {
  count += 1;
  seen.add(count);
  return count;
};
```

becomes, on the same lines:

```ts
import * as __isolator from "@variance-authority/isolator/runtime"; const __frame = __isolator.frame({"count":"let","seen":"const"}); __frame.step(() => { __frame.init.count = 0 });
__frame.step(() => { __frame.init.seen = new Set<number>() });

export const next = () => {
  __frame.$.count += 1;
  __frame.$.seen.add(__frame.$.count);
  return __frame.$.count;
};
```

Only state a session can change moves. A `let` or `var` the module writes
somewhere — an assignment, an update, a loop head — and does not export
becomes a step of the module's frame, and every place that names it reads the frame. So does any
declaration that holds an object literal, an array literal, or a new `Map`,
`Set`, `Array` or `Object`. A `let` nobody writes is a `const` in all but name,
and it stays as it is. A function or a class is never wrapped, however it is
declared, so a component, a hook or a handler is the one React and every other
caller always saw. A parameter, a
block's own `let` or a catch clause that declares the same name is a different
variable, and it is left alone. Nothing the module exports is touched:
`module.exports` and `export` keep the bindings they always had.

The module runs each step once, as it reaches it, as it always did, and what
it holds when its last statement has run — a `let` reassigned, a handler
pushed, a `Map` filled — is where every session starts, the one it loaded in
too. A session copies those values the first time it reads the module: arrays, plain objects
and the values of a `Map` are copied as deep as they go, one copy per object, so
`const y = { x }` still holds that session's `x`. A `Set`'s members, a `Map`'s
keys, a frozen object and an instance of a class are the same objects in every
session. Reading a `let` before its declaration still throws, and so does writing it
inside its own initializer; a `var` still reads `undefined`. An array keeps its
symbol keys and holes.

A value built by a call — `memoize(fn)`, `createStore()`, a higher-order
component — is left as it is when nothing writes it again, and so is what it
closes over. A module that has to reset one says so with `registerResetHandler` from
[`@variance-authority/ioc/reset`](https://variance-authority.dev/reference/packages/ioc).

## Run it in Jest

```js
// jest.config.mjs
export default {
  setupFilesAfterEnv: ['<rootDir>/reset.setup.cjs'],
  transform: {
    '\\.[jt]sx?$': ['@variance-authority/isolator/jest', { transformer: '@swc/jest' }],
  },
};
```

```js
// reset.setup.cjs
const { configureResetHandler } = require('@variance-authority/ioc/reset/setup');

configureResetHandler(beforeEach);

const { isolateConcurrentTests } = require('@variance-authority/isolator/node');

isolateConcurrentTests(test);
```

`transformer` names the transformer that would have run without this one —
`@swc/jest` here, `babel-jest` or `ts-jest` in your project — as Jest's
configuration would: a name, or a name and its options. It runs on
the rewritten text, and its source map is composed with this one, so a stack
trace and a coverage report still name the line on disk.

The setup has to load before any rewritten module, for the reason
[ioc](https://variance-authority.dev/reference/packages/ioc#install-the-driver-in-the-test-setup) gives: the runtime registers
its reset when it is imported, and ioc refuses one that registered first.

`test.concurrent` runs its tests side by side, and Jest gives them no
`beforeEach` of their own. `isolateConcurrentTests(test)` runs the body of
every `test.concurrent`, `.only`, `.each` and `.failing` in its own `isolated`
session instead.

Test files are not rewritten. A test file's own `let` carries what a
`beforeAll` set into the tests after it, which is what a test file means by it.
Neither is anything under `node_modules`, nor a module its package lists in
`sideEffects`.

## Run it in Rspack or webpack

```js
// rspack.config.mjs, or webpack.config.mjs
export default {
  module: {
    rules: [
      { test: /\.[jt]sx?$/, exclude: /node_modules/, enforce: 'pre', loader: '@variance-authority/isolator/loader' },
    ],
  },
};
```

`enforce: 'pre'` hands it the file as it is on disk, before your own loaders,
so its map names that file and theirs compose with it. Leave your test files
out of the rule, as the Jest transformer does: a test file's own `let` carries
what a `beforeAll` set into the tests after it.

In a browser, call `nextSession()` before every run, so each starts from the
values its modules were loaded with.

## Run it in another tool

```js
import { isolate } from '@variance-authority/isolator/transform';

const { code, map, left } = isolate(source, path);
```

`isolate` takes a module's text and its path, whose extension decides how it
is parsed, and returns the rewritten text, its source map — `undefined` when
nothing moved — and what it left shared, with the reason. Hand it the file as
it is on disk, before any other transform, and skip test files,
`node_modules` and what `sideEffects` lists, as the Jest seam does.

## Keep a variable shared

Some state is meant to be shared: a connection pool, a logger, a registry every
session adds to. Mark the declaration on the line before it, or at the end of its
own line:

```ts
// @isolator-ignore
let pool = createPool();

const registry = new Map(); // @isolator-ignore
```

A module that does something when it loads — registers a handler, installs a
polyfill, keeps a pool — says so where bundlers already look: `sideEffects` in
its package's `package.json`. Every module that field names is left as it is,
`true` naming the whole package, a pattern or a list naming files, and a
pattern without a slash matching a file name at any depth. A pattern that names
built output, such as `./dist/register.js`, leaves the source its `tsconfig`
builds it from. A package that leaves the field out, or sets it to `false`, is
rewritten: where a bundler keeps a silent package's modules, the isolator reads
the silence as no side effects. This package and
[ioc](https://variance-authority.dev/reference/packages/ioc) declare `true`,
so the state they keep across tests stays one.

```json
{ "sideEffects": ["./src/register.ts", "*.polyfill.js"] }
```

Put `@isolator-ignore-file` in a comment anywhere in a file to leave the whole
file. To leave paths without touching them, give the transform globs in
`exclude`. Jest reads them from the working directory, or from `root` when you
give one; the loader reads them from the build's context:

```js
['@variance-authority/isolator/jest', { transformer: '@swc/jest', exclude: ['src/legacy/**'] }]
```

```js
{ loader: '@variance-authority/isolator/loader', options: { exclude: ['src/legacy/**'] } }
```

## What it leaves, and tells you

Anything it cannot rewrite safely, it leaves shared and names, as a Jest
warning or a build warning:

```
isolator: src/mode.ts:1 `mode` stays shared: an exported `let` is read by its importers as a live binding, which no getter can stand in for
```

- **An exported `let` or `var`.** An importer reads the binding itself, and the
  transform sees one file at a time, never the importer. Export a function that
  reads it instead.
- **An object that leaves the module when it loads**, or a part of it:
  exported, put in `module.exports`, held by another `const`, or handed to a
  call such as `register(handlers)` or `register(state.items)`. Whoever took it
  holds that reference. Without types the transform cannot tell a part that is
  a number from one that is an object, so `log(state.count)` leaves `state` too.
- **An object that holds one of those, or an import**, or is handed one as the
  module loads: `const a = { b }`, `const routes = [home]`,
  `keep.push(state.items)` or `a.child = b`, where `b` and `state` stay and
  `home` is imported. A session's copy of `a` would hold a copy of `b`, not `b`.
- **An instance of a class**, such as `new Client()`. A session cannot copy it.
- **A function the module reassigns**, such as `let handler = () => {}` with
  `handler = next` later. A function is never wrapped.
- **A `var` declared twice**, or that a function or a class declares too.
  Which declaration wins is the module's own order.
- **A `var` inside a top-level block, loop head or `try`**, such as
  `for (var i = 0; …)`. It belongs to the module, but its declaration is no
  statement a step can stand in for. Declare it at the top level.
- **A module that awaits at its top level.** It is still loading while other
  sessions run, and their writes would be where every session starts, so the
  whole module is left.
- **A module that calls `eval` or reads through `with`.** Either can name a
  variable no reader of the source sees, so the whole module is left.

## Where the session comes from

| Entry point | What it does |
|---|---|
| `@variance-authority/isolator` | `nextSession()` starts a new fallback session; `currentSession()` answers with the session in force; `addSessionSource(source)` adds a source, asked before any added after it. |
| `@variance-authority/isolator/node` | `isolated(fn)` runs `fn` in a new session, through every `await` it starts; `isolateConcurrentTests(test)` gives each concurrent Jest test one. Every copy of this entry in a process shares one store, so an inner `isolated` always wins. |
| `@variance-authority/isolator/react` | `requestSessions()` makes each React Server Components request a session, through every Suspense boundary it streams. React's `cache` keeps a request only in the Flight renderer, under the `react-server` condition. |
| `@variance-authority/isolator/jest` | The Jest transformer. |
| `@variance-authority/isolator/loader` | The loader for Rspack and webpack. |
| `@variance-authority/isolator/transform` | `isolate(code, file)`, the transform itself, for any other tool. |
| `@variance-authority/isolator/runtime` | `frame`, which rewritten modules import. |

The first source that answers wins. When none does — in a test, or in a browser
— the fallback session answers, and `nextSession()` replaces it. A session is an
object, and a frame keeps its values in a `WeakMap` keyed by it, so a session
nobody holds any more takes its values with it.

## What it does not cover

- **An object a function hands away when the module calls it as it loads**,
  as `function setup() { register(handlers); } setup();` does. The transform
  reads what the module does at its top level, not inside the functions it
  calls; mark the declaration `@isolator-ignore`.
- **Vitest.** There is no Vite plugin yet.
- **A class's static fields.** They live on the class, which is one object for
  every session.
- **State inside a package you do not build.** `node_modules` is never
  rewritten.

## License

MIT © Machine Garden

---

**[@variance-authority/isolator](https://variance-authority.dev/reference/packages/isolator)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · [GitHub](https://github.com/Variance-Authority/variance-authority/tree/main/packages/isolator) · MIT
