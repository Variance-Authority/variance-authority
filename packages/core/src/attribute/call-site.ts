import type { Provenance, SourceLocation, StackFrame } from '../format/provenance.js';
import type { NodePath, SemanticNode, SemanticSnapshot } from '../format/snapshot.js';
import {
  inlineSourceMapOf,
  originalPositionFor,
  parseSourceMap,
  sourceMappingUrlOf,
  type SourceMap,
} from './source-map.js';
import { isVendorPath, servedPath, writerLocationOf } from './stack.js';

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
 * **And it is asked on a signal rather than on every capture.** Fourteen sites is
 * a bounded cost, not a free one, and a run that settles every subject on its
 * document digest has nobody to hand a location to: no region was drawn, no
 * finding was raised, and the fetches would answer a question nothing asked. So
 * frames ride the snapshot — they are provenance, and no hash projects
 * provenance — and {@link locateSites} spends them for the handful of nodes a
 * report is about to name. A page whose only change is one button resolves one
 * call site, not fourteen; a page that did not change resolves none.
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

    // No map is not failure, and it is not an answer either. A Node test runner
    // applies source maps to `Error.stack` itself, so its frame arrives already
    // original and there is nothing left to add. A served module carries no such
    // guarantee: a position in the text a server sent is a position in the
    // repository only if a map says so, so `writerLocationOf` refuses it.
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

      // The frame's own coordinates, for a frame that names a file on disk.
      // Delegated so there is one statement of the choosing rule rather than two.
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
 * Anything a report points at: it names a node, and may already know its line.
 *
 * An `AttributedRegion` and a `Finding` are both this, arrived at from opposite
 * directions — one from a mask, one from an inspection — and both are the *few*.
 * That is the whole reason this shape is worth having rather than two functions:
 * what makes resolution affordable is being asked about a handful of nodes, and
 * a handful is what a region list and a finding list are.
 */
export interface LocatableSite {
  readonly path?: NodePath;
  readonly source?: SourceLocation;
}

/**
 * The line for each site a report is about to name, and for nothing else.
 *
 * This is the demand side of the zero-install path. The page reads frames off
 * every fiber because reading them is nearly free; turning one into a file is
 * not, and this is the only place that spends it.
 *
 * Three ways a site costs nothing, all of them the common case:
 *
 * - **It has no `path`.** A region no box contains names no node.
 * - **It already has a `source`.** React ≤18 and `@variance-authority/jsx-source`
 *   both record the location outright, so there is nothing to resolve. Only
 *   React 19, which throws its location away and captures an `Error` instead,
 *   reaches the map.
 * - **Its node carried no frames.** A production build captures nothing.
 *
 * And a subject that settled on its document digest never calls this at all,
 * which is the point: no region, no finding, no fetch.
 *
 * Sites are resolved concurrently. The resolver's own cache collapses them onto
 * the modules they share, so two regions in one component cost one fetch.
 */
export async function locateSites<T extends LocatableSite>(
  sites: readonly T[],
  snapshot: SemanticSnapshot,
  resolver: CallSiteResolver,
): Promise<readonly T[]> {
  const wanted = sites.some((site) => site.source === undefined && site.path !== undefined);
  if (!wanted) return sites;

  // Built once and only when something asked. A path lookup on a tree is a walk,
  // and doing it per site would make a fifty-region page walk it fifty times.
  const nodes = index(snapshot.root);

  const located = await Promise.all(
    sites.map(async (site) => {
      if (site.source !== undefined || site.path === undefined) return site;

      const provenance = nodes.get(site.path)?.provenance;
      if (provenance?.stack === undefined) return site;

      const spent = await locateProvenance(provenance, resolver);
      return spent.source === undefined ? site : { ...site, source: spent.source };
    }),
  );

  return located.every((site, at) => site === sites[at]) ? sites : located;
}

function index(root: SemanticNode): ReadonlyMap<NodePath, SemanticNode> {
  const nodes = new Map<NodePath, SemanticNode>();

  const walk = (node: SemanticNode): void => {
    nodes.set(node.path, node);
    for (const child of node.children) walk(child);
  };
  walk(root);

  return nodes;
}

/**
 * A map's `sources` entry as a path, resolved against the module it describes.
 *
 * Maps state sources relatively — Vite writes `probe.jsx` for `/src/probe.jsx` —
 * so the entry alone is ambiguous between two directories. Resolved against the
 * module first, then stripped of the origin it resolved against, which is a fact
 * about the machine that served it rather than about the code.
 */
function sourcePath(source: string, moduleUrl: string): string {
  return servedPath(absolute(source, moduleUrl) ?? source);
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
