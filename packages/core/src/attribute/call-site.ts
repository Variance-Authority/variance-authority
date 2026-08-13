import type { RawCapture, RawNode } from '../format/capture.js';
import type { Provenance, SourceLocation, StackFrame } from '../format/provenance.js';
import {
  inlineSourceMapOf,
  originalPositionFor,
  parseSourceMap,
  sourceMappingUrlOf,
  type SourceMap,
} from './source-map.js';
import { isVendorPath, writerLocationOf } from './stack.js';

/**
 * Spending the frames a page read, to get the file a reviewer opens.
 *
 * This is the half of the zero-install path that cannot happen in the page. A
 * frame names the module the browser was *served*, and turning that into a line
 * in the repository means fetching that module and reading the source map the
 * build already emitted beside it. Fetching is not something a page agent should
 * do — it runs inside somebody else's application, on a budget measured against
 * their render loop — and it is exactly what the collector is for.
 *
 * **The economics are what make this worth doing rather than clever.** Measured
 * on a 4211-node document: every fiber carried a stack, and between them they
 * held **14 distinct call sites**. A hundred-row table writes two thousand cells
 * from one line of JSX. So the work is per *call site*, not per node, and the
 * cache below is not an optimization but the thing that makes the cost bounded —
 * a handful of module fetches for a whole page.
 *
 * `fetchModule` is injected because `core` may not assume a network (ADR-0013),
 * and because the right way to fetch differs by caller: a browser-driving
 * collector should fetch from the page's own context, where the origin, the
 * cookies and the dev server's module graph are already correct.
 */

/** Fetch a module's text, or answer that it cannot be had. Never throws. */
export type FetchModule = (url: string) => Promise<string | null>;

export interface CallSiteResolver {
  /** The location that wrote an element, from the frames its fiber carried. */
  locate(frames: readonly StackFrame[]): Promise<SourceLocation | null>;
  /** How many modules were fetched, and how many call sites they answered. */
  readonly stats: CallSiteStats;
}

export interface CallSiteStats {
  /** Distinct modules fetched. The number that costs anything. */
  readonly modules: number;
  /** Distinct call sites asked about — the ratio to `modules` is the point. */
  readonly sites: number;
  /** Call sites that resolved to a file. */
  readonly located: number;
}

export function createCallSiteResolver(fetchModule: FetchModule): CallSiteResolver {
  /** Module URL → its map, `null` once we know it has none. Also the in-flight guard. */
  const maps = new Map<string, Promise<readonly SourceMap[] | null>>();
  /** `url:line:column` → the answer, so a page's 4211 nodes cost 14 resolutions. */
  const sites = new Map<string, Promise<SourceLocation | null>>();

  const stats = { modules: 0, sites: 0, located: 0 };

  async function mapsFor(url: string): Promise<readonly SourceMap[] | null> {
    const cached = maps.get(url);
    if (cached !== undefined) return cached;

    const pending = (async () => {
      stats.modules += 1;

      const code = await fetchModule(url);
      if (code === null) return null;

      const annotation = sourceMappingUrlOf(code);
      if (annotation === null) return null;

      const inline = inlineSourceMapOf(annotation);
      if (inline !== null) return parseSourceMap(inline);

      // A sibling file, which is what a production bundler writes. Resolved
      // against the module rather than the page: `//# sourceMappingURL=out.js.map`
      // means "beside this module", and a page several directories deep would
      // otherwise ask for it in the wrong place.
      const sibling = absolute(annotation, url);
      const text = sibling === null ? null : await fetchModule(sibling);
      return text === null ? null : parseSourceMap(text);
    })();

    maps.set(url, pending);
    return pending;
  }

  async function locateFrame(frame: StackFrame): Promise<SourceLocation | null> {
    const parsed = await mapsFor(frame.url);

    // No map is not failure. A dev server serving a plain `.js` as written, and a
    // Node test runner — which applies source maps to `Error.stack` itself, so
    // the frame arrives already original — both land here with the answer in
    // hand. `writerLocationOf` keeps the frame's own coordinates in that case.
    if (parsed === null || parsed.length === 0) return null;

    const original = originalPositionFor(parsed, frame.line, frame.column);
    if (original === null) return null;

    return {
      file: sourcePath(original.source, frame.url),
      line: original.line,
      column: original.column,
    };
  }

  async function locate(frames: readonly StackFrame[]): Promise<SourceLocation | null> {
    for (const frame of frames) {
      if (isVendorPath(frame.url)) continue;

      const key = `${frame.url}:${frame.line}:${frame.column}`;
      let answer = sites.get(key);

      if (answer === undefined) {
        stats.sites += 1;
        answer = locateFrame(frame);
        sites.set(key, answer);
      }

      const located = await answer;

      // The frame's own coordinates, for a module served as written. Delegated so
      // there is one statement of the choosing rule rather than two.
      const chosen =
        located === null
          ? writerLocationOf([frame], () => null)
          : isVendorPath(located.file)
            ? null
            : located;

      if (chosen !== null) {
        stats.located += 1;
        return chosen;
      }
    }

    return null;
  }

  return { locate, stats: stats as CallSiteStats };
}

/**
 * Provenance with its frames spent: `source` filled in, `stack` gone.
 *
 * Returned unchanged when there is nothing to do — which is the common case once
 * a project installs `jsx-source`, and the case a production build is always in.
 * Never throws: a report that names a location for most of its nodes is the
 * normal outcome, and one node's unreachable module must not take the run down.
 */
export async function locateProvenance(
  provenance: Provenance,
  resolver: CallSiteResolver,
): Promise<Provenance> {
  const { stack, ...carried } = provenance;
  if (stack === undefined || stack.length === 0) return provenance;

  let source: SourceLocation | null = null;
  try {
    source = await resolver.locate(stack);
  } catch {
    source = null;
  }

  return source === null ? carried : { ...carried, source };
}

/**
 * A capture with every node's frames spent, before it is normalized.
 *
 * The one place a capture is walked for this, and it runs before normalization
 * on purpose: `source` is a field the ruleset already knows how to root and
 * hash, so resolving first means nothing downstream learns that stack frames
 * exist. What normalization does with a stack that reached it anyway is drop it.
 *
 * Returned unchanged when no node carried frames, which is the whole of a
 * production build and of any project that installed `jsx-source`. The walk is
 * still paid — it is a tree traversal against thousands of fetch-free nodes, and
 * `structuredClone`-free rebuilding only happens along paths that changed.
 */
export async function locateCapture(
  capture: RawCapture,
  resolver: CallSiteResolver,
): Promise<RawCapture> {
  const root = await locateNode(capture.root, resolver);
  const portals = capture.portals
    ? await Promise.all(capture.portals.map((portal) => locateNode(portal, resolver)))
    : undefined;

  const rootHeld = root === capture.root;
  const portalsHeld =
    portals === undefined || portals.every((portal, index) => portal === capture.portals?.[index]);

  if (rootHeld && portalsHeld) return capture;

  return { ...capture, root, ...(portals !== undefined ? { portals } : {}) };
}

async function locateNode(node: RawNode, resolver: CallSiteResolver): Promise<RawNode> {
  // Children first and all at once. The resolver's own cache collapses them onto
  // a handful of modules, so the concurrency costs nothing and saves a page's
  // worth of sequential awaits.
  const [provenance, children, shadowChildren] = await Promise.all([
    node.provenance === undefined
      ? undefined
      : locateProvenance(node.provenance, resolver),
    Promise.all(node.children.map((child) => locateNode(child, resolver))),
    node.shadowChildren === undefined
      ? undefined
      : Promise.all(node.shadowChildren.map((child) => locateNode(child, resolver))),
  ]);

  const held =
    provenance === node.provenance &&
    children.every((child, index) => child === node.children[index]) &&
    (shadowChildren === undefined ||
      shadowChildren.every((child, index) => child === node.shadowChildren?.[index]));

  if (held) return node;

  return {
    ...node,
    ...(provenance !== undefined ? { provenance } : {}),
    children,
    ...(shadowChildren !== undefined ? { shadowChildren } : {}),
  };
}

/**
 * A map's `sources` entry as a path, resolved against the module it describes.
 *
 * Maps state sources relatively — Vite writes `probe.jsx` for `/src/probe.jsx` —
 * so the entry alone is ambiguous between two directories. Resolved and then
 * stripped to a path, because the origin is a fact about the machine that ran
 * the capture: a baseline holding `http://localhost:5199/src/probe.jsx` would
 * disagree with the next run on a different port. What is left is what the
 * source index and `relativizeSource` already speak.
 */
function sourcePath(source: string, moduleUrl: string): string {
  const resolved = absolute(source, moduleUrl) ?? source;
  const parsed = parseUrl(resolved);

  // Not a URL: a bundler that wrote an absolute filesystem path, or a
  // `webpack://` specifier. Left as it is — `relativizeSource` handles the
  // first, and inventing a shape for the second would be a guess.
  return parsed === null ? resolved : parsed.pathname.replace(/^\/+/, '');
}

function absolute(url: string, base: string): string | null {
  return parseUrl(url, base)?.href ?? null;
}

/**
 * The one host global this file needs, asked for rather than assumed.
 *
 * `core` types no host library (ADR-0001) and joining URLs by hand is a bug farm
 * — `..` past the root, a query string on the base, a protocol-relative
 * specifier. `URL` is present in every Node release this project supports and in
 * every browser, so the honest thing is to use it and to degrade if it is not
 * there, exactly as `inlineSourceMapOf` does for `atob`.
 */
interface ParsedUrl {
  readonly href: string;
  readonly pathname: string;
}

const URL_OF = (globalThis as { URL?: new (url: string, base?: string) => ParsedUrl }).URL;

function parseUrl(url: string, base?: string): ParsedUrl | null {
  if (URL_OF === undefined) return null;

  try {
    return new URL_OF(url, base);
  } catch {
    return null;
  }
}
