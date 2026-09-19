/**
 * What a stylesheet asks for.
 *
 * One reader per language, kept beside its siblings —
 * [`python.ts`](./python.ts), [`rust.ts`](./rust.ts), [`jvm.ts`](./jvm.ts),
 * [`swift.ts`](./swift.ts) — rather than inside [`read.ts`](./read.ts), which
 * owns the [`Read`](./read.ts) contract every one of them fills and the module
 * reader `oxc` backs ([ADR-0066](../../../docs/context/adr/0066-a-language-is-a-reader-not-a-sense.md)).
 *
 * It is the one reader with no parser behind it, and the one whose requests bind
 * no names at all. Its half of resolution is here too: the Sass partial
 * convention is a naming rule rather than a resolver option, so the forms one
 * stylesheet specifier can take are written where the specifier is read, and
 * [`resolve.ts`](./resolve.ts) asks for them.
 */

import { isExternal, linesOf, type Read, type Request } from './read.js';

/** Extensions the stylesheet reader claims. */
export const STYLE_EXTENSIONS = ['.css', '.scss', '.sass', '.less'];

/**
 * `@import`, `@use`, `@forward` and `url()`, from a stylesheet.
 *
 * A scan of the text rather than a parse, because `oxc` reads JavaScript and
 * there is no CSS grammar in this dependency. That is a real limit and it is the
 * cheap half of a large saving: the file every visual-regression suite is most
 * afraid of is a token stylesheet, and *which components resolve through this
 * token file* is the question a component-declaration scan cannot ask at all.
 *
 * It over-reads rather than under-reads. A specifier inside a CSS comment becomes
 * an edge that is not real, which costs a collection; a specifier this failed to
 * see would cost a subject nobody observed.
 *
 * Nothing here binds a name. A stylesheet request is a whole-file dependency,
 * and `composes` is the one shape that names anything — a class rather than an
 * exported binding, which is not the same kind of name.
 */
export function readStyle(_file: string, contents: string): Read {
  const requests: Request[] = [];
  const lineAt = linesOf(contents);

  for (const pattern of [AT_RULE, URL, COMPOSES]) {
    for (const match of contents.matchAll(pattern)) {
      const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (value === '' || isExternal(value)) continue;
      requests.push({ value, kind: 'asset', bindings: [], line: lineAt(match.index) });
    }
  }

  return { requests };
}

/** `@import "x"`, `@import url("x")`, `@use "x"`, `@forward "x"`. */
const AT_RULE = /@(?:import|use|forward)\s+(?:url\(\s*)?(?:'([^']*)'|"([^"]*)")/g;

/** `url(x)` unquoted, and the quoted forms `url('x')` / `url("x")`. */
const URL = /\burl\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"]+))\s*\)/g;

/** CSS Modules: `composes: name from './other.css'`. */
const COMPOSES = /\bcomposes\s*:[^;]*?\bfrom\s+(?:'([^']*)'|"([^"]*)")/g;

/**
 * The forms one stylesheet specifier can take.
 *
 * Sass resolves `./colors` to `_colors.scss`, and the partial convention is a
 * naming rule rather than a resolution option, so it is tried as a second
 * request. The leading `~` of the webpack era means "from `node_modules`", which
 * is the plain bare specifier here.
 */
export function styleRequests(request: string): readonly string[] {
  const bare = request.startsWith('~') ? request.slice(1) : request;
  const cut = bare.lastIndexOf('/');
  const partial = `${bare.slice(0, cut + 1)}_${bare.slice(cut + 1)}`;

  return bare === request ? [bare, partial] : [bare, partial, request];
}
