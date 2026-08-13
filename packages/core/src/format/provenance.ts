import { digestValue, type Digest } from './hash.js';

/**
 * Provenance: the chain that lets a diff arrive already carrying a name.
 *
 * Principle 5 says causality flows forward — code to semantic to raster — and the
 * system never infers cause from pixels. Provenance is what makes that possible:
 * every serialized node remembers which components produced it, so by the time a
 * change is observed, its owner is already known rather than reconstructed.
 */

export interface Provenance {
  /**
   * Composite components enclosing this node, innermost first:
   * `['Button', 'Header', 'CheckoutPage']`. Host elements are excluded — they
   * are not units anyone owns or adjudicates.
   */
  readonly owners: readonly OwnerFrame[];

  /**
   * The component whose JSX literally created this element, when the renderer
   * records it. Distinct from `owners[0]`, which is the nearest *enclosing*
   * component: a `<Button>` passed as a prop and rendered by `Toolbar` is owned
   * by its author but enclosed by `Toolbar`. Attribution needs the author;
   * "where did it end up" needs the enclosure.
   */
  readonly createdBy?: string;

  /** Enabled per project via a compiler plugin; absent otherwise. */
  readonly source?: SourceLocation;

  /**
   * Call-site candidates read off the fiber, awaiting a source map. **Transient.**
   *
   * This is what a project that installed *nothing* has: React's development
   * build constructs an `Error` inside its own `jsx` and keeps it on every fiber,
   * so the call site is already present in any dev server, Vitest or Jest run.
   * What it is not yet is a location — a frame names the module the browser was
   * served, and the file a reviewer opens is a source map away.
   *
   * Present only between the page read and resolution. The collector spends it,
   * writing `source`; normalize drops it either way, so it never reaches a
   * document, a digest or a baseline. That is deliberate rather than tidy: a
   * frame holds an absolute URL with a build hash in it, and hashing one would
   * make every baseline disagree with the next dev-server restart.
   */
  readonly stack?: readonly StackFrame[];
}

/**
 * One frame of a stack an engine wrote, as positions in the served module.
 *
 * Not a `SourceLocation` and deliberately not shaped like one. A `SourceLocation`
 * is an answer — a file and a line somebody can open. This is the question: a URL
 * the browser fetched, at coordinates in the code it was actually sent.
 */
export interface StackFrame {
  /** The URL the engine reported, with any query string kept — it is part of the module's identity. */
  readonly url: string;
  /** 1-based, as the engine counts. */
  readonly line: number;
  /** 1-based, as the engine counts. */
  readonly column: number;
  /** The function the engine named, when it named one. Top-level code has none. */
  readonly function?: string;
}

export interface OwnerFrame {
  /** `displayName`, falling back to function name, falling back to `Anonymous`. */
  readonly name: string;

  /**
   * Digest of this boundary's serializable props.
   *
   * This is what separates a *root* change from a *collateral* one (spec §6.2):
   * a subtree that changed while its incoming props digest held is an internal
   * change and this component is the root. If the digest moved too, the change
   * arrived from outside and the root is upstream.
   */
  readonly propsDigest: Digest;

  /**
   * The component whose JSX created *this component's* element.
   *
   * Needed because the two useful senses of "who is responsible" separate here.
   * `Provenance.createdBy` names whoever rendered the host node — for a `<Chip>`,
   * that is `Chip` itself. This names whoever decided a `<Chip>` belongs at this
   * point in the tree, which is a different component and the one that owns a
   * structural change. When a list reorders, blaming the moved element reports
   * the thing that was rearranged; this names the code that rearranged it.
   */
  readonly createdBy?: string;
}

export interface SourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/**
 * Where a JSX transform leaves the location, and where a fiber reader finds it.
 *
 * Every JSX transform in ordinary use already computes this. The automatic dev
 * runtime passes `{fileName, lineNumber, columnNumber}` as the fifth argument to
 * `jsxDEV`; the classic transform passes it as a `__source` prop. **React 19
 * discards both** — `jsxDEV`'s public export takes four parameters and
 * synthesizes its own `Error` for the fifth, and `createElement` skips
 * `__source` by name when it copies config into props (both read in 19.2.8).
 * Nothing is missing from the build; the last hop is missing from the runtime.
 *
 * So the runtime is the hop: `@variance-authority/jsx-source` sits in front of
 * React's, writes the location here, and hands the props on unchanged. A symbol
 * rather than a string key is what makes that free — `for…in` does not enumerate
 * it, so `react-dom` never renders it as an attribute, `propsDigest` never
 * digests it, and a component spreading `{...props}` onto a host element does not
 * put it in the document.
 *
 * `Symbol.for` rather than a module-level symbol: the writer is in the page's
 * bundle and the reader is in a page agent evaluated beside it. They are two
 * module graphs and will never share an import, so the registry is the only
 * place they can meet.
 */
export const JSX_SOURCE: unique symbol = Symbol.for(
  '@variance-authority/jsx-source',
) as typeof JSX_SOURCE;

/**
 * The location a JSX runtime recorded on this props object, if one did.
 *
 * Total, and deliberately so: this runs once per node across a whole document,
 * for props objects React built from arbitrary user code. A shape that does not
 * match is absence, never a throw.
 */
export function jsxSourceOf(props: unknown): SourceLocation | undefined {
  if (props === null || typeof props !== 'object') return undefined;

  const recorded = (props as Record<symbol, unknown>)[JSX_SOURCE];
  if (recorded === null || typeof recorded !== 'object') return undefined;

  const { file, line, column } = recorded as Partial<SourceLocation>;
  if (typeof file !== 'string' || file === '' || typeof line !== 'number') return undefined;

  return { file, line, column: typeof column === 'number' ? column : 0 };
}

/**
 * The same location, expressed relative to a root.
 *
 * A transform writes the path it compiled — which for every bundler in ordinary
 * use is absolute, because that is what its module graph holds. Two things go
 * wrong if that reaches a report. A baseline committed from one machine names
 * `/Users/somebody/...`, which is both a home directory in a public repository
 * and a path that resolves nowhere in CI; and the location no longer matches
 * `SourceRef.file`, which the source index has always answered with
 * repository-relative paths.
 *
 * A path *outside* the root is returned untouched rather than turned into a
 * chain of `..`. Something compiled from elsewhere — a linked package, a
 * dependency shipping JSX — is genuinely not at a repository-relative path, and
 * an absolute one an editor can open beats a relative one that resolves nowhere.
 */
export function relativizeSource(location: SourceLocation, root: string): SourceLocation {
  const path = location.file.replace(/\\/g, '/');
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (base === '' || !path.startsWith(`${base}/`)) return location;

  return { ...location, file: path.slice(base.length + 1) };
}

/**
 * Digest a props object, tolerating values that cannot be serialized.
 *
 * The stability requirement cuts both ways (spec §11.2). Over-invalidation:
 * inline arrow functions and object literals get a fresh identity every render,
 * so identity-based digests would report every subject as changed, every build.
 * Under-invalidation: collapsing all functions to one token hides a genuinely
 * swapped handler.
 *
 * We resolve toward *shape*, deliberately accepting the under-invalidation:
 * - a function digests as its name, so `onClick={handleSave}` differs from
 *   `onClick={handleDelete}` but re-creating the same arrow does not register;
 * - an element digests as its type, so swapping `<Icon>` for `<Avatar>`
 *   registers but re-creating the same element does not.
 *
 * The accepted cost is real: renaming nothing but rebinding an anonymous closure
 * to different behavior is invisible here. That is tolerable only because props
 * digests are an *attribution* input, not a correctness gate — the rendered
 * output still changes, and the semantic diff still catches it. The digest
 * decides who gets blamed, not whether anything happened.
 */
export function propsDigest(props: Readonly<Record<string, unknown>>): Digest {
  return digestValue(shapeOf(props, new WeakSet(), { left: MAX_VALUES }) as never);
}

/**
 * Values one digest may walk before it stops walking.
 *
 * The cycle guard below unwinds on exit, deliberately — two references to one
 * object must digest the same wherever they appear — and the cost of that is
 * that a *shared* subgraph is re-walked once per path to it. On a graph with
 * enough sharing that is exponential, and exponential inside somebody else's
 * page is not a slow digest: it is the renderer process dying with the capture
 * in it. Far above any authored props object; only a graph nobody meant to hand
 * us reaches it.
 */
const MAX_VALUES = 20_000;

interface Budget {
  left: number;
}

function shapeOf(value: unknown, seen: WeakSet<object>, budget: Budget): unknown {
  if (value === null) return null;

  switch (typeof value) {
    case 'undefined':
      // Distinguished from absence: `{a: undefined}` and `{}` render the same
      // but are different authoring intents, and the docket should say which.
      return '\u0000undefined';
    case 'boolean':
    case 'string':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : `\u0000number:${String(value)}`;
    case 'bigint':
      return `\u0000bigint:${value.toString()}`;
    case 'symbol':
      return `\u0000symbol:${value.description ?? ''}`;
    case 'function':
      return `\u0000fn:${value.name || 'anonymous'}`;
  }

  const object = value as object;

  // A cyclic prop graph is normal (a node holding its parent). Recursing is not.
  if (seen.has(object)) return '\u0000cycle';
  if ((budget.left -= 1) < 0) return '\u0000budget';
  seen.add(object);

  try {
    if (Array.isArray(object)) {
      return object.map((item) => shapeOf(item, seen, budget));
    }

    const element = asReactElement(object);
    if (element) return `\u0000element:${element}`;

    const host = asHostObject(object);
    if (host !== null) return host;

    const shape: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) {
      shape[key] = shapeOf((object as Record<string, unknown>)[key], seen, budget);
    }
    return shape;
  } finally {
    seen.delete(object);
  }
}

/**
 * A DOM node or a window, named rather than walked.
 *
 * **The reason this exists is a crash.** A prop holding an element is ordinary —
 * Storybook hands every story its `canvasElement` — and `Object.keys` on an
 * element returns its expandos, which on a React page are `__reactFiber$…` and
 * `__reactContainer$…`. Walking one therefore walks the entire fiber graph
 * through `child`, `sibling`, `return` and `alternate`, and that graph shares
 * subtrees along many paths. Verified: hashing `canvasElement` on a story with
 * two nested Suspense boundaries takes the renderer process down with an
 * out-of-memory kill, taking the capture with it.
 *
 * Naming it is also the answer that was right anyway. A digest exists to say
 * whether the *inputs* to a component changed, and an element's identity moves
 * on every remount while its expandos move on every render — so walking one
 * would report a prop change on a subject nobody touched. Detected structurally,
 * because `core` runs in Node as well as in a page and may not assume `Node`
 * exists (ADR-0001).
 */
function asHostObject(object: object): string | null {
  const node = object as { nodeType?: unknown; nodeName?: unknown; window?: unknown };

  if (typeof node.nodeType === 'number' && typeof node.nodeName === 'string') {
    return `\u0000node:${node.nodeName}`;
  }

  // A window holds every global there is, including the document, and is the
  // same explosion by another door.
  if (node.window === object) return '\u0000window';

  return null;
}

/**
 * Recognize a React element without importing React.
 *
 * `core` must stay framework-free (ADR-0001), and the element brand is a stable
 * public contract — `Symbol.for('react.element')` for the classic runtime,
 * `react.transitional.element` since React 19. Structural detection here beats a
 * dependency edge from `core` to React.
 */
function asReactElement(object: object): string | null {
  const $$typeof = (object as { $$typeof?: symbol }).$$typeof;
  if (typeof $$typeof !== 'symbol') return null;

  const brand = $$typeof.description ?? '';
  if (brand !== 'react.element' && brand !== 'react.transitional.element') return null;

  const type = (object as { type?: unknown }).type;
  if (typeof type === 'string') return type;
  if (typeof type === 'function') return type.name || 'Anonymous';
  return 'Unknown';
}
