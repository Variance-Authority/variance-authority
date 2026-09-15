/**
 * One file's outgoing requests and published names, without resolving anything.
 *
 * Two readers — a module reader and a stylesheet reader — and the boundary
 * between "this file says it depends on `./x`" and "`./x` is that file over
 * there" is deliberate: resolution needs a disk and a resolution algorithm, and
 * this needs neither, so every rule about what counts as an edge is assertable
 * against a string.
 *
 * ## A request is not a name
 *
 * `import { Card, type Props } from './ui'` is **one** request and **two**
 * bindings, and collapsing them loses two different things. Reduced to a single
 * edge, `Props` stops being type-only — the whole statement is type-only or none
 * of it is — and `Card` stops being a name at all, so nothing downstream can ask
 * which file declares it. Reduced the other way, to one edge per name, a barrel
 * republishing fifty exports becomes fifty edges to the same file.
 *
 * So a request carries the specifier **as written** and the bindings hang off
 * it. The specifier survives resolution on purpose: a bare one that resolves to
 * nothing is the package this file depends on, and that question has no answer
 * once the string has been thrown away for a file id.
 *
 * ## Why the module record and not the tree
 *
 * `oxc-parser` returns a lazily-deserialized result. The full AST is available
 * behind `.program` and is the expensive half; `.module` is the ES module record
 * the parser has already computed — every static import, every re-export, every
 * `import()`, with the imported, local and exported name of each binding — and
 * touching it never materializes a node. A change-management scan wants exactly
 * that record and nothing else, so it pays for a parse and not for a tree.
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
 *
 * `export * from './x'` is not in that table either, and the distinction is the
 * point. The *edge* is known — it is `./x`, right there. What is unknown is this
 * file's export set, which is a fact about names and is carried as one: an
 * `Export` with no `exported`. Treating it as an unknown edge list would widen
 * every barrel in the repository to depend on everything, which is most of them.
 */

import { parseSync } from 'oxc-parser';
import type { EdgeKind } from '@variance-authority/core/relate';

/**
 * The imported name of a default import, and the exported name of a default
 * export. Not a legal identifier, so it cannot collide with a written one.
 */
export const DEFAULT_NAME = 'default';

/** The imported name of a namespace object — `import * as ns`, `export * as ns`. */
export const NAMESPACE_NAME = '*';

export interface Binding {
  /**
   * The name under which the module this came from publishes it.
   *
   * `DEFAULT_NAME` for a default import and `NAMESPACE_NAME` for a namespace
   * object, so every binding has a name and none of them is a written one.
   */
  readonly imported: string;

  /** The name bound in this file. Differs from `imported` only for an alias. */
  readonly local: string;

  /** `import type { x }` and `import { type x }` alike. */
  readonly type: boolean;

  /**
   * The 1-based line the statement binding it is written on.
   *
   * Per binding rather than only per request, because a barrel republishing
   * fifty names across five statements is one request by design, and a reader
   * sent to open the file needs the statement that names the one it asked about.
   */
  readonly line: number;
}

export interface Request {
  /** As written. Unresolved — `./x`, `@scope/pkg`, `../theme.css`. */
  readonly value: string;

  /**
   * What the whole request is, for the file-level edge.
   *
   * A summary of the bindings rather than a replacement for them: `type` when
   * every name it brings in is type-only, and the per-binding truth is still
   * in `bindings` for anything that needs to disagree.
   */
  readonly kind: EdgeKind;

  /**
   * What this request binds, one entry per name.
   *
   * Empty is a real answer with three causes: `import './x'` is a side effect
   * and binds nothing, `export * from './x'` republishes a set this file never
   * names, and a dynamic `import('./x')` binds nothing the module record sees.
   */
  readonly bindings: readonly Binding[];

  /**
   * The 1-based line this request is first written on.
   *
   * A summary of the bindings in the same way `kind` is, and for the same
   * reason: one request can be written across several statements, and the
   * per-binding truth stays in `bindings` for anything that needs to disagree.
   */
  readonly line: number;
}

export interface Export {
  /**
   * The name this file publishes.
   *
   * Absent for `export * from './x'`, where the set is whatever the other file
   * publishes and is not knowable from these bytes. Absent is not empty: a
   * consumer asking whether this file exports `Card` must follow `from` rather
   * than answer no.
   */
  readonly exported?: string;

  /** The local declaration behind it, when this file declares it. */
  readonly local?: string;

  /** The specifier it was republished from, when it was republished. */
  readonly from?: string;

  /** The name under which that module publishes it. */
  readonly imported?: string;

  /** `export type { x }`, `export { type x }`, `export type * from './x'`. */
  readonly type: boolean;

  /**
   * The 1-based line the statement publishing it is written on.
   *
   * Carried for the same reason a binding's is: a reader that has been told a
   * name exists needs somewhere to open, and this is the only line anything
   * records for a name no manifest publishes. It is the export statement, which
   * for `export { x }` at the foot of a file is not where `x` is declared —
   * whoever needs the declaration has the file and can ask for it.
   */
  readonly line: number;
}

export interface Read {
  readonly requests: readonly Request[];

  /** Every name this file publishes. Absent when it publishes nothing. */
  readonly exports?: readonly Export[];

  /** Why this file's requests are not the whole set, when they are not. */
  readonly unknown?: string;
}

/** Extensions the module reader claims. Everything else is somebody else's. */
export const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** Extensions the stylesheet reader claims. */
export const STYLE_EXTENSIONS = ['.css', '.scss', '.sass', '.less'];

/**
 * Static imports, re-exports, published names and literal dynamic imports.
 *
 * A type-only import is kept as its own kind rather than dropped. It cannot move
 * a pixel — every compiler erases it — and dropping it here would decide that for
 * every consumer, including the ones asking what a file rests on rather than what
 * a change could repaint.
 */
/**
 * 1-based line numbers from offsets, over one file's text.
 *
 * Built once per file and searched, rather than counted per request: a barrel
 * makes hundreds of requests and counting newlines for each one is quadratic on
 * exactly the largest files. The same structure, for the same reason, is behind
 * [`package/doc.ts`](../../package/src/doc.ts).
 */
function linesOf(contents: string): (offset: number) => number {
  const starts: number[] = [0];
  for (let at = contents.indexOf('\n'); at !== -1; at = contents.indexOf('\n', at + 1)) starts.push(at + 1);

  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((starts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

export function readModule(file: string, contents: string): Read {
  let result;
  try {
    result = parseSync(file, contents);
  } catch (error) {
    // Unnamed on purpose. What comes back from here is cached against the bytes
    // and their dialect, so a message carrying a path would be handed to every
    // other file holding the same content. The caller names the file it asked
    // about ([`scan.ts`](./scan.ts)).
    return { requests: [], unknown: `could not be parsed: ${messageOf(error)}` };
  }

  const requests: Request[] = [];
  const published: Export[] = [];
  const record = result.module;
  const lineAt = linesOf(contents);

  for (const entry of record.staticImports) {
    const line = lineAt(entry.start);
    const bindings = entry.entries.map(
      (binding): Binding => ({
        imported: importedName(binding.importName),
        local: binding.localName.value,
        type: binding.isType,
        line,
      }),
    );

    // No entries at all is `import './x'` — a side effect, which is the shape a
    // stylesheet arrives in and never a type import.
    const type = bindings.length > 0 && bindings.every((binding) => binding.type);
    requests.push({ value: entry.moduleRequest.value, kind: type ? 'type' : 'imports', bindings, line });
  }

  // `export { a, b } from './x'` arrives as two entries naming one specifier.
  // Grouping keeps it one request, so a barrel republishing fifty names is one
  // edge rather than fifty, and the type-only rule is decided over the whole
  // request the way an import's is. The group carries its own `type` because
  // `export type * from './x'` is type-only while binding no names at all.
  const republished = new Map<string, { bindings: Binding[]; type: boolean; line: number }>();

  for (const entry of record.staticExports) {
    const line = lineAt(entry.start);
    for (const binding of entry.entries) {
      const from = binding.moduleRequest?.value;
      const exported = publishedName(binding.exportName);
      const imported = sourceName(binding.importName);
      const local = localName(binding.localName);

      published.push({
        ...(exported === undefined ? {} : { exported }),
        ...(local === undefined ? {} : { local }),
        ...(from === undefined ? {} : { from }),
        ...(imported === undefined ? {} : { imported }),
        type: binding.isType,
        line,
      });

      if (from === undefined) continue;

      // The request's own line is the first statement that wrote it. Statements
      // arrive in source order, so the first one seen is the earliest.
      const group = republished.get(from) ?? { bindings: [], type: true, line };
      if (!binding.isType) group.type = false;
      // `export * from './x'` names nothing here, and a binding invented for it
      // would claim a name this file never wrote.
      if (exported !== undefined && imported !== undefined) {
        group.bindings.push({ imported, local: exported, type: binding.isType, line });
      }
      republished.set(from, group);
    }
  }

  for (const [value, group] of republished) {
    requests.push({ value, kind: group.type ? 'type' : 'reexports', bindings: group.bindings, line: group.line });
  }

  const reasons: string[] = [];

  for (const entry of record.dynamicImports) {
    const literal = quoted(contents.slice(entry.moduleRequest.start, entry.moduleRequest.end));
    if (literal === undefined) {
      reasons.push('an `import()` whose specifier is not a literal');
      continue;
    }
    // What a dynamic import binds is a property access on a promise, which is a
    // question for the tree rather than the module record.
    requests.push({ value: literal, kind: 'dynamic', bindings: [], line: lineAt(entry.start) });
  }

  const required = readRequires(contents);
  requests.push(...required.requests);
  if (required.unknown !== undefined) reasons.push(required.unknown);

  // Errors are recoverable in `oxc` — a result always comes back — so the record
  // is a *partial* answer rather than an absent one, which is the case this
  // whole file exists to refuse to round down.
  if (result.errors.length > 0) {
    reasons.push(`${result.errors.length} parse error(s): ${result.errors[0]?.message ?? ''}`);
  }

  return {
    requests,
    ...(published.length > 0 ? { exports: published } : {}),
    ...(reasons.length > 0 ? { unknown: reasons.join('; ') } : {}),
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
 *
 * What a `require` binds is a destructuring on the left of an `=`, which the
 * module record never saw and this does not parse for, so the request binds no
 * names rather than guessed ones.
 */
function readRequires(contents: string): Read {
  const calls = [...contents.matchAll(REQUIRE_CALL)].length;
  if (calls === 0) return { requests: [] };

  const lineAt = linesOf(contents);
  const literals = [...contents.matchAll(REQUIRE_LITERAL)];
  const requests = literals.map(
    (match): Request => ({
      value: match[1] ?? match[2]!,
      kind: 'imports',
      bindings: [],
      line: lineAt(match.index),
    }),
  );

  return {
    requests,
    ...(literals.length < calls
      ? { unknown: `${calls - literals.length} \`require()\` call(s) with a specifier this cannot read` }
      : {}),
  };
}

const REQUIRE_CALL = /\brequire\s*\(/g;
const REQUIRE_LITERAL = /\brequire\s*\(\s*(?:'([^']*)'|"([^"]*)")\s*\)/g;

/**
 * The name an import binding refers to in the module it came from.
 *
 * Taken structurally rather than through `oxc`'s `const enum`, which cannot be
 * imported as a value under this build's module settings. The kinds are strings.
 */
function importedName(name: Named): string {
  if (name.kind === 'Default') return DEFAULT_NAME;
  if (name.kind === 'NamespaceObject') return NAMESPACE_NAME;

  return name.name ?? DEFAULT_NAME;
}

/** The name a file publishes under, or `undefined` for `export * from './x'`. */
function publishedName(name: Named): string | undefined {
  if (name.kind === 'Default') return DEFAULT_NAME;
  if (name.kind === 'None') return undefined;

  return name.name ?? undefined;
}

/** The name the source module publishes it under, when there is a source. */
function sourceName(name: Named): string | undefined {
  if (name.kind === 'All' || name.kind === 'AllButDefault') return NAMESPACE_NAME;
  if (name.kind === 'None') return undefined;

  return name.name ?? undefined;
}

/**
 * The declaration behind an export, when the value is locally accessible.
 *
 * `export default function () {}` has no local name — there is nothing in the
 * module to refer to — and that is `undefined` rather than an invented one.
 */
function localName(name: Named): string | undefined {
  if (name.kind === 'Default') return DEFAULT_NAME;
  if (name.kind === 'None') return undefined;

  return name.name ?? undefined;
}

/** The shape every name in the module record shares. */
interface Named {
  readonly kind: string;
  readonly name: string | null;
}

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
