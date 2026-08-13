/**
 * One file's outgoing specifiers, without resolving any of them.
 *
 * Two readers — a module reader and a stylesheet reader — and the boundary
 * between "this file says it depends on `./x`" and "`./x` is that file over
 * there" is deliberate: resolution needs a disk and a resolution algorithm, and
 * this needs neither, so every rule about what counts as an edge is assertable
 * against a string.
 *
 * ## Why the module record and not the tree
 *
 * `oxc-parser` returns a lazily-deserialized result. The full AST is available
 * behind `.program` and is the expensive half; `.module` is the ES module record
 * the parser has already computed — every static import, every re-export, every
 * `import()` — and touching it never materializes a node. A change-management
 * scan wants exactly that record and nothing else, so it pays for a parse and
 * not for a tree.
 *
 * ## The dangerous direction
 *
 * A missed edge is not a smaller answer; it is a **wrong** one. A file whose
 * imports this cannot enumerate may import the file that just changed, and a
 * selector that treats "I found no imports" as "it imports nothing" produces a
 * green run over a surface nobody looked at.
 *
 * So this refuses to guess, and says so instead. `unknown` is set when:
 *
 * | shape | why |
 * |---|---|
 * | the parser reported an error | the record may be truncated at the error |
 * | `import(x)` where `x` is not a literal | the target is a runtime value |
 * | a `require(…)` this could not read as a literal | same, and invisible to the module record |
 *
 * A literal `require('./x')` is *not* in that table: it is read and becomes an
 * edge, which is what keeps a CommonJS corner of a repository from widening
 * every run it appears in.
 */

import { parseSync } from 'oxc-parser';
import type { EdgeKind } from '@variance-authority/core';

export interface Specifier {
  /** As written. Unresolved — `./x`, `@scope/pkg`, `../theme.css`. */
  readonly value: string;
  readonly kind: EdgeKind;
}

export interface Read {
  readonly specifiers: readonly Specifier[];
  /** Why this file's specifiers are not the whole set, when they are not. */
  readonly unknown?: string;
}

/** Extensions the module reader claims. Everything else is somebody else's. */
export const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** Extensions the stylesheet reader claims. */
export const STYLE_EXTENSIONS = ['.css', '.scss', '.sass', '.less'];

/**
 * Static imports, re-exports and literal dynamic imports, from the module record.
 *
 * A type-only import is kept as its own kind rather than dropped. It cannot move
 * a pixel — every compiler erases it — and dropping it here would decide that for
 * every consumer, including the ones asking what a file rests on rather than what
 * a change could repaint.
 */
export function readModule(file: string, contents: string): Read {
  let result;
  try {
    result = parseSync(file, contents);
  } catch (error) {
    return { specifiers: [], unknown: `${file} could not be parsed: ${messageOf(error)}` };
  }

  const specifiers: Specifier[] = [];
  const record = result.module;

  for (const entry of record.staticImports) {
    // No entries at all is `import './x'` — a side effect, which is the shape a
    // stylesheet arrives in and never a type import.
    const kind: EdgeKind =
      entry.entries.length > 0 && entry.entries.every((binding) => binding.isType)
        ? 'type'
        : 'imports';
    specifiers.push({ value: entry.moduleRequest.value, kind });
  }

  for (const entry of record.staticExports) {
    for (const binding of entry.entries) {
      if (binding.moduleRequest === null) continue;
      specifiers.push({
        value: binding.moduleRequest.value,
        kind: binding.isType ? 'type' : 'reexports',
      });
    }
  }

  const reasons: string[] = [];

  for (const entry of record.dynamicImports) {
    const literal = quoted(contents.slice(entry.moduleRequest.start, entry.moduleRequest.end));
    if (literal === undefined) {
      reasons.push('an `import()` whose specifier is not a literal');
      continue;
    }
    specifiers.push({ value: literal, kind: 'dynamic' });
  }

  const required = readRequires(contents);
  specifiers.push(...required.specifiers);
  if (required.unknown !== undefined) reasons.push(required.unknown);

  // Errors are recoverable in `oxc` — a result always comes back — so the record
  // is a *partial* answer rather than an absent one, which is the case this
  // whole file exists to refuse to round down.
  if (result.errors.length > 0) {
    reasons.push(`${result.errors.length} parse error(s): ${result.errors[0]?.message ?? ''}`);
  }

  return {
    specifiers,
    ...(reasons.length > 0 ? { unknown: `${file} — ${reasons.join('; ')}` } : {}),
  };
}

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
 */
export function readStyle(_file: string, contents: string): Read {
  const specifiers: Specifier[] = [];

  for (const pattern of [AT_RULE, URL, COMPOSES]) {
    for (const match of contents.matchAll(pattern)) {
      const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (value === '' || isExternal(value)) continue;
      specifiers.push({ value, kind: 'asset' });
    }
  }

  return { specifiers };
}

/** `@import "x"`, `@import url("x")`, `@use "x"`, `@forward "x"`. */
const AT_RULE = /@(?:import|use|forward)\s+(?:url\(\s*)?(?:'([^']*)'|"([^"]*)")/g;

/** `url(x)` unquoted, and the quoted forms `url('x')` / `url("x")`. */
const URL = /\burl\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"]+))\s*\)/g;

/** CSS Modules: `composes: name from './other.css'`. */
const COMPOSES = /\bcomposes\s*:[^;]*?\bfrom\s+(?:'([^']*)'|"([^"]*)")/g;

/**
 * Literal `require` calls, and whether any call was not one.
 *
 * The module record cannot see `require`, so this is a text scan, and it is
 * written as a *count* comparison rather than as a parse: every `require(` is
 * counted, then every `require('literal')`, and a difference means at least one
 * call takes a value this cannot follow. The file is then unknown, which widens.
 *
 * Both failure modes of a text scan are safe here. A `require(` inside a comment
 * inflates the total and widens; a literal matched inside a string adds an edge
 * to a file that may not exist, and an edge to nothing reaches nothing.
 */
function readRequires(contents: string): Read {
  const calls = [...contents.matchAll(REQUIRE_CALL)].length;
  if (calls === 0) return { specifiers: [] };

  const literals = [...contents.matchAll(REQUIRE_LITERAL)];
  const specifiers = literals.map((match): Specifier => ({ value: match[1]!, kind: 'imports' }));

  return {
    specifiers,
    ...(literals.length < calls
      ? { unknown: `${calls - literals.length} \`require()\` call(s) with a specifier this cannot read` }
      : {}),
  };
}

const REQUIRE_CALL = /\brequire\s*\(/g;
const REQUIRE_LITERAL = /\brequire\s*\(\s*(?:'([^']*)'|"([^"]*)")\s*\)/g;

/** The contents of a quoted literal, or `undefined` when it was not one. */
function quoted(text: string): string | undefined {
  const trimmed = text.trim();
  const first = trimmed[0];
  if (trimmed.length < 2 || (first !== "'" && first !== '"')) return undefined;
  if (trimmed[trimmed.length - 1] !== first) return undefined;

  const value = trimmed.slice(1, -1);
  // A specifier that is a template with a hole is quoted and still not a
  // constant. `import(`./${name}`)` is exactly the shape that must widen.
  return value.includes('${') ? undefined : value;
}

/** A specifier no repository file can be behind. */
function isExternal(value: string): boolean {
  return (
    value.startsWith('data:') ||
    value.startsWith('http:') ||
    value.startsWith('https:') ||
    value.startsWith('//') ||
    value.startsWith('#')
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
