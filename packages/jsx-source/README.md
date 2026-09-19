<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/jsx-source

> Carry the file and line that wrote a JSX element as far as the rendered DOM node.

Part of [Variance Authority](https://variance-authority.dev), which retains what
a test run knows — what it rendered, which code it entered, what the workspace
exposes — so the next question is answered from the record, not another run.

## What this is for

Variance Authority reports what changed in a **subject** — one named UI state you
asked for and can ask for again — and names the source behind each change. It
reads exact JSX call sites out of React development builds by itself: no plugin,
no custom JSX runtime, no build change.

Install this package only when a *production*-built React artifact has to name
the JSX expression that wrote each changed element. A built Storybook or a
statically served application is the common case. Rendering, comparison and
component attribution all work without it — what a report loses is the element's
own line, falling back to the line where its component is declared.

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
- React's own development record on the fiber carries no call site — the first
  two rows above are the builds where it does;
- the report must distinguish element instances, not merely find the component
  declaration;
- the build that compiles the relevant JSX is under your control; and
- that build can emit automatic `jsxDEV` calls with source metadata.

If any one is false, do not install it.

```bash
npm install --save-dev @variance-authority/jsx-source
```

## Requirements

Node 22 or newer. This package is ES modules only (`"type": "module"`), which is
why a `vite.config.ts` or `vitest.config.ts` inside a package that is not
`"type": "module"` has to be renamed `.mts` before it can load the plugin.

| Peer | Range |
| --- | --- |
| `react` | `>=17` |

Its own suite runs against React 19.

Reading the recorded location back is `@variance-authority/react`'s job. You do
not install that to make this package work: a **collector** — the module
`npx variance run` loads to plan subjects and render them, such as
`@variance-authority/storybook-collector` — already depends on it. Install it
directly only to run the check below yourself:

```bash
npm install --save-dev @variance-authority/react
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
survives minification, never reaches the document, and is not digested, so it
moves nothing a baseline compares.

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
way, so one runtime installed at the bottom of that chain serves all of them.

Add `jsxSource()` to the plugin array you already have; it replaces nothing in
it:

```js
// vite.config.js
import react from '@vitejs/plugin-react';
import { jsxSource } from '@variance-authority/jsx-source/vite';

export default {
  plugins: [react(), jsxSource()],
  oxc: { jsx: { runtime: 'automatic', development: true, refresh: false } },
};
```

Its position in the array does not matter: the plugin carries `enforce: 'pre'`,
which is what puts it ahead of Vite's own resolver, and that ordering is not
something the array can express. It answers one module request and transforms
nothing, so whichever tool actually compiles your JSX is where the development
setting has to live — the `oxc` block above when Vite's own transform does it,
a plugin's Babel options when that plugin does. The check at the end of this
section is how you find out which one you got.

That block is Vite 8, which transforms with oxc. On Vite 7 and below the same two
settings are spelled `esbuild: { jsx: 'automatic', jsxDev: true }`. Check which
major you are on before copying either — see
[the transform must emit `jsxDEV`](#either-way-the-transform-must-emit-jsxdev)
for what the wrong one costs. `refresh: false` keeps Fast Refresh out of a build
that is not a dev server.

`jsxImportSource` is not mentioned here — leave it wherever it already is.
Vite is three build tools at once: the same plugin serves a Vite application,
Storybook's React builder, and Vitest.

For a built Storybook, that goes in `viteFinal`. This is the configuration this
repository's own Storybook case is built with, on Vite 8:

```js
// .storybook/main.js
import { jsxSource } from '@variance-authority/jsx-source/vite';

export default {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  framework: { name: '@storybook/react-vite', options: {} },
  viteFinal: async (config) => ({
    ...config,
    plugins: [...(config.plugins ?? []), jsxSource()],
    // Automatic development JSX is what carries each element's file and line.
    oxc: { ...config.oxc, jsx: { runtime: 'automatic', development: true } },
    build: {
      ...config.build,
      rolldownOptions: {
        ...config.build?.rolldownOptions,
        // Minification renames functions, and React reads a component's display
        // name off the function — without this a report names `a`, not `Button`.
        output: { ...config.build?.rolldownOptions?.output, keepNames: true },
      },
    },
  }),
};
```

The two settings sit in two sections because they belong to two tools: `oxc`
configures the transform, `keepNames` is a Rolldown output option and has no
effect inside the `oxc` block. On Vite 7 and below all three go under `esbuild`
instead, as `jsx: 'automatic'`, `jsxDev: true` and `keepNames: true`. Either
major accepts the other's key in silence and builds without it taking effect, so
a report that names `a` rather than `Button` is the first sign the config landed
in the wrong section.

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

For Babel, the same three go on `@babel/preset-react`:

```js
// babel.config.js
export default {
  presets: [
    [
      '@babel/preset-react',
      {
        runtime: 'automatic',
        development: true,
        importSource: '@variance-authority/jsx-source',
      },
    ],
  ],
};
```

For TypeScript's own emit:

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsxdev",
    "jsxImportSource": "@variance-authority/jsx-source"
  }
}
```

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

So read the result rather than the config.

## Check that it worked

Two checks. Run whichever matches the artifact you instrumented.

**In a test that your instrumented config compiles**, ask
`@variance-authority/react` what the rendered node carries. Paste this whole
file:

```tsx
// @vitest-environment jsdom
// jsx-source-check.test.tsx
import { provenanceOf } from '@variance-authority/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Badge() {
  return <span data-check="badge">n</span>;
}

it('records the line that wrote the element', async () => {
  const container = document.body.appendChild(document.createElement('div'));
  await act(async () => {
    createRoot(container).render(<Badge />);
  });

  const node = container.querySelector('[data-check="badge"]')!;
  console.log(provenanceOf(node)?.source);

  expect(provenanceOf(node)?.source).toMatchObject({ line: 11, column: 10 });
});
```

Installed, the log line is a resolved location — the line the `<span>` is
written on, not the line `Badge` is declared on:

```js
{ file: '/repo/src/jsx-source-check.test.tsx', line: 11, column: 10 }
```

Not installed, `source` is `undefined`. In a development build
`provenanceOf(node)?.stack` then holds React's own frames instead — a URL the
browser fetched, awaiting a source map — and in a production build it holds
nothing at all.

**In an artifact you have already built**, read the symbol straight off the
fiber in the browser console. The key is registered with `Symbol.for`, so no
import and no install are involved:

```js
const node = document.querySelector('button');
const fiber = node[Object.keys(node).find((key) => key.startsWith('__reactFiber$'))];
fiber.memoizedProps[Symbol.for('@variance-authority/jsx-source')];
// → { file: '/repo/src/Button.jsx', line: 41, column: 6 }
```

`undefined` there means the transform passed no source, or the runtime swap did
not reach this module. Check the emitted bundle's runtime request and the
transform's development setting before changing application code.

### What you get

One `{ file, line, column }` per element, written on the props object React
commits. Rendering the three elements of a `<Catalogue>` — a `<ul>`, a keyed
`<li>` per id, and a `<Badge>` inside each — records this. `ul`, `li` and
`badge` are the rendered DOM nodes, found the way the check above finds one:

```js
provenanceOf(ul).source      // { file: 'src/catalogue.jsx', line: 21, column: 5 }
provenanceOf(li).source      // { file: 'src/catalogue.jsx', line: 23, column: 9 }
provenanceOf(badge).source   // { file: 'src/catalogue.jsx', line: 12, column: 4 }
provenanceOf(badge).owners   // [{ name: 'Badge', … }, { name: 'Catalogue', … }]
provenanceOf(badge).createdBy // 'Badge'
badge.attributes             // class — the symbol is not among them
```

The owners and `createdBy` are React's own bookkeeping and are there with or
without this package. What it adds is `source`, and the difference it makes to a
run is per-element granularity: every finding carries the same
`{ file, line, column }` as its `source`, and every entry in the run's lexicon
carries that `file` and `line`. Without it, both fall back to naming the
component and the file it is declared in — one answer for every element the
component renders.

The path is absolute here because that is what the transform wrote. The
collector knows the repository root and makes it relative on the way into a
report, so a location is repository-relative by the time you read it — and
absolute only when it was compiled from outside that root.

## `jsxSource()`

```js
import { jsxSource } from '@variance-authority/jsx-source/vite';
```

Takes no options. It returns a plugin object — `name`, `enforce: 'pre'`, and a
`resolveId` hook — that answers requests for `react/jsx-dev-runtime` with this
package's runtime, and answers nothing else. It declines to answer the recording
runtime's own import of React, which would otherwise hand that module itself.

The one setting that decides whether any of this produces a location is not the
plugin's, and the plugin cannot supply it: that is the `jsxDEV` emission above.

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
- `@variance-authority/jsx-source/under` — for a build whose resolver you write
  yourself, because it is neither Vite nor Jest: a webpack alias, an esbuild
  plugin, a loader. Write the module the swap points at, and hand `under` the
  real runtimes — it takes them as arguments rather than importing them,
  because an import of `react/jsx-dev-runtime` from a module standing in that
  specifier's place resolves back into itself:

  ```js
  // tools/recording-jsx-runtime.js — resolved in place of `react/jsx-dev-runtime`
  import * as development from 'react/jsx-dev-runtime';
  import * as production from 'react/jsx-runtime';
  import { under } from '@variance-authority/jsx-source/under';

  const runtime = under(development, production);

  export const Fragment = runtime.Fragment;
  export const jsxDEV = runtime.jsxDEV;
  ```

  Exempt this module's own import of `react/jsx-dev-runtime` from the swap, or
  it resolves back here. That exemption is what the Vite plugin does by
  checking the importer.

There is no default entrypoint. Importing this package from application code
is a mistake; the only correct callers are a compiler and a bundler.

This package does not render components, collect a DOM, or resolve source
maps. It only supplies the JSX runtime module the build already requests;
`@variance-authority/react` reads the resulting metadata, and the collector
decides how to use it.

## Source paths in a shipped bundle

They ship, and this package is not what puts them there. Development emission is
a compiler setting: with it on, every JSX element in the output carries a literal
object holding the file the compiler was given, which for every bundler in
ordinary use is an absolute path on the machine that ran the build.

```js
const a = jsxDEV("div", { className: "x" }, void 0, false, {
  fileName: "/Users/someone/proj/src/App.jsx",
  lineNumber: 1,
  columnNumber: 11
}, this);
```

That is the transform's output before this package sees it, and it is present in
any build with the setting on, installed or not. What this package adds is that
location on the props object — the same strings the compiler already wrote, no
new ones, and nothing that reaches the document.

So instrument the artifact you compare, not the artifact you serve to the
public. A built Storybook or a preview build is the subject either way; a
public-facing bundle built with development emission on carries your build
machine's directory layout to everyone who loads it.

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
- **A component renders elements it received as props:** the call site is
  the place the element was *written*, which is the caller, not the
  component that rendered it. That is the correct answer, and it is the
  same distinction `Provenance.createdBy` draws against `owners[0]`.
- **A Vite config fails to load the plugin:** a `vitest.config.ts` or
  `vite.config.ts` in a package that is not `"type": "module"` is loaded as
  CommonJS, and this package is ES-module-only. Rename it to `.mts`.

---

**[@variance-authority/jsx-source](https://variance-authority.dev/reference/packages/jsx-source)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
