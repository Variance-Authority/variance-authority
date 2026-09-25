/**
 * One file's outgoing requests and published names, without resolving anything.
 *
 * The {@link Read} every language reader fills, and the module reader `oxc`
 * backs. The boundary between "this file says it depends on `./x`" and "`./x` is
 * that file over there" is deliberate: resolution needs a disk and a resolution
 * algorithm, and this needs neither, so every rule about what counts as an edge
 * is assertable against a string. The other readers sit beside this one —
 * [`style.ts`](./style.ts), [`python.ts`](./python.ts), [`rust.ts`](./rust.ts),
 * [`jvm.ts`](./jvm.ts), [`swift.ts`](./swift.ts) — and everything below the
 * headings here is about the module one.
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
 * `.module` is the ES module record the parser computed while it parsed — every
 * static import, every re-export, every `import()`, with the imported, local and
 * exported name of each binding. The tree is walked only for what the record
 * does not hold: top-level declarations, and the mocks a test writes.
 *
 * Everything returned is a string or a small object copied out, so the parse
 * result is garbage once its file is read: a scan holds findings, not trees.
 *
 * ## What this cannot read
 *
 * A missed edge is not a smaller answer; it is a **wrong** one. A file whose
 * imports this cannot enumerate may import the file that just changed, and
 * "I found no imports" spelled as "it imports nothing" hides that.
 *
 * So this refuses to guess, and says so instead. `unknown` is set, with its
 * reason, when:
 *
 * | shape | why |
 * |---|---|
 * | the parser reported an error | the record may be truncated at the error |
 * | `import(x)` where `x` is not a literal | the target is a runtime value |
 * | a `require(…)` this could not read as a literal | same, and invisible to the module record |
 *
 * The reason is recorded for whoever reports on the scan, and nothing is widened
 * for it: the edges this did read stay edges, and the one it could not is left
 * to the recorded run, which sees the module load whatever expression named it.
 * A graph that stood in for the missing edge by depending on everything would
 * put one `require(name)` in front of every question the repository asks.
 *
 * A literal `require('./x')` is *not* in that table: it is read and becomes an
 * edge, which is what keeps a CommonJS corner of a repository in the graph.
 *
 * `export * from './x'` is not in that table either, and the distinction is the
 * point. The *edge* is known — it is `./x`, right there. What is unknown is this
 * file's export set, which is a fact about names and is carried as one: an
 * `Export` with no `exported`. Treating it as an unknown edge list would report
 * every barrel in the repository as unreadable over an edge it states, and
 * barrels are most of them.
 */

import type { EdgeKind } from '@variance-authority/core/relate';
import { native, nativeRefusal } from './addon.js';
import type { SourceSymbol, TextSpan } from './harvest.js';
import type { ImportDiff } from './taint/index.js';

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
   * What the statement declares, never a sum of its bindings: `type` only for
   * `import type` and `export type`, and for a re-export only when every
   * statement writing it says so. Each binding keeps its own typeness.
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

  /**
   * Whether the reader derived this specifier rather than read it.
   *
   * Python is the language that needs it: `from a.b import c` names three
   * modules that might exist — `a`, `a.b`, and `a.b.c` if `c` is a submodule
   * rather than a name `a/b/__init__.py` defines — and nothing in the statement
   * says which. Emitting only what is written misses a tenth of the first-party
   * edges in a real repository ([`python.ts`](./python.ts) records the count),
   * so the rest are derived and marked.
   *
   * A guess that resolves is an ordinary edge. A guess that does not is
   * **silence**: not an unresolved specifier, not a hole, not an `unknown`.
   * That is the whole point of the flag — {@link Read.unknown} exists because a
   * specifier nobody could follow means a surface nobody looked at, and a guess
   * nobody could follow means only that the reader guessed, which is not a
   * surface at all. Setting it on anything a file actually wrote would turn a
   * real hole into a silent one, which is the failure this package refuses.
   */
  readonly guessed?: boolean;
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
  /** The complete export statement, for a name declared outside this workspace. */
  readonly signature?: TextSpan;
  /** The doc block attached to that export statement. */
  readonly doc?: TextSpan;
}

export interface Read {
  readonly requests: readonly Request[];

  /** Every name this file publishes. Absent when it publishes nothing. */
  readonly exports?: readonly Export[];

  /** Top-level declarations reduced while the AST is already resident. */
  readonly symbols?: readonly SourceSymbol[];

  /** What the file mocks and loads for real, read off the same tree. Recorded, never applied. */
  readonly mocks?: ImportDiff;

  /** Why this file's requests are not the whole set, when they are not. */
  readonly unknown?: string;
}

/** Extensions the module reader claims. Everything else is somebody else's. */
export const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * 1-based line numbers from offsets, over one file's text.
 *
 * Built once per file and searched, rather than counted per request: a barrel
 * makes hundreds of requests and counting newlines for each one is quadratic on
 * exactly the largest files. The same structure, for the same reason, is behind
 * [`package/doc.ts`](../../package/src/doc.ts).
 */
export function linesOf(contents: string): (offset: number) => number {
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

/**
 * One module's requests, published names, symbols and mocks, read by the native
 * addon (`native/src/read.rs`) from text the caller already holds. There is one
 * module reader and it is the native one, so a machine the addon did not reach
 * cannot read a module and says why rather than reading it some other way.
 */
export function readModule(file: string, contents: string): Read {
  const addon = native();
  if (addon === undefined) {
    throw new Error(`sense: reading ${file} needs the native addon, which did not load: ${nativeRefusal()}`);
  }
  return JSON.parse(addon.readSource(file, contents)) as Read;
}

/**
 * A stylesheet value no repository file can be behind. `url(#gradient)` is a
 * fragment; a module's `#polyfill` is a subpath import ([`requestOf`](./specifier.ts)).
 */
export function isExternal(value: string): boolean {
  return ['data:', 'http:', 'https:', '//', '#'].some((prefix) => value.startsWith(prefix));
}
