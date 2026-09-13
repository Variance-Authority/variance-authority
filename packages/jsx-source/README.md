<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/jsx-source

> Carry the file and line that wrote a JSX element as far as the rendered DOM node.

Most projects do not need this package. Variance Authority reads exact JSX call
sites from React development builds without a plugin, a custom JSX runtime or a
build change.

Install this package only when a production-built React artifact must identify
the JSX expression that wrote each changed element. A built Storybook or a
statically served application is the common case. Observation, comparison and
component attribution work without it; when the collector has a source index, a
production report can instead point to the line where the component is declared.

This is build instrumentation, not an application dependency. Application code
never imports it.

## Decide whether to install it

| Subject build | Exact call site without this package | Install it? |
| --- | --- | --- |
| React 19 development, automatic or classic JSX | Yes, from `_debugStack` and the development source map | No |
| React 18 development, automatic JSX | Yes, from `_debugSource` | No |
| React 18 development, classic `createElement` output | No | Only after changing the transform; see below |
| Production React artifact | No | Only when exact per-element lines are required |

The package is useful only when all of these are true:

- the rendered subject uses React;
- the fiber metadata path has no call site;
- the report must distinguish element instances, not merely find the component
  declaration;
- the build that compiles the relevant JSX is under your control; and
- that build can emit automatic `jsxDEV` calls with source metadata.

If any one is false, do not install it.

```bash
npm install --save-dev @variance-authority/jsx-source
```

## Package boundary

An automatic transform in development mode computes the call site and passes
`{fileName, lineNumber, columnNumber}` to the runtime as the fifth argument of
`jsxDEV`. React 19 discards that argument. A production React runtime also
carries no development fiber metadata from which the call site could be
recovered.

This package supplies that last hop. Its `jsxDEV` wrapper writes the transform's
location onto props under a symbol, then hands the element to React. The symbol
arrives at `fiber.memoizedProps`, where `@variance-authority/react` reads it. It
survives minification and does not enter the document or any compared digest.

It does not intercept `React.createElement`. React 18 with an unchanged classic
transform therefore remains uninstrumented: development emission alone does not
change classic output. To use this package for that build, switch the transform
to automatic JSX and enable its development emission. A classic
transform that already emits `__source` gives React 18 its native
`_debugSource`, so this package is unnecessary there.

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
  oxc: { jsx: { runtime: 'automatic', development: true, refresh: false } },
};
```

That is Vite 8, which transforms with oxc. On Vite 7 and below the same two
settings are spelled `esbuild: { jsx: 'automatic', jsxDev: true }`. Check which
major you are on before copying either — see
[the transform must emit `jsxDEV`](#either-way-the-transform-must-emit-jsxdev)
for what the wrong one costs. `refresh: false` keeps Fast Refresh out of a build
that is not a dev server.

`jsxImportSource` is not mentioned here — leave it wherever it already is.
Vite is three build tools at once here: the same plugin serves a Vite
application, Storybook's React builder, and Vitest.

Jest has no plugin hook that can answer a module request, so it gets a resolver
instead. Its transformer must also emit automatic development JSX; the resolver
cannot create source metadata after compilation.

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
// vite.config.js — or the transform block of a framework that wraps it
export default {
  oxc: {
    jsx: {
      runtime: 'automatic',
      development: true,
      refresh: false,
      importSource: '@variance-authority/jsx-source',
    },
  },
};
```

Vite 7 and below spell the same three under `esbuild`, as `jsx: 'automatic'`,
`jsxDev: true` and `jsxImportSource`.

For Babel, set `runtime: 'automatic'`, `development: true` and `importSource` on
`@babel/preset-react`. For TypeScript's own emit, use `"jsx": "react-jsxdev"`
with `"jsxImportSource": "@variance-authority/jsx-source"`.

### Either way, the transform must emit `jsxDEV`

Neither install route supplies it, and neither works without automatic
development JSX emission — it is what makes the transform emit a call site at
all. Turning it on in a production build is supported: a call site is data the
compiler emitted, so unlike a component name it survives minification.

Where the setting lives is the one thing to get right, because the build does
not tell you when you miss:

| your transform | automatic JSX | development emission |
|---|---|---|
| Vite 8 (oxc) | `oxc.jsx.runtime: 'automatic'` | `oxc.jsx.development: true` |
| Vite 7 and below (esbuild) | `esbuild.jsx: 'automatic'` | `esbuild.jsxDev: true` |
| Babel | `runtime: 'automatic'` | `development: true` |
| `tsc` | `"jsx": "react-jsxdev"` | included in that value |

A Vite config carries whichever keys it is given and reads only the ones its own
major knows, so an `esbuild` block on Vite 8 — or an `oxc` block on Vite 7 — is
not a build error, not a warning, and not a log line. The plugin still installs,
the bundle still runs, every subject still renders, and every report names the
line a component is declared on rather than the line that wrote the element. It
fails in the direction that looks like it worked.

So read the result rather than the config. After the build runs, render an
element and inspect it through `@variance-authority/react`'s `provenanceOf`: it
should carry a resolved source location. If it does not, check the emitted
bundle's runtime request and the transform's development setting before changing
application code.

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
is a mistake; the only correct callers are a compiler and a bundler.

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

- **Call sites are absent everywhere:** development emission is off, so the
  transform is emitting calls to `jsx` and `jsxs` and passing no source. Check
  the setting in the build that actually produced the bundle, not the one in the
  development server — and check it is spelled for that build's own transform,
  since a key belonging to a different Vite major is read by nothing and
  reported by nothing.
- **The build still emits `React.createElement`:** this package wraps
  `react/jsx-dev-runtime`; it does not patch `createElement`. Select the automatic
  transform as well as turning development emission on.
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
