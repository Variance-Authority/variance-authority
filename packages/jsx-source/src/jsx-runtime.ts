/**
 * The entrypoint a compiler imports when `jsxImportSource` names this package
 * and the JSX transform is **not** running in development mode.
 *
 * A pass-through, and it has to exist. `jsxImportSource` is one setting for both
 * runtimes: the moment a project points it here, every build that leaves the
 * development transform off resolves `@variance-authority/jsx-source/jsx-runtime`
 * and fails if there is nothing there.
 *
 * It records nothing, because there is nothing to record — the production
 * transform computes no location and passes no source argument. That is the
 * setting to change, not this file: `jsxDev` is what decides whether locations
 * exist at all, and it is independent of whether the bundle is minified.
 */

export type { JSX } from 'react/jsx-runtime';
export * from 'react/jsx-runtime';
