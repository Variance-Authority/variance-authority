/**
 * What a specifier says, before anything looks for it on a disk.
 *
 * The other half of [`resolve.ts`](./resolve.ts), and split from it along the
 * line [`read.ts`](./read.ts) already draws: *this file says it depends on
 * `./x`* is a fact about a string, and *`./x` is that file over there* needs a
 * tree, a resolver and an installed world. Everything here answers the first
 * kind, so every rule in it is assertable against a literal — which is what a
 * reader needs, since a reader has no disk either.
 *
 * The language is a parameter rather than an assumption, because the syntax
 * differs where it matters most: `.foo` is a bare package name in JavaScript
 * and a sibling module in Python, and a reader that guessed would turn an
 * ordinary dependency into a hole or a hole into silence.
 */

import { isBuiltin } from 'node:module';
import { extname } from 'node:path';
import type { EdgeKind } from '@variance-authority/core/relate';
import { carriesCode, languageOf, type LanguageId } from './language.js';
import { isPythonRelative } from './python.js';
import { isRustRelative } from './rust.js';
import { isSwiftRelative } from './swift.js';

/**
 * A specifier as a resolvable request, or nothing when it cannot be one.
 *
 * Query and fragment suffixes are a build-tool convention — `?raw`, `?url`,
 * `?inline` — and they name the same file with different handling. Stripping
 * them is what keeps a perfectly ordinary asset import from being reported as an
 * unresolvable hole, which marks its file unknown.
 *
 * A *leading* `#` is not a fragment. `#polyfill` is a subpath import, which
 * the nearest `package.json` maps in its `imports` field, and the resolver
 * owns that map. The stylesheet `url(#gradient)` never reaches here: a
 * stylesheet reader drops it as external first ([`isExternal`](./read.ts)).
 */
export function requestOf(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.startsWith('data:') || trimmed.startsWith('node:')) return undefined;

  const cut = Math.min(indexOr(trimmed, '?'), indexOr(trimmed, '#', trimmed.startsWith('#') ? 1 : 0));
  const bare = trimmed.slice(0, cut);

  return bare === '' ? undefined : bare;
}

function indexOr(value: string, mark: string, from = 0): number {
  const at = value.indexOf(mark, from);
  return at === -1 ? value.length : at;
}

/**
 * Whether a request names a path in this repository rather than a package.
 *
 * The language decides, because the syntax does. `.foo` is a bare package name
 * in JavaScript and a sibling module in Python, and getting it wrong in either
 * direction matters: a relative specifier that resolves to nothing is a hole —
 * a file this file depends on that nobody could find — and a bare one that does
 * is an ordinary third-party dependency.
 */
export function isRelative(request: string, language: LanguageId = 'module'): boolean {
  switch (language) {
    case 'python': return isPythonRelative(request);
    case 'rust': return isRustRelative(request);
    // Neither has a syntax that separates this repository from the platform:
    // `import java.util.List` and `import Foundation` are written exactly the
    // way a first-party import is, so nothing they fail to find is a hole
    // ([`jvm.ts`](./jvm.ts), [`swift.ts`](./swift.ts)).
    case 'java':
    case 'kotlin':
    case 'swift': return isSwiftRelative();
    default:
      return request.startsWith('./') || request.startsWith('../')
        || request === '.' || request === '..';
  }
}

/**
 * The package a specifier asks for, or nothing when it asks for no package.
 *
 * A relative path, an absolute one, a URL, a Node builtin and a subpath import
 * are all excluded — `#polyfill` is a name the importer's own package maps, and
 * no lockfile moves it. What is left is a bare specifier, whose package is its
 * first segment, or its first two when it is scoped. `@mui/material/Button` is
 * `@mui/material`, because that is the name an install resolves and the name a
 * lockfile moves.
 *
 * Nothing here checks whether the package exists. It cannot: the reason a bare
 * specifier reaches this function at all is that resolution declined to place
 * it, which under pnpm's store or Yarn PnP is the ordinary case rather than a
 * failure. A name is enough, and asking for more would make the answer depend
 * on whose machine ran the scan.
 */
export function packageOf(request: string): string | undefined {
  if (isRelative(request) || request.startsWith('/') || request.startsWith('#') || request.includes('://')) return undefined;
  if (isBuiltin(request)) return undefined;

  const parts = request.split('/');
  const name = request.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;

  // `@scope` on its own is not a package, and neither is the empty string a
  // specifier like `/` leaves behind.
  return name === '' || (name.startsWith('@') && !name.includes('/')) ? undefined : name;
}

/**
 * The edge kind, once the target is known.
 *
 * A specifier's *syntax* says how it was written; its *target* says what it is.
 * `import './button.css'` is written as an import and is an asset, and the
 * difference is what lets a caller ask for a traversal through code only.
 * A type import stays a type import whatever it points at — nothing it names
 * survives compilation.
 */
export function kindFor(kind: EdgeKind, target: string): EdgeKind {
  if (kind === 'type') return 'type';
  // Declared by the module's author, and read whatever it is, so it stays itself
  // for a finding to say why a test was selected.
  if (kind === 'depends') return 'depends';

  // What the target is read as, not whether it is JavaScript: a `.py` file is
  // code that carries a change the same way a `.ts` file is, and calling it an
  // asset would hide it from every traversal that asks for code only.
  return carriesCode(languageOf(extname(target)) ?? 'style') ? kind : 'asset';
}