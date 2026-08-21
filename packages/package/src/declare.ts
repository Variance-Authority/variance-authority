import { readFileSync } from 'node:fs';
import type { BindingPattern, ExportDefaultDeclarationKind, ParseResult, Statement } from 'oxc-parser';
import { parseSync } from 'oxc-parser';

/**
 * What a file declares, said in one word per name.
 *
 * The vocabulary is deliberately coarse. The question a published surface
 * answers is *is `digestValue` still a function, still exported, still reachable
 * from `.`* — and the answer to that is a word. What a signature looks like
 * below the name is the compiler's subject, and it is named as a limitation in
 * this package's README rather than half-answered here.
 */

export type DeclarationKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'namespace'
  | 'var'
  | 'let'
  | 'const'
  | 'using'
  | 'await using'
  | 'object'
  | 'namespace-object'
  | 'foreign';

/**
 * A top-level declaration, said in one word.
 *
 * Total over the forms TypeScript has, and fatal outside them. A form nobody
 * mapped is a real thing somebody publishes, and the worst possible response is
 * a surface that omits it without saying so.
 */
const KINDS: Readonly<Record<string, DeclarationKind>> = {
  FunctionDeclaration: 'function',
  ClassDeclaration: 'class',
  TSInterfaceDeclaration: 'interface',
  TSTypeAliasDeclaration: 'type',
  TSEnumDeclaration: 'enum',
  TSModuleDeclaration: 'namespace',
};

/**
 * What a default export is, when it is an expression rather than a declaration.
 *
 * `export default function f() {}` is a declaration and `KINDS` answers it.
 * `export default {…}` — a Worker's `{ fetch }`, a config object — is not, and
 * an object is what that entrypoint publishes.
 */
const EXPRESSIONS: Readonly<Record<string, DeclarationKind>> = {
  ObjectExpression: 'object',
  ArrayExpression: 'object',
  FunctionExpression: 'function',
  ArrowFunctionExpression: 'function',
  ClassExpression: 'class',
};

/** Files already parsed, held for the length of one read. */
export type Parses = Map<string, ParseResult>;

export function parseFile(parses: Parses, file: string, at: string): ParseResult {
  const held = parses.get(file);
  if (held !== undefined) return held;

  const parsed = parseSync(file, readFileSync(file, 'utf8'));
  const failure = parsed.errors[0];
  if (failure !== undefined) throw new Error(`${at} does not parse: ${failure.message}`);

  parses.set(file, parsed);
  return parsed;
}

/** Every name a declarator introduces, destructuring included. */
function bindings(pattern: BindingPattern, into: Map<string, DeclarationKind>, kind: DeclarationKind): void {
  switch (pattern.type) {
    case 'Identifier':
      into.set(pattern.name, kind);
      return;
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        bindings(property.type === 'RestElement' ? property.argument : property.value, into, kind);
      }
      return;
    case 'ArrayPattern':
      for (const element of pattern.elements) {
        if (element === null) continue;
        bindings(element.type === 'RestElement' ? element.argument : element, into, kind);
      }
      return;
    case 'AssignmentPattern':
      bindings(pattern.left, into, kind);
  }
}

function kindOfDefault(declaration: ExportDefaultDeclarationKind, at: string): DeclarationKind {
  const kind = KINDS[declaration.type] ?? EXPRESSIONS[declaration.type];
  if (kind === undefined) {
    throw new Error(`${at} default-exports a \`${declaration.type}\`, which nothing here names`);
  }
  return kind;
}

function record(node: Statement, into: Map<string, DeclarationKind>): void {
  if (node.type === 'VariableDeclaration') {
    for (const declarator of node.declarations) bindings(declarator.id, into, node.kind);
    return;
  }

  const kind = KINDS[node.type];
  if (kind === undefined) return;

  // `declare module 'x'` names itself with a string literal and an anonymous
  // `export default class {}` names itself not at all. Neither introduces a
  // top-level binding, so neither belongs in a map of what this file declares.
  const id = 'id' in node ? node.id : null;
  if (id !== null && id !== undefined && id.type === 'Identifier') into.set(id.name, kind);
}

/**
 * Every locally declared name in a file, to what kind of declaration it is.
 *
 * Top level only. A name a module publishes is either declared at its top level
 * or arrives from somewhere else, and the somewhere else is a re-export to
 * follow rather than a scope to search.
 */
export function declarationsIn(parsed: ParseResult, at: string): Map<string, DeclarationKind> {
  const kinds = new Map<string, DeclarationKind>();

  for (const node of parsed.program.body) {
    if (node.type === 'ExportDefaultDeclaration') {
      kinds.set('default', kindOfDefault(node.declaration, at));
    } else if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration !== null) record(node.declaration, kinds);
    } else {
      record(node, kinds);
    }
  }

  return kinds;
}
