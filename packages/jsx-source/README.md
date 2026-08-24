<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/jsx-source

**Requires:** a build you control the JSX transform of, and a React runtime for
it to resolve. Nothing imports this package — a compiler or a bundler does,
because a setting told it to.

Keep the source location of every JSX element as far as the rendered DOM node, so
a difference in a screenshot can name the file and line that wrote it.

## Use this package when

Install `@variance-authority/jsx-source` for a production React bundle, or for
React 18 using the classic JSX transform, when the source location is not present
on the fiber. A bundler plugin or Jest resolver is required; application code does
not import this package directly. React development builds should first use the
metadata path described below, because it needs no build change.

## Package boundary

Every JSX transform in ordinary use already computes the location. The automatic
transform in development mode passes `{fileName, lineNumber, columnNumber}` to
the runtime as the fifth argument of `jsxDEV`; the classic transform passes the
same object as a `__source` prop. The information is not missing from your build.

React 19 discards it on both paths. Its `jsxDEV` export takes four parameters and
synthesizes its own `Error` for the fifth, and `createElement` skips `__source`
by name while copying config into props. Both read in 19.2.8.

So the last hop is the one to supply. This package is React's JSX runtime with
one line added: the location is written onto the props object under a symbol, and
the props object is handed to React unchanged. React creates the element, React
owns it, React validates it — and the location arrives at `fiber.memoizedProps`,
where [`@variance-authority/react`](../react) reads it.

## Check whether you need it

**Against a React development build, you probably do not.**
[`@variance-authority/react`](../react) reads two fields off the fiber before
anything here is involved, and between them they cover every dev server, Vitest
and Jest:

| | automatic transform | classic transform |
| --- | --- | --- |
| **React 19** | `_debugStack` | `_debugStack` |
| **React 18** | `_debugSource` | **nothing — install this** |

React 19 captures an `Error` inside its own element factory, `createElement`
included, and the frame in it is resolved through the source map your dev server
already emits — no plugin, no `jsxImportSource`, no `jsxDev`. React 18 kept the
transform's own location as `_debugSource`, which is cheaper still because
nothing has to be resolved. React 18 with the classic transform is the one
development corner with neither: esbuild writes no `__source` on that path and
React 18 captures no error to replace it.

What has no capture at all is a **production** build: a built Storybook, a
statically served bundle, anything compiled with `NODE_ENV=production`. That is
what this package is mainly for, and it is the case where the transform's own
location is worth the most, because locations survive minification untouched
while component names do not.

## Install it in the build

There are two ways in, and which one you want depends on a single question:
**does your project already point `jsxImportSource` somewhere?**

### The project has its own JSX runtime — Emotion, theme-ui, anything

Then `jsxImportSource` is spent. It is one setting for a whole build and there is
exactly one of it, so a package that asks for it is asking you to give up the
runtime you chose.

Install underneath instead. Every custom JSX runtime is a wrapper that ends up
calling `react/jsx-dev-runtime`, and every one of them forwards the transform's
source argument on the way, so the bottom of that chain is a place where one
runtime can serve all of them.

```js
// vite.config.js — or Storybook's `viteFinal`, or vitest.config.mts
import { jsxSource } from '@variance-authority/jsx-source/vite';

export default {
  plugins: [jsxSource()],
  esbuild: { jsxDev: true },
};
```

`jsxImportSource` is not mentioned, and that is the point: leave it wherever it
already is. Vite is three build tools here — the same plugin serves a Vite
application, Storybook's React builder, and Vitest.

Jest has no plugin that can answer a module request, so it gets a resolver:

```js
// jest.config.js
export default {
  resolver: '@variance-authority/jsx-source/jest-resolver',
  transformIgnorePatterns: ['/node_modules/(?!@variance-authority/)'],
};
```

The second line is the ordinary accommodation Jest needs for a package that ships
ES modules, not something this resolver requires. `moduleNameMapper` looks like
it would do the same job and does not: it rewrites every request, including the
recording runtime's own request for the runtime it records for, which resolves it
straight back to itself.

### The project has no custom runtime and would rather not add a plugin

Then take `jsxImportSource`. It is a compiler setting rather than a plugin, so
there is nothing to keep working across a bundler upgrade.

```js
// vite.config.js — or the `esbuild` block of a framework that wraps it
export default {
  esbuild: {
    jsx: 'automatic',
    jsxDev: true,
    jsxImportSource: '@variance-authority/jsx-source',
  },
};
```

For Babel, the equivalent is `importSource` on `@babel/preset-react` with
`development: true`. For TypeScript's own emit, it is `"jsx": "react-jsx"` with
`"jsxImportSource": "@variance-authority/jsx-source"`, and TypeScript emits the
development runtime whenever `"jsx": "react-jsxdev"`.

### Either way, `jsxDev` is the setting that decides everything

Neither route can supply it, and neither works without it: it is what makes the
transform emit locations at all. It is **independent of whether the bundle is
minified**, so turning it on in a production build is a supported and useful
thing to do here — locations are data the compiler emitted, and unlike component
names they survive minification untouched.

After that build runs, render an element and inspect it through
`@variance-authority/react`'s `provenanceOf`. A resolved source location is the
expected result; if the location is absent, check the emitted bundle's runtime
request and `jsxDev` setting before changing application code.

## Entrypoints

- `@variance-authority/jsx-source/vite` — the plugin. Exports `jsxSource()`.
- `@variance-authority/jsx-source/jest-resolver` — the same swap for Jest.
- `@variance-authority/jsx-source/jsx-dev-runtime` — the recording runtime. Both
  install routes end here: the compiler imports it when `jsxImportSource` names
  this package, and the plugin resolves it in `react/jsx-dev-runtime`'s place.
- `@variance-authority/jsx-source/jsx-runtime` — the production transform's
  target, a pass-through to React's own. It has to exist because
  `jsxImportSource` is one setting for both runtimes, and it records nothing
  because the production transform computes no location to record.
- `@variance-authority/jsx-source/under` — the wrapper the other two are built
  from, for an integration neither covers. It takes React's runtimes as arguments
  rather than importing them, because whoever installs it in React's place is the
  only caller that can still reach the real thing.

There is no default entrypoint. Importing this package in application code is not
a thing to do; the only correct callers are a compiler and a bundler.

This package does not render components, collect a DOM, or resolve source maps.
It only supplies the JSX runtime module that the build already requests; the
React package reads the resulting metadata and the collector decides how to use
it.

## Runtime cost

A symbol-keyed property on each props object, and one function call per element
in front of React's.

The symbol is what makes it free everywhere else. `for…in` does not enumerate
symbols, so `react-dom` never renders it as an attribute, a props digest never
digests it, and a component spreading `{...props}` onto a `<div>` does not put it
in the document. The one place it has to be handled explicitly is `key`: React
copies props into a fresh object when a `key` is present, and it copies with
`for…in`. This runtime lifts the key out first so React takes its no-copy path —
without that, every element in a list would have been the one kind that lost its
location.

## When it does not work

- **Locations are absent everywhere:** `jsxDev` is off, so the transform is
  emitting calls to `jsx`/`jsxs` and passing no source. Check the setting in the
  build that actually produced the bundle, not the one in the development server.
- **Locations are absent in one package:** a dependency shipped pre-compiled JSX.
  Its elements were transformed by its own build and never passed through this
  runtime.
- **Locations are absent when a dependency is external:** the plugin swaps a
  module, so it reaches code the bundler processes and no other. A build that
  marks your JSX runtime external resolves its import of React at runtime, past
  the point a resolver can answer.
- **An element carrying Emotion's `css` prop reports from one fiber up:**
  Emotion answers that prop by rendering a component of its own and rebuilding
  the props with `for…in`, which does not copy symbols. The location is not lost
  — Emotion forwards the source argument untouched, so what gets recorded is
  still that element's own line — but it is recorded on the wrapper, and
  `@variance-authority/react` finds it by climbing composite ancestors until it
  reaches a host element.
- **The file names are absolute:** that is the transform's own `fileName`, which
  for most bundlers is the absolute path its module graph holds. This package
  passes it through unchanged, because a page has no idea what the repository
  root is. The collector does, and makes it relative during normalization — so a
  location recorded here is repository-relative by the time it reaches a report,
  and absolute only if it was compiled from outside the root.
- **A component renders elements it received as props:** the location is the
  place the element was *written*, which is the caller, not the component that
  rendered it. That is the correct answer, and it is the same distinction
  `Provenance.createdBy` draws against `owners[0]`.
- **A Vite config fails to load the plugin:** a `vitest.config.ts` or
  `vite.config.ts` in a package that is not `"type": "module"` is loaded as
  CommonJS, and this package is ES-module-only. Rename it to `.mts`.
