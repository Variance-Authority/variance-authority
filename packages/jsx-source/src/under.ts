import type { ElementType, Key, ReactElement } from 'react';
import { record, type JsxTransformSource } from './record.js';

/**
 * Recording from **underneath** React's runtime rather than in front of it.
 *
 * `jsxImportSource` is one setting for a whole build, so a package that claims it
 * does not compose — it replaces. A project already compiling against Emotion,
 * theme-ui, or any other custom runtime would have to give that up to record
 * source locations, which is not a trade worth offering.
 *
 * It is also unnecessary. Every custom JSX runtime is a thin wrapper that ends up
 * calling `react/jsx-dev-runtime`, and every one of them forwards the transform's
 * source argument on the way — Emotion's `jsxDEV` takes all six parameters and
 * passes all six along, swapping only the element type when a `css` prop is
 * present. So the place to stand is the bottom of that chain: put this module
 * where `react/jsx-dev-runtime` used to resolve, and every runtime layered above
 * it keeps working, unmodified and unaware.
 *
 * The two ways to install it are {@link ./vite.js} for anything Vite builds —
 * Storybook's React builder and Vitest included — and the Jest resolver for Jest.
 * Both do the same thing: swap the module, leave `jsxImportSource` alone.
 */

/** React's development runtime, as it exists in a development build. */
export interface DevelopmentRuntime {
  readonly Fragment: unknown;
  readonly jsxDEV?:
    | ((
        type: ElementType,
        props: unknown,
        key: Key | undefined,
        isStatic: boolean,
        source?: JsxTransformSource,
        self?: unknown,
      ) => ReactElement)
    | undefined;
}

/** React's production runtime, which a production build resolves instead. */
export interface ProductionRuntime {
  readonly jsx: (type: ElementType, props: unknown, key?: Key | undefined) => ReactElement;
  readonly jsxs: (type: ElementType, props: unknown, key?: Key | undefined) => ReactElement;
}

/** What stands in `react/jsx-dev-runtime`'s place. */
export interface RecordingRuntime {
  readonly Fragment: unknown;
  readonly jsxDEV: (
    type: ElementType,
    props: unknown,
    key: Key | undefined,
    isStatic: boolean,
    source?: JsxTransformSource,
    self?: unknown,
  ) => ReactElement;
}

/**
 * Wrap the real runtimes, and record on the way through.
 *
 * Both are taken as arguments rather than imported, because this module is meant
 * to be resolved *as* `react/jsx-dev-runtime`: an import of that specifier from
 * here would resolve straight back to here. Whoever installs it has already
 * resolved the real thing and is the only one who can hand it over.
 */
export function under(
  development: DevelopmentRuntime,
  production: ProductionRuntime,
): RecordingRuntime {
  const create = development.jsxDEV;

  return {
    Fragment: development.Fragment,
    jsxDEV(type, props, key, isStatic, source, self) {
      const recorded = record(props, key, source);
      const recordedKey = recorded.key as Key | undefined;

      /**
       * React ships a `jsx-dev-runtime` in its production build too, and there
       * `jsxDEV` is exported as `undefined` (read in 19.2.8). A build that turns
       * the development transform on for a production bundle — exactly what a
       * project wants when it needs source locations out of a minified artifact —
       * would otherwise call `undefined` on its first element.
       *
       * The fallback is the production runtime, which is what that build was
       * going to get anyway. What it costs is React's own development
       * bookkeeping: no owner, no element stack, no key warnings. What it keeps
       * is the location.
       */
      if (typeof create === 'function') {
        return create(type, recorded.props, recordedKey, isStatic, source, self);
      }

      const fallback = isStatic ? production.jsxs : production.jsx;
      return fallback(type, recorded.props, recordedKey);
    },
  };
}
