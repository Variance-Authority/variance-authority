import * as development from 'react/jsx-dev-runtime';
import * as production from 'react/jsx-runtime';
import { under } from './under.js';

/**
 * The entrypoint a compiler imports when `jsxImportSource` names this package
 * and the JSX transform is running in development mode.
 *
 * It is React's runtime with one line added. Elements are created by React,
 * validated by React, and owned by React; the only difference is that the source
 * location the transform passed as the fifth argument survives as far as the
 * fiber instead of being dropped on the floor.
 *
 * This is the route for a project that has no custom JSX runtime of its own and
 * would rather change one compiler setting than add a plugin. A project already
 * pointing `jsxImportSource` somewhere — Emotion, theme-ui — must not point it
 * here, because it is one setting and there is only one of it. That project
 * installs {@link ./under.js} beneath React instead, and keeps both.
 */

export type { JSXSource } from 'react/jsx-dev-runtime';
export type { JSX } from 'react/jsx-dev-runtime';

const runtime = under(development, production);

export const Fragment = runtime.Fragment;
export const jsxDEV = runtime.jsxDEV;
