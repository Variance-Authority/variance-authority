/**
 * Whether text a diff added can have changed what already ran.
 *
 * Selection charges a changed line to the regions that hold it and answers with
 * the tests recorded against them. An insertion has no line of its own in the
 * text the index is coordinates in, so it is charged to the lines on either side
 * of the gap it opens — and at the top level of a module those are the module
 * itself, whose crossings are every test that ever imported the file. Adding a
 * function nobody calls yet therefore ran the module's whole audience.
 *
 * The added text says otherwise, and the diff carries it. A function
 * declaration, a type, an interface, an enum, a type-only import: each of them
 * binds a name and does nothing else when the module evaluates, and no code that
 * was already there reaches the new name, because no code that was already there
 * mentions it. Nothing recorded can have behaved differently, so the hunk
 * charges nobody.
 *
 * The narrowing it makes is one a test could see: a test that reads a module's
 * export list rather than calling anything in it does observe a new export, and
 * is not selected. It is the one shape this is wrong for, it is a shape almost
 * nobody writes, and the alternative is running every test that ever imported a
 * file each time somebody adds a function to it.
 *
 * What is deliberately not on the list. A class declaration runs its decorators,
 * its computed keys, its static initializers and the expression it extends. A
 * namespace holds statements. A `const` runs its initializer. Each of those is
 * module-level work, and work at module level is what every importer of the file
 * consumed.
 */

import { parseSync } from 'oxc-parser';

interface Node {
  readonly type: string;
  readonly declaration?: Node | null;
  readonly importKind?: string;
  readonly exportKind?: string;
}

const BINDINGS = new Set([
  'FunctionDeclaration',
  'TSDeclareFunction',
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'TSEnumDeclaration',
]);

/**
 * True when every top-level construct in `added` only binds a name.
 *
 * False for text that cannot be parsed on its own, which is most of what an
 * insertion inside a function body looks like, and false for an empty statement
 * list that came from text with something in it. Comments and blank lines parse
 * to no statements and are inert; a fragment that parses to no statements
 * because the parser gave up is not, and is separated by the error list.
 */
export function bindsOnly(added: string): boolean {
  if (added.trim() === '') return true;
  const parsed = parseSync('added.tsx', added);
  if (parsed.errors.length > 0) return false;
  return (parsed.program.body as readonly Node[]).every(binding);
}

function binding(node: Node): boolean {
  if (BINDINGS.has(node.type)) return true;
  if (node.type === 'ImportDeclaration') return node.importKind === 'type';
  if (node.type === 'ExportAllDeclaration') return node.exportKind === 'type';
  if (node.type === 'ExportNamedDeclaration') {
    return node.exportKind === 'type' ||
      (node.declaration === null || node.declaration === undefined
        ? true
        : binding(node.declaration));
  }
  if (node.type === 'ExportDefaultDeclaration') {
    return node.declaration !== null && node.declaration !== undefined &&
      binding(node.declaration);
  }
  return false;
}
