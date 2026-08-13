import { JSX_SOURCE, type SourceLocation } from '@variance-authority/core';

/**
 * Recording the location the transform already computed.
 *
 * This is the whole package. The JSX transform knows the file, line and column
 * of every element it compiles and passes them to the runtime; React 19 accepts
 * the argument and throws it away. So the runtime this module backs stands one
 * step in front of React's, writes the location onto the props object, and hands
 * that object on unchanged.
 *
 * Nothing here reads a fiber, and nothing here is React-version-specific. It
 * works against a development React and a production one, before or after
 * minification, because a location is data the compiler emitted rather than a
 * name a bundler might rename.
 */

/** The fifth argument of `jsxDEV`, as every automatic-dev transform fills it. */
export interface JsxTransformSource {
  readonly fileName?: string | undefined;
  readonly lineNumber?: number | undefined;
  readonly columnNumber?: number | undefined;
}

/** Props under construction: a symbol key is not expressible in `Record<string, …>`. */
type MutableProps = Record<string | symbol, unknown>;

/** What the runtime passes React after the location has been written. */
export interface Recorded {
  readonly props: unknown;
  readonly key: unknown;
}

function locationOf(source: JsxTransformSource | undefined): SourceLocation | null {
  if (source === undefined || source === null || typeof source !== 'object') return null;

  const { fileName, lineNumber, columnNumber } = source;
  if (typeof fileName !== 'string' || fileName === '') return null;
  if (typeof lineNumber !== 'number') return null;

  return {
    file: fileName,
    line: lineNumber,
    column: typeof columnNumber === 'number' ? columnNumber : 0,
  };
}

/**
 * A copy of `config` without `key`, carrying every symbol the caller spread in.
 *
 * The reason this exists is the one non-obvious thing about the whole approach.
 * React copies `config` into a fresh props object **only when `key` is present**,
 * and it copies with `for…in`, which does not see symbols — so an element written
 * with a `key` would have arrived at the fiber with the location stripped, and
 * every element in a list would have been the one kind that lost it. Extracting
 * the key here means React takes its no-copy path and the props object that
 * reaches `memoizedProps` is the object written to below.
 */
function withoutKey(config: MutableProps): MutableProps {
  const copy: MutableProps = {};
  for (const name of Object.keys(config)) {
    if (name !== 'key') copy[name] = config[name];
  }
  for (const symbol of Object.getOwnPropertySymbols(config)) {
    copy[symbol] = config[symbol];
  }
  return copy;
}

/**
 * Write the location onto the props, and lift a `key` out of them.
 *
 * Total. A transform that passes no source, a config that is not an object, a
 * frozen config someone reused — each returns the arguments React would have
 * received anyway. The failure mode of this package is a missing location, never
 * an element that fails to render.
 */
export function record(
  config: unknown,
  maybeKey: unknown,
  source: JsxTransformSource | undefined,
): Recorded {
  const location = locationOf(source);
  if (location === null || config === null || typeof config !== 'object') {
    return { props: config, key: maybeKey };
  }

  const own = config as MutableProps;
  const hasKey = 'key' in own;
  const props = hasKey ? withoutKey(own) : own;
  const key = hasKey && own['key'] !== undefined ? own['key'] : maybeKey;

  try {
    props[JSX_SOURCE] = location;
  } catch {
    // A frozen or sealed config. Rare — a transform emits a fresh object literal
    // per element — but a thrown exception here would take down the render of a
    // page that had nothing wrong with it.
    const copy = withoutKey(own);
    copy[JSX_SOURCE] = location;
    return { props: copy, key };
  }

  return { props, key };
}
