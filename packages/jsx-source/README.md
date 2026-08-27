<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/jsx-source

> Carry the file and line that wrote a JSX element as far as the rendered DOM node.

**Variance Authority** is a visual regression toolkit for web interfaces: it
compares a rendered subject against an approved baseline and reports which
component caused each change. This package is one piece of it.

The **subject** is that rendered tree — the page or component under test on a
given run. To report *which* component changed, Variance Authority needs to
know where in your source each DOM node came from: the file and line whose
JSX produced it, its **call site**. This package's only job is carrying that
call site from the JSX transform through to the rendered element, so
`@variance-authority/react` can read it back off the fiber as part of that
element's **provenance** — the resolved record of where it came from.

**Requires:** a build you control the JSX transform of, and a React runtime for
it to resolve. Nothing imports this package directly — a compiler or a bundler
does, because a setting told it to.

```bash
npm install --save-dev @variance-authority/jsx-source
```

## Use this package when

Install it for a production React bundle, or for React 18 using the classic
JSX transform — in both cases the call site is not on the fiber and nothing
else supplies it.

For a React **development** build, check the next section first: React 18 and
19 already put enough on the fiber to read the call site straight off it, with
no build change required. That route — reading `_debugSource` or
`_debugStack` directly — is what this README calls the **fiber metadata
path**. Reach for this package only where that path comes up empty.

Either way, a bundler plugin or Jest resolver does the installing; application
code never imports this package.

## Package boundary

Every JSX transform in ordinary use already computes the call site. The
automatic transform in development mode passes `{fileName, lineNumber,
columnNumber}` to the runtime as the fifth argument of `jsxDEV`; the classic
transform passes the same object as a `__source` prop. The information is
already there.

React 19 throws it away on both paths: its `jsxDEV` export takes four
parameters and synthesizes its own `Error` for the fifth, and `createElement`
skips `__source` by name while copying the rest of `config` into props.

So the last hop is the one to supply. This package is React's JSX runtime with
one line added: the call site is written onto the props object under a
symbol, and the props object is handed to React unchanged. React creates the
element, React owns it, React validates it — and the call site arrives at
`fiber.memoizedProps`, where `@variance-authority/react` reads it.

## Check whether you need it

**Against a React development build, you probably do not.**
`@variance-authority/react` reads two fields off the fiber before anything
here is involved — the fiber metadata path above — and between them they
cover every dev server, Vitest and Jest:

| | automatic transform | classic transform |
| --- | --- | --- |
| **React 19** | `_debugStack` | `_debugStack` |
| **React 18** | `_debugSource` | **nothing — install this** |

React 19 captures an `Error` inside its own element factory, `createElement`
included, and the frame in it is resolved through the source map your dev
server already emits — no plugin, no `jsxImportSource`, no `jsxDev`. React 18
kept the transform's own location as `_debugSource`, which is cheaper still
because nothing has to be resolved. React 18 with the classic transform is the
one development corner with neither: esbuild writes no `__source` on that path
and React 18 captures no error to replace it.

What has no capture at all is a **production** build: a built Storybook, a
statically served bundle, anything compiled with `NODE_ENV=production`. That
is what this package is mainly for, and it is the case where the call site is
worth the most, because it survives minification while component names do
not.

## Install it in the build

There are two ways in, and which one you want depends on a single question:
**does your project already point `jsxImportSource` somewhere?**

### The project has its own JSX runtime — Emotion, theme-ui, anything

Then `jsxImportSource` is spent: it is one setting for a whole build, so
pointing it here would mean giving up the runtime you chose. Install
underneath instead. Every custom JSX runtime is a wrapper that ends up
calling `react/jsx-dev-runtime` and forwards the transform's call site on the
way, so one runtime installed at the bottom of that chain serves all of them:

```js
// vite.config.js — or Storybook's `viteFinal`, or vitest.config.mts
import { jsxSource } from '@variance-authority/jsx-source/vite';

export default {
  plugins: [jsxSource()],
  esbuild: { jsxDev: true },
};
```

`jsxImportSource` is not mentioned here — leave it wherever it already is.
Vite is three build tools at once here: the same plugin serves a Vite
application, Storybook's React builder, and Vitest.

Jest has no plugin hook that can answer a module request, so it gets a
resolver instead:

```js
// jest.config.js
export default {
  resolver: '@variance-authority/jsx-source/jest-resolver',
  transformIgnorePatterns: ['/node_modules/(?!@variance-authority/)'],
};
```

The second line is the ordinary accommodation Jest needs for a package that
ships ES modules — not something this resolver requires. `moduleNameMapper`
cannot substitute for it: it rewrites every request, including the resolver's
own recursive lookup for the runtime it wraps, sending that request back to
itself.

### The project has no custom runtime and would rather not add a plugin

Then take `jsxImportSource` directly. It is a compiler setting rather than a
plugin, so there is nothing to keep working across a bundler upgrade:

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
`development: true`. For TypeScript's own emit, it is `"jsx": "react-jsx"`
with `"jsxImportSource": "@variance-authority/jsx-source"`, and TypeScript
emits the development runtime whenever `"jsx": "react-jsxdev"`.

### Either way, `jsxDev` is the setting that decides everything

Neither route supplies it, and neither works without it — it is what makes
the transform emit a call site at all. Turning it on in a production build is
supported and useful: a call site is data the compiler emitted, so unlike a
component name it survives minification.

After that build runs, render an element and inspect it through
`@variance-authority/react`'s `provenanceOf`. Its result should carry a
resolved source location; if that is absent, check the emitted bundle's
runtime request and `jsxDev` setting before changing application code.

## Entrypoints

- `@variance-authority/jsx-source/vite` — the plugin. Exports `jsxSource()`.
- `@variance-authority/jsx-source/jest-resolver` — the same swap for Jest.
- `@variance-authority/jsx-source/jsx-dev-runtime` — the recording runtime.
  Both install routes end here: the compiler imports it when
  `jsxImportSource` names this package, and the plugin resolves it in
  `react/jsx-dev-runtime`'s place.
- `@variance-authority/jsx-source/jsx-runtime` — the production transform's
  target, a pass-through to React's own. It has to exist because
  `jsxImportSource` is one setting for both runtimes, and it records nothing
  because the production transform computes no call site to record.
- `@variance-authority/jsx-source/under` — the wrapper the other two are
  built from, for an integration neither covers. It takes React's runtimes as
  arguments rather than importing them, since only the code installing it in
  React's place has already resolved the real thing.

There is no default entrypoint. Importing this package from application code
is not a thing to do; the only correct callers are a compiler and a bundler.

This package does not render components, collect a DOM, or resolve source
maps. It only supplies the JSX runtime module the build already requests;
`@variance-authority/react` reads the resulting metadata, and the collector
decides how to use it.

## Runtime cost

One extra property on each element's props, keyed by a symbol, plus one
function call per element in front of React's own. The symbol is what keeps
the cost invisible everywhere else: `for…in` does not enumerate symbols, so
`react-dom` never renders it as a DOM attribute and a component spreading
`{...props}` onto a host element never leaks it into the document. The one
case that needs handling explicitly is `key`: React copies props with
`for…in` whenever an element has a `key`, which would otherwise drop the
symbol silently. This runtime lifts `key` out first so that copy never
happens.

## When it does not work

- **Call sites are absent everywhere:** `jsxDev` is off, so the transform is
  emitting calls to `jsx`/`jsxs` and passing no source. Check the setting in
  the build that actually produced the bundle, not the one in the
  development server.
- **Call sites are absent in one package:** a dependency shipped
  pre-compiled JSX. Its elements were transformed by its own build and never
  passed through this runtime.
- **Call sites are absent when a dependency is external:** the plugin swaps a
  module, so it only reaches code the bundler processes. A build that marks
  your JSX runtime external resolves its import of React at runtime, past
  the point a resolver can answer.
- **An element carrying Emotion's `css` prop reports from one fiber up:**
  Emotion answers that prop by rendering a component of its own and
  rebuilding the props with `for…in`, which does not copy symbols. The call
  site is not lost — Emotion forwards the transform's source argument
  untouched, so what gets recorded is still that element's own line — but it
  is recorded on the wrapper, and `@variance-authority/react` finds it by
  climbing composite ancestors until it reaches a host element.
- **The file names are absolute:** that is the transform's own `fileName`,
  which for most bundlers is the absolute path its module graph holds. This
  package passes it through unchanged, because a page has no idea what the
  repository root is. The collector does, and makes it relative during
  normalization — so a call site recorded here is repository-relative by the
  time it reaches a report, and absolute only if it was compiled from
  outside the root.
- **A component renders elements it received as props:** the call site is
  the place the element was *written*, which is the caller, not the
  component that rendered it. That is the correct answer, and it is the
  same distinction `Provenance.createdBy` draws against `owners[0]`.
- **A Vite config fails to load the plugin:** a `vitest.config.ts` or
  `vite.config.ts` in a package that is not `"type": "module"` is loaded as
  CommonJS, and this package is ES-module-only. Rename it to `.mts`.
