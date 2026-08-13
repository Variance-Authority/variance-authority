# @variance-authority/jsx-source

**Requires:** a build you control the JSX transform of, and a React runtime for
it to resolve. Nothing imports this package — a compiler does, because a setting
told it to.

Keep the source location of every JSX element as far as the rendered DOM node, so
a difference in a screenshot can name the file and line that wrote it.

## Why this exists

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

## Turn it on

One setting, wherever your JSX transform is configured. It is the standard
`jsxImportSource`, so nothing here is a plugin you have to keep working.

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

`jsxDev` is the switch that matters and it is worth stating on its own: it
decides whether the transform emits locations at all, and it is **independent of
whether the bundle is minified**. Turning it on in a production build is a
supported and useful thing to do here — locations are data the compiler emitted,
so unlike component names they survive minification untouched.

For Babel, the equivalent is `importSource` on
`@babel/preset-react` with `development: true`. For TypeScript's own emit, it is
`"jsx": "react-jsx"` with `"jsxImportSource": "@variance-authority/jsx-source"`,
and TypeScript emits the development runtime whenever `"jsx": "react-jsxdev"`.

## Entrypoints

Two, and both are addressed by the compiler rather than by you:

- `@variance-authority/jsx-source/jsx-dev-runtime` — the development transform's
  target. This is the one that records.
- `@variance-authority/jsx-source/jsx-runtime` — the production transform's
  target. A pass-through to React's own. It has to exist because
  `jsxImportSource` is one setting for both runtimes, and it records nothing
  because the production transform computes no location to record.

There is no default entrypoint. Importing this package in application code is not
a thing to do; the only correct caller is a compiler.

## What it costs

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
