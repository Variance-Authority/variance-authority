import type { SourceLocation, StackFrame } from '../format/provenance.js';
import type { OriginalPosition } from './source-map.js';

/**
 * Reading a call site out of a stack, and deciding which frame is the author.
 *
 * React 19 constructs an `Error` inside its own `jsx`/`jsxDEV` and keeps it on
 * every fiber. That error is a complete answer to "which line wrote this
 * element" that no build has to opt into: the runtime that captured it is frame
 * zero, and whoever called it is frame one. Nothing is configured, nothing is
 * installed, and the location is present in any build where React is the
 * development build — which is every dev server, every Vitest run and every Jest
 * run, because all three are what "not production" means.
 *
 * Two jobs live here and they are separable on purpose. Parsing a stack is a
 * fact about a JavaScript engine. Choosing *which* frame is the author is a
 * policy, and it is the part with a defensible rule rather than a heuristic:
 * the author is the first frame that maps back to code the project wrote. A
 * custom JSX runtime — Emotion, theme-ui — sits between React and the author and
 * is skipped not because it is on a list but because it resolves into
 * `node_modules`.
 */

/**
 * A frame is a wire value, not a local one: the page reads it, the collector
 * resolves it, and it travels between them on `Provenance`. It is declared where
 * the rest of provenance is declared, and re-exported here because this is the
 * group that does something with it.
 */
export type { StackFrame };

/**
 * V8: `    at App (http://host/src/probe.jsx:23:26)` — and the same without a
 * name for top-level code, which is why the parenthesised half is optional.
 *
 * `async`, `new` and `Object.<anonymous>` all land in the name, which is fine:
 * nothing here reads the name, and a name that is slightly wrong costs nothing
 * where a *position* that is slightly wrong costs a reviewer an open file.
 */
const V8_FRAME = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;

/** SpiderMonkey and JavaScriptCore: `App@http://host/src/probe.jsx:23:26`. */
const AT_FRAME = /^\s*(?:(.*?)@)(.+?):(\d+):(\d+)$/;

/**
 * The frames of a stack, in order, outermost call last.
 *
 * The message line is dropped, and so is any line neither engine format
 * recognises — a stack is diagnostic output rather than a data format, and a
 * frame that cannot be read is one fewer candidate rather than a failure.
 *
 * `eval` frames are deliberately not unwrapped. V8 writes them as
 * `at eval (eval at fn (http://host/a.js:1:1), <anonymous>:2:3)`, where two
 * positions are present and the inner one is meaningless outside the eval.
 * Taking the outer one would name the line that *called* `eval` as the line that
 * wrote the element, which is a confident wrong answer.
 */
export function parseStackFrames(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];

  for (const raw of stack.split('\n')) {
    const line = raw.trimEnd();
    if (line === '' || line.includes('(eval at ')) continue;

    const match = V8_FRAME.exec(line) ?? AT_FRAME.exec(line);
    if (match === null) continue;

    const [, name, url = '', lineDigits = '', columnDigits = ''] = match;
    if (url === '' || url.startsWith('data:')) continue;

    const at = Number(lineDigits);
    const column = Number(columnDigits);
    if (!Number.isFinite(at) || !Number.isFinite(column) || at < 1) continue;

    frames.push({
      url,
      line: at,
      column,
      ...(name !== undefined && name !== '' ? { function: name } : {}),
    });
  }

  return frames;
}

/**
 * Whether a path belongs to a dependency rather than to the project.
 *
 * Three spellings of the same fact, because three build tools spell it
 * differently: the directory itself, Vite's prebundled dependency cache, and the
 * `webpack-internal:` scheme wrapping the same directory. The test runs against
 * both the served URL — which saves fetching a map for a megabyte of vendor
 * code — and against the path the map resolves to, which is what actually
 * decides it.
 *
 * A dependency that *is* the subject cannot be attributed by this, and that is
 * the intended reading: a project reviewing its own components wants the line in
 * its own repository, and the line inside `react-dom` that rendered it is never
 * the answer to "what changed".
 */
export function isVendorPath(path: string): boolean {
  return (
    path.includes('node_modules') ||
    path.includes('/.vite/deps/') ||
    path.includes('/.yarn/') ||
    path.startsWith('webpack-internal:')
  );
}

/**
 * A served URL as a path: the origin dropped, the rest kept.
 *
 * An origin is a fact about the machine that ran the capture rather than about
 * the code. A dev server binds an ephemeral port and a preview server binds
 * another, so two runs of one suite would name every location differently, and
 * a cache-busting query would move under the same hand. What is left is what
 * the source index and `relativizeSource` already speak.
 *
 * Anything that does not parse as a URL is left exactly as it is — a bundler
 * that wrote an absolute filesystem path, or a `webpack://` specifier — because
 * inventing a shape for those would be a guess.
 */
export function servedPath(url: string): string {
  if (URL_OF === undefined) return url;
  try {
    return new URL_OF(url).pathname.replace(/^\/+/, '');
  } catch {
    return url;
  }
}

/**
 * The frame's own position on a disk, or `undefined` if a server sent it.
 *
 * The two arrive in the same field and mean different things when no map
 * answers for them. A browser frame is a position in whatever text the build
 * served, and only a map can say where that text came from. A Node frame is
 * already a position in a file: Node applies maps to `Error.stack` itself, so a
 * Vitest or Jest frame has been resolved before anything here sees it.
 *
 * Decided by the frame's own shape, because that is a property of the value in
 * hand. Nothing here asks a filesystem whether a path is real; a coordinate is
 * ours because of how it was obtained, and a disk cannot be asked about how.
 *
 * Four shapes are a disk. A bare path does not parse as a URL at all. A
 * `file:` URL is a path spelled formally, so it is decoded back into one —
 * whole, including the leading separator a served path sheds, because an
 * absolute path that arrives looking repository-relative is a wrong answer that
 * resolves. A Windows path is checked before either, because `C:\src\probe.ts`
 * parses as a URL whose scheme is the drive letter: a test that asked only
 * whether a frame parsed would call every frame on Windows served, and attribute
 * nothing at all there.
 *
 * **The fourth shape is React's, and it is refused — measured, not assumed.**
 * A component that ran on the server has no fiber in the browser and no module
 * the browser was served, so React manufactures a frame on the client out of
 * coordinates the server put on the wire:
 * `about://React/<environment>/<url>?<n>`. It *looks* like the third shape — a
 * `file:` URL naming a file in the repository — and it is not one. The
 * coordinates inside it are positions in the module the **server** compiled,
 * and that module is not the one the browser can fetch.
 *
 * Reading it as a path was tried against a real RSC route, and the answer was
 * wrong in the way that is worst: plausibly. React's frame for one `<aside>`
 * read `DocsPage.tsx:200`, in a file 146 lines long; the browser's own build of
 * the same source put that element at line 196 of a 268-line module, and
 * resolving *that* through its map landed on line 126 — a different element,
 * four lines from the right answer, with nothing about it to say so.
 *
 * So it falls to the `file:` test below and yields nothing, which is the rule
 * {@link writerLocationOf} already states for every served frame: a position in
 * text the build made is a position in this repository only if a map says so.
 * The component is still named — that comes from the owner chain, not from
 * here — and the source index still answers where it was declared.
 */
export function writtenPath(url: string): string | undefined {
  if (DRIVE.test(url)) return url;
  if (URL_OF === undefined) return url;

  let parsed;
  try {
    parsed = new URL_OF(url);
  } catch {
    return url;
  }

  if (parsed.protocol !== 'file:') return undefined;
  const path = decoded(parsed.pathname);
  return DRIVE.test(path.slice(1)) ? path.slice(1) : path;
}

/** `C:\src\probe.ts` and `C:/src/probe.ts`, and inside a `file:` URL's path. */
const DRIVE = /^[A-Za-z]:[\\/]/;

function decoded(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * The one host global this file needs, asked for rather than assumed. `core`
 * types no host library (ADR-0001), and taking a URL apart by hand is a bug
 * farm.
 */
const URL_OF = (globalThis as { URL?: new (url: string) => ParsedUrl }).URL;

/** As much of a parsed URL as this file reads. See {@link URL_OF}. */
interface ParsedUrl {
  readonly pathname: string;
  readonly protocol: string;
}

/**
 * The location that wrote this element, chosen from its stack.
 *
 * The rule is one sentence: **the first frame that resolves to a file the
 * project wrote.** Frame zero is always React's own runtime, because React is
 * what constructed the error. Frame one is the author in an ordinary build and
 * is a custom JSX runtime in a build that has one — and this does not need to
 * know which, because Emotion resolves into `node_modules` and the component
 * does not.
 *
 * That is the same answer the recorded-symbol path gives, arrived at from the
 * other side. Where `jsx-source` is installed it wins, because it is exact
 * without a map; this is what a project that installed nothing still gets — as
 * long as the build serving those frames emits maps. Where it does not, this
 * answers `null`, and a caller with no location is a caller that says so.
 *
 * `originalFor` is supplied rather than performed because resolving a frame
 * means fetching the module the browser was served, and this package may not
 * assume a network (ADR-0013). The caller owns the fetch, the cache, and the
 * decision about how long to wait; this owns which frame to ask about and when
 * to stop asking.
 */
export function writerLocationOf(
  frames: readonly StackFrame[],
  originalFor: (frame: StackFrame) => OriginalPosition | null,
): SourceLocation | null {
  for (const frame of frames) {
    if (isVendorPath(frame.url)) continue;

    const original = originalFor(frame);

    // A served frame with no map is a position in text the build made, and only
    // a map can say where that text came from. It is one fewer candidate rather
    // than a location: naming it anyway would put a coordinate in this
    // repository's basis that nothing in this repository was measured in, which
    // reads exactly like a real one and sends a reviewer to a line at random.
    //
    // A frame that is a path needs no map to have been read. Node applies them
    // to `Error.stack` before a runner ever sees it, so the position arrived
    // already resolved and the only thing left to take off it is the origin.
    if (original === null) {
      const written = writtenPath(frame.url);
      if (written === undefined) continue;
      return { file: written, line: frame.line, column: frame.column };
    }

    if (isVendorPath(original.source)) continue;

    return { file: original.source, line: original.line, column: original.column };
  }

  return null;
}
