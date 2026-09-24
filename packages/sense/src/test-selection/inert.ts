/**
 * Whether text a diff added can have changed what already ran.
 *
 * Selection charges a changed line to the regions that hold it and answers with
 * the tests recorded against them. An insertion has no line of its own in the
 * text the index is coordinates in, so it is charged to the lines on either side
 * of the gap it opens — and at the top level of a module those are the module
 * itself, whose crossings are every test that ever imported the file. Adding a
 * type nobody names yet therefore ran the module's whole audience.
 *
 * The added text says otherwise, and the diff carries it. A type, an interface,
 * a signature without a body, a type-only import: each of them is erased before
 * the module runs, so the text that was already there is the whole of what ran,
 * and it ran over a name the runtime never had. Nothing recorded can have
 * behaved differently, so the hunk charges nobody.
 *
 * Erased is the test, not *binds a name*. A binding that survives to runtime is
 * one the code around it can reach without naming it in the hunk: a name is
 * declared where the text lands, and what that name held there before is the
 * rest of the file's answer, not the hunk's.
 *
 * The narrowing it makes is one a test could see: a test that reads a module's
 * export list rather than calling anything in it does observe a name newly
 * exported from one it already held, and is not selected. It is the one shape
 * this is wrong for, it is a shape almost nobody writes, and the alternative is
 * running every test that ever imported a file each time somebody exports a
 * name it already declared.
 *
 * This is sound only because the caller establishes the frame first. Every hunk
 * here is read at line numbers, and line numbers are a place in one particular
 * text; a module whose recorded text is not the text the diff is written against
 * never reaches this function, because `select.ts` charges it whole before
 * asking whether anything it added was inert. Without that order this filter is
 * the thing that hides the disagreement — a moved frame shows up as hunks in
 * places nothing entered, and a filter that drops the harmless-looking ones
 * turns a wrong answer into an empty one.
 *
 * What is deliberately not on the list. A function declaration hoists: it binds
 * its name at the top of the block the text landed in, over whatever that name
 * held there, and the lines above it are the ones the hunk did not touch. A
 * `format` declared inside a branch answers the `return format(v)` written
 * above it, which until the insertion read the `format` at the top of the file
 * — the recorded line, in the recorded region, returning something else. A name
 * may legally be declared twice in a block, and in a script at the top level,
 * so nothing makes this loud either.
 *
 * The rest of the list is module-level work, and work at module level is what
 * every importer of the file consumed. A class declaration runs its decorators,
 * its computed keys, its static initializers and the expression it extends. A
 * namespace holds statements. A `const` runs its initializer. An enum that is
 * not erased is emitted as a function that runs and merges into whatever object
 * its name already holds.
 */

import { parseSync } from 'oxc-parser';

interface Node {
  readonly type: string;
  readonly declaration?: Node | null;
  readonly importKind?: string;
  readonly exportKind?: string;
  readonly source?: unknown;
  readonly specifiers?: readonly { readonly exportKind?: string }[];
  readonly const?: boolean;
  readonly declare?: boolean;
}

// Erased by the compiler, every one of them: a signature with no body —
// `declare function`, and an overload above the implementation — an interface,
// a type alias. `FunctionDeclaration` is not here, and the module comment says
// why.
const ERASED = new Set([
  'TSDeclareFunction',
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
]);

/**
 * True when `added` is at least one top-level construct and every one of them
 * is text the module never runs.
 *
 * False for text that cannot be parsed on its own, which is most of what an
 * insertion inside a function body looks like.
 *
 * False as well for text that parses to no construct at all — a blank line, a
 * comment. Whitespace is evidence of nothing: the same bytes at the same line
 * number are a comment between two statements, a line of the CSS a styled
 * component renders out of a template literal, and a line of the copy a JSX
 * text node paints; a diff carries no coordinate finer than the line, and
 * nothing here can tell those apart.
 *
 * A construct is *some* evidence the gap the diff opened is code, and that is
 * the whole of what is claimed here. It is not proof of statement position: a
 * diff hands this function bytes and no frame, and text inside a template
 * literal is read exactly like text between two statements. Some of it parses.
 * `interface Node { id: ID }` is a line of GraphQL and reads inert; so does
 * `type Query = { a: 1 }`. Where the literal is what the module ships, that
 * hunk charges nobody and should have charged the region the literal sits in.
 * That is the residual hole in this filter. Closing it needs the file's own
 * text, to say whether the line the diff landed on is inside a literal, and the
 * added text by itself never carries that.
 *
 * So a hunk that added only comments or only blank lines charges the regions
 * around it, and a repository that reflows its comments pays the module's
 * audience for it. That is the price of not skipping every subject of a
 * component over a line added inside the stylesheet it renders from.
 */
export function bindsOnly(added: string): boolean {
  const parsed = parseSync('added.tsx', added);
  if (parsed.errors.length > 0) return false;
  const body = parsed.program.body as readonly Node[];
  return body.length > 0 && body.every(erased);
}

/** True for a statement the compiler removes before the module runs. */
function erased(node: Node): boolean {
  if (ERASED.has(node.type)) return true;
  // `declare const`, `declare class`, `declare module`: ambient, and emitted as
  // nothing.
  if (node.declare === true) return true;
  // A `const` or `declare` enum is erased: the module never evaluates it. Any
  // other enum is emitted as `(function (E) { ... })(E || (E = {}))`, which
  // runs when the module does and writes its members into whatever object the
  // name already holds. Declaration merging is what makes that reach backwards:
  // a second block of the same name mutates the object the first one bound, so
  // code that was already there and never moved reads a different value. The
  // member initializers do not decide this — the emitted function running at
  // all does — and the added text cannot say whether the name is new, because
  // the rest of the file is not in the hunk.
  if (node.type === 'TSEnumDeclaration') return node.const === true;
  if (node.type === 'ImportDeclaration') return node.importKind === 'type';
  if (node.type === 'ExportAllDeclaration') return node.exportKind === 'type';
  if (node.type === 'ExportNamedDeclaration') {
    if (node.exportKind === 'type') return true;
    // `export { x } from './y.js'` wears the same shape as `export { x }` —
    // null declaration, value kind — but it is an import edge, and the module
    // it names is evaluated the moment this one is. It stays evaluated with
    // the clause empty, and with every specifier marked `type`: one compiler
    // option keeps the clause and another drops it, and the diff does not say
    // which. Only `export type { x } from` is erased under either.
    if (node.source !== null && node.source !== undefined) return false;
    return node.declaration === null || node.declaration === undefined
      ? true
      : erased(node.declaration);
  }
  if (node.type === 'ExportDefaultDeclaration') {
    return node.declaration !== null && node.declaration !== undefined &&
      erased(node.declaration);
  }
  return false;
}
