import type { ElementType, Key, ReactElement } from 'react';
import * as development from 'react/jsx-dev-runtime';
import * as production from 'react/jsx-runtime';
import { record, type JsxTransformSource } from './record.js';

/**
 * The entrypoint a compiler imports when `jsxImportSource` names this package
 * and the JSX transform is running in development mode.
 *
 * It is React's runtime with one line added. Elements are created by React,
 * validated by React, and owned by React; the only difference is that the source
 * location the transform passed as the fifth argument survives as far as the
 * fiber instead of being dropped on the floor.
 */

export type { JSXSource } from 'react/jsx-dev-runtime';
export type { JSX } from 'react/jsx-dev-runtime';

export const Fragment = development.Fragment;

export function jsxDEV(
  type: ElementType,
  props: unknown,
  key: Key | undefined,
  isStatic: boolean,
  source?: JsxTransformSource,
  self?: unknown,
): ReactElement {
  const recorded = record(props, key, source);
  const recordedKey = recorded.key as Key | undefined;

  /**
   * React ships a `jsx-dev-runtime` in its production build too, and there
   * `jsxDEV` is exported as `undefined` (read in 19.2.8). A build that turns the
   * development transform on for a production bundle — which is exactly what a
   * project wants when it needs source locations out of a minified artifact —
   * would otherwise call `undefined` on its first element.
   *
   * The fallback is the production runtime, which is what that build was going
   * to get anyway. What it costs is React's own development bookkeeping: no
   * owner, no element stack, no key warnings. What it keeps is the location.
   */
  const create = development.jsxDEV as typeof development.jsxDEV | undefined;
  if (typeof create === 'function') {
    return create(type, recorded.props, recordedKey, isStatic, source, self);
  }

  const fallback = isStatic ? production.jsxs : production.jsx;
  return fallback(type, recorded.props, recordedKey);
}
