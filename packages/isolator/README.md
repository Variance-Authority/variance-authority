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

- **In a test run**, ioc's driver gives each test a session of its own that
  starts from what its file wrote outside tests.
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
that calls it, Vitest 5 a plugin, and any other build tool calls it itself.

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
too. What it writes into another module as it loads, such as a plugin it adds
to a registry that module holds, lands in every session — the ones that already
read that registry, beside what they wrote, and every one after — since the
module is not loaded again for them. A class's static fields and static blocks
run as it loads too. A session copies those values the first time it reads the module: arrays, plain objects
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

configureResetHandler(beforeEach, afterEach);

const { isolateConcurrentTests } = require('@variance-authority/isolator/node');

isolateConcurrentTests(test);
```

`transformer` names the transformer that would have run without this one —
`@swc/jest` here, `babel-jest` or `ts-jest` in your project — as Jest's
configuration would: a name, or a name and its options. It runs on
the rewritten text, and its source map is composed with this one, so a stack
trace and a coverage report still name the line on disk.

Each test reads what its file wrote while it was collected and in its
`beforeAll` and `afterAll` hooks, as it would in a worker of its own; what the
test, its `beforeEach` and its `afterEach` write is gone before the next test,
which a worker of its own would keep. Jest runs
an `afterEach` at a test file's top level after the setup's, so what that one
writes stays for the tests after it.

The setup has to load before any rewritten module, for the reason
[ioc](https://variance-authority.dev/reference/packages/ioc#install-the-driver-in-the-test-setup) gives: the runtime registers
with the driver when it is imported, and ioc refuses one that registered first.

`test.concurrent` runs its tests side by side, and Jest gives them no
`beforeEach` of their own. `isolateConcurrentTests(test)` runs the body of
every `test.concurrent`, `.only`, `.each` and `.failing` in a session of its
own instead, which starts from what its file wrote outside tests, as every
other test does.

Test files are not rewritten. A test file's own `let` carries what a
`beforeAll` set into the tests after it, which is what a test file means by it.
Neither is anything under `node_modules`, nor a module its package lists in
`sideEffects`.

## Run it in Vitest

Vitest's `isolate: false` keeps each worker's modules loaded from one test file
to the next, which saves loading them again for every file, and lets every
file see what the files before it left in them. The isolator takes the second
part away: each file is collected against the values its modules were loaded
with, and each test reads what its file wrote while it was collected and in
its `beforeAll` and `afterAll` hooks, while what the test and its `beforeEach`
and `afterEach` write is gone before the next test.

```ts
// vitest.config.ts
import { isolator } from '@variance-authority/isolator/vite';
import { defineConfig } from 'vitest/config';

// Every file that calls `vi.mock` or renders into a DOM; one these globs miss runs shared.
const isolated = ['src/**/*.dom.test.tsx', 'src/**/*.mocked.test.ts'];

export default defineConfig({
  plugins: [isolator()],
  test: {
    setupFiles: ['./reset.setup.ts'],
    projects: [
      { extends: true, test: { name: 'shared', isolate: false, exclude: isolated } },
      { extends: true, test: { name: 'isolated', include: isolated } },
    ],
  },
});
```

```ts
// reset.setup.ts
import { configureResetHandler } from '@variance-authority/ioc/reset/setup';
import { afterEach, aroundEach, beforeEach } from 'vitest';

configureResetHandler(beforeEach, afterEach);

const { isolateConcurrentEach } = await import('@variance-authority/isolator/node');

isolateConcurrentEach(aroundEach);
```

Tests that run side by side under `test.concurrent` share whatever the last
`beforeEach` reset, so `isolateConcurrentEach` runs each of them in a session
of its own, which starts from what its file wrote outside tests, as every other
test does. The isolator is imported after the driver is installed, since it
registers with the driver as it loads.

The plugin asks Vitest which files are tests, by every project's `include`
and `includeSource`, and leaves them and the setup files as they are. It leaves
what the Jest transformer and the loader leave: anything under `node_modules`,
what `sideEffects` lists, and the `exclude` globs it is handed, relative to
Vitest's root. Keep `include` off the root config: a project that extends it
adds its own `include` to the root's, and `isolated` would run every file.

The isolator resets what modules hold, not what the process holds: the working
directory after `process.chdir`, `process.env` and a global carry into the next
file. Change the last two through `vi.stubEnv` and `vi.stubGlobal` with
Vitest's `unstubEnvs` and `unstubGlobals` on, and restore the working directory
in the file that changed it. Nor does it load a module
again. A `vi.mock` reaches only the modules loaded after it, and a renderer
binds the DOM and the React DevTools hook it finds when it loads, so a file
that mocks or renders into a DOM keeps a worker of its own, in the `isolated`
project.

Record coverage with isolation on. A worker that keeps a module credits it to
the first file that loaded it, so a record made shared says the files after
never entered it ([a record needs a module graph per test file](https://variance-authority.dev/docs/selecting#a-record-needs-a-module-graph-per-test-file)).

## Run it in Storybook

```js
// .storybook/main.js
import { isolator } from '@variance-authority/isolator/vite';

export default {
  viteFinal: (config) => ({
    ...config,
    plugins: [...(config.plugins ?? []), isolator({ exclude: ['.storybook/**', 'src/**/*.stories.@(js|jsx|ts|tsx)'] })],
  }),
};

// .storybook/preview.js
import { isolateGlobals, isolateTimers, nextSession } from '@variance-authority/isolator';
import { addons } from 'storybook/preview-api';

isolateTimers();
isolateGlobals();

addons.getChannel().on('currentStoryWasSet', () => nextSession());
```

`currentStoryWasSet` fires for every story selected, the one the URL opens
included, so the first story does not run in the session of the page's boot.
The `isolate…` calls end what a story leaves outside its modules: its timers
and what it adds to `window`. What the preview does as it loads belongs to the
boot and every story keeps it. Leave `isolateListeners()` out of a page: it is
for unit tests, as its entry below says.

Under Vite alone the plugin rewrites every module but the ones `exclude`
names. Leave out the Storybook config and the story files: Storybook reads a
story file's exports once for the page. The reset answers the switch itself,
not a loader or `beforeEach`: Storybook imports the next story's file before it
runs any loader, so a story file that reads module state as it loads, or a
module it loads for the first time that registers itself somewhere, would meet
the previous story's state, and a reset after it would erase the registration.
Each story switched to on the same page then reads its modules as a page of its
own would, and a story shown again still holds what its modules registered when
they first loaded. A story that never imports such a module holds that
registration too, once a story before it has loaded the module.

Two things stay shared. Work the previous story left behind: a timer or a
pending promise that lands later, and its unmount, which Storybook runs after
it has imported the next story, all write into the next story's session. And
anything in `node_modules` or in a package that declares side effects. The
plugin has no build mode of its own: add it to a Storybook config, not to an
app's production build.

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
values its modules were loaded with. The runtime, `isolateTimers()` and
`isolateGlobals()` need nothing of Node, so a bundle built for the web runs
them as they are; `isolateEnv()` installs nothing where there is no `process`.

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

## Isolate what no module owns

Some state lives on objects the transform never sees: `process.env`, a
property a test puts on `globalThis`, a timer still pending when its test
ends, a listener left on `document`. Each has a function that isolates it per
session from that call on, and returns a function that stops it. Call the ones
you want once per file, before any test runs, from a setup file listed after
the one that calls `configureResetHandler`. The isolator registers with the
reset driver as it is imported, and `configureResetHandler` throws when
something registered first:

```ts
import { isolateEnv, isolateGlobals, isolateListeners, isolateTimers } from '@variance-authority/isolator';

isolateEnv();
isolateGlobals();
isolateTimers();
isolateListeners();
```

- **`isolateEnv()`** gives every session its own `process.env`, started from
  its parent's: a test reads what its file set, and what it sets itself ends
  with it. `TZ` is written through to the real environment and put back as
  the fallback session switches — a test, a file, `nextSession()` — since Node
  reads the timezone from there. Node holds one timezone per process, so a
  `TZ` set in a session `isolated(fn)` or a concurrent test starts stays in
  that session's `process.env` and leaves Node's timezone as it was.
- **`isolateGlobals(target = globalThis)`** puts `target`'s own properties
  back as each session found them: what a test added is deleted, and what it
  replaced or deleted is back. A property that cannot be configured stays.
- **`isolateTimers()`** cancels, as each session ends, the `setTimeout`,
  `setInterval`, `setImmediate` and `requestAnimationFrame` it left pending.
- **`isolateListeners({ report })`** removes, as each session ends, the
  listeners it added to any `EventTarget` and left attached. `report` is told
  of each one, with the stack that added it, once all are gone: throw from it to
  have every leak fixed where it starts. It is for unit tests, where the DOM is
  emptied between tests and what outlives it sits on `window` and `document`.
  On a page, as in Storybook, a library adds listeners once and marks where it
  did — React on its root and on a portal's container — and removing them
  would leave the mark with nothing behind it.

What a rewritten module does as it loads — a property it defines, a timer it
starts, a listener it adds — belongs to no session and stays, as it would on
every fresh page that loads the module. So does what setup does before the
first test starts, a Storybook preview as it boots included: every session
finds it. In Jest, setup files run again for every test file, so what they do
belongs to that file and is done again for the next. What a timer callback
schedules, or a listener adds, belongs to whoever scheduled or added that
callback: a chain `beforeAll` starts runs on through the file, whichever test
it fires in. A callback that a load or setup added runs in every session, so
what it adds belongs to the session it runs in.
`perSession(object, { store, wrote })` is the proxy
`isolateEnv` is built on, for any other object a session should hold its own
copy of: `store` turns a written value into what the object would hold, as
`String` does for the environment, and `wrote` is told of each key a session
wrote, for a host that has to see the write too.

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
| `@variance-authority/isolator` | `nextSession()` starts a new fallback session from the values every module was loaded with; `currentSession()` answers with the session in force; `addSessionSource(source)` adds a source, asked before any added after it. The `isolate…` functions and `perSession` isolate what no module owns. |
| `@variance-authority/isolator/node` | `isolated(fn)` runs `fn` in a new session, through every `await` it starts; `isolateConcurrentTests(test)` and `isolateConcurrentEach(aroundEach)` give each concurrent test one, started from its file's session. Every copy of this entry in a process shares one store, so an inner `isolated` always wins. |
| `@variance-authority/isolator/react` | `requestSessions()` makes each React Server Components request a session, through every Suspense boundary it streams. React's `cache` keeps a request only in the Flight renderer, under the `react-server` condition. |
| `@variance-authority/isolator/jest` | The Jest transformer. |
| `@variance-authority/isolator/loader` | The loader for Rspack and webpack. |
| `@variance-authority/isolator/vite` | The plugin for Vitest, and for Vite alone, as in Storybook. |
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
- **A class's static fields.** They live on the class, which is one object for
  every session.
- **State inside a package you do not build.** `node_modules` is never
  rewritten.
- **A session `isolated(fn)`, `isolateConcurrentTests`, `isolateConcurrentEach`
  or React starts, for the `isolate…` functions.**
  They act as the fallback session ends — a test, a file, `nextSession()` —
  and nothing announces the end of a session a source answers with.
- **Promises and `queueMicrotask`.** Neither can be cancelled, so a callback
  queued at the end of a test still runs in the next one.
- **What a package you do not build does as it loads, or the first time it is
  called.** The isolator does not see that load. If a package first runs inside a
  test and defines a global, starts a timer or adds a listener there, the
  `isolate…` functions take it back when the test ends. The module stays cached
  and its own flag still says it has done its setup. A React portal rendered
  into `document.body` is one: React adds its listeners there once, in the
  first test that opens one, and `isolateListeners` removes them as that test
  ends while React's mark stays, so a later portal in the same file stops
  answering events.
- **`EventEmitter` and `process.on`, for `isolateListeners`.** It wraps
  `EventTarget` only. The test runners themselves listen on `process`.
- **A timer started through `node:timers`.** `isolateTimers` wraps the globals.
- **A write inside a global object, for `isolateGlobals`.** It puts back the
  properties of `globalThis` itself: `globalThis.config = {}` is undone,
  `globalThis.config.debug = true` is not. Hold such an object with
  `perSession`.

## License

MIT © Machine Garden

---

**[@variance-authority/isolator](https://variance-authority.dev/reference/packages/isolator)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · [GitHub](https://github.com/Variance-Authority/variance-authority/tree/main/packages/isolator) · MIT
