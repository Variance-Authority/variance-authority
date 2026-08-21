import { readFileSync } from 'node:fs';
import type {
  BindingPattern,
  ExportDefaultDeclarationKind,
  ParseResult,
  Statement,
  VariableDeclarator,
} from 'oxc-parser';
import { parseSync } from 'oxc-parser';
import { type Writing, headOf, lineAt, readWriting } from './doc.js';

/**
 * What a file declares, and what it says about each name.
 *
 * Three things per name, and they answer three different questions. The **kind**
 * is one word — *is `digestValue` still a function, still exported* — and it is
 * what a published surface is watched for. The **head** is the source text above
 * the body, which is what somebody needs in order to call the thing. The **doc**
 * is whatever was written above it, which is what somebody needs in order to
 * know whether they should.
 *
 * The kind vocabulary stays deliberately coarse, because the question it answers
 * is answerable in a word. The head is carried as text rather than as a resolved
 * type on purpose: resolving `Options` to its members is the compiler's subject
 * and needs a program, and what an adopter reads in the editor is the text
 * anyway.
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

/** One name, as the file that publishes it declares it. */
export interface Declaration {
  readonly kind: DeclarationKind;
  /** The file that declares it, relative to the workspace root. */
  readonly at: string;
  /** The 1-based line the statement begins on. */
  readonly line: number;
  /** Everything written before the body. Empty for nothing worth quoting. */
  readonly signature?: string;
  /** The block comment written above it, undented. Absent is the finding. */
  readonly doc?: string;
}

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

/** One file, parsed, held for the length of one read. */
export interface Source {
  /** The path, relative to the workspace root, that every name is reported at. */
  readonly at: string;
  readonly text: string;
  readonly parsed: ParseResult;
  readonly writing: Writing;
}

/** Files already parsed, held for the length of one read. */
export type Parses = Map<string, Source>;

export function parseFile(parses: Parses, file: string, at: string): Source {
  const held = parses.get(file);
  if (held !== undefined) return held;

  const text = readFileSync(file, 'utf8');
  const parsed = parseSync(file, text);
  const failure = parsed.errors[0];
  if (failure !== undefined) throw new Error(`${at} does not parse: ${failure.message}`);

  const source: Source = { at, text, parsed, writing: readWriting(text, parsed.comments) };
  parses.set(file, source);
  return source;
}

/** What the statement around a declaration contributes to every name in it. */
interface Around {
  readonly line: number;
  readonly doc: string | undefined;
}

/** Where a statement begins, and whatever was written above it. */
export function around(source: Source, start: number): Around {
  return { line: lineAt(source.writing, start), doc: source.writing.docs.get(start) };
}

/** One name, assembled from the statement it sits in and the head it was written with. */
export function declarationOf(
  source: Source,
  context: Around,
  kind: DeclarationKind,
  head: string,
): Declaration {
  return {
    kind,
    at: source.at,
    line: context.line,
    ...(head === '' ? {} : { signature: head }),
    ...(context.doc === undefined ? {} : { doc: context.doc }),
  };
}

/**
 * Where a declaration's head stops.
 *
 * At the body, when there is one — `function measure(): number` rather than the
 * forty lines under it. At the end of the declaration when there is not, which
 * is what a type alias and an ambient declaration both are: the whole of a
 * `type Span = readonly [number, number]` *is* its head.
 */
function headEnd(node: { readonly end: number }): number {
  const body = 'body' in node ? (node.body as { readonly start?: number } | null | undefined) : undefined;
  return typeof body?.start === 'number' ? body.start : node.end;
}

/**
 * Where a declarator's head stops.
 *
 * A `const` bound to a function is the shape somebody has to call, so the head
 * runs to that function's body and the reader gets `const make = (x: number):
 * string =>`. A `const` bound to anything else stops at the name and its type
 * annotation, because the value is an implementation detail that may be a
 * thousand-line literal.
 */
function declaratorEnd(declarator: VariableDeclarator): number {
  const init = declarator.init;
  if (init !== null && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')) {
    return init.body?.start ?? init.end;
  }
  return declarator.id.end;
}

/** Every name a declarator introduces, destructuring included. */
function bindings(pattern: BindingPattern, into: Map<string, Declaration>, declaration: Declaration): void {
  switch (pattern.type) {
    case 'Identifier':
      into.set(pattern.name, declaration);
      return;
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        bindings(property.type === 'RestElement' ? property.argument : property.value, into, declaration);
      }
      return;
    case 'ArrayPattern':
      for (const element of pattern.elements) {
        if (element === null) continue;
        bindings(element.type === 'RestElement' ? element.argument : element, into, declaration);
      }
      return;
    case 'AssignmentPattern':
      bindings(pattern.left, into, declaration);
  }
}

function kindOfDefault(declaration: ExportDefaultDeclarationKind, at: string): DeclarationKind {
  const kind = KINDS[declaration.type] ?? EXPRESSIONS[declaration.type];
  if (kind === undefined) {
    throw new Error(`${at} default-exports a \`${declaration.type}\`, which nothing here names`);
  }
  return kind;
}

function record(node: Statement, into: Map<string, Declaration>, source: Source, context: Around): void {
  if (node.type === 'VariableDeclaration') {
    for (const declarator of node.declarations) {
      const head = headOf(source.text, node.start, declaratorEnd(declarator));
      bindings(declarator.id, into, declarationOf(source, context, node.kind, head));
    }
    return;
  }

  const kind = KINDS[node.type];
  if (kind === undefined) return;

  // `declare module 'x'` names itself with a string literal and an anonymous
  // `export default class {}` names itself not at all. Neither introduces a
  // top-level binding, so neither belongs in a map of what this file declares.
  const id = 'id' in node ? node.id : null;
  if (id === null || id === undefined || id.type !== 'Identifier') return;

  into.set(id.name, declarationOf(source, context, kind, headOf(source.text, node.start, headEnd(node))));
}

/**
 * Every locally declared name in a file, to what the file says about it.
 *
 * Top level only. A name a module publishes is either declared at its top level
 * or arrives from somewhere else, and the somewhere else is a re-export to
 * follow rather than a scope to search.
 *
 * A doc block is read against the **statement**, not the declaration under it,
 * because `export` is where the comment sits. That also means the two names of
 * `export const { third, ...others } = …` share one doc, which is the truth: one
 * comment was written, above both of them.
 */
export function declarationsIn(source: Source): Map<string, Declaration> {
  const kinds = new Map<string, Declaration>();

  for (const node of source.parsed.program.body) {
    const context = around(source, node.start);

    if (node.type === 'ExportDefaultDeclaration') {
      const kind = kindOfDefault(node.declaration, source.at);
      // A default-exported object literal has no head to quote — the whole of it
      // is a value, and a config object is a hundred lines of one.
      const head = 'body' in node.declaration
        ? headOf(source.text, node.declaration.start, headEnd(node.declaration))
        : '';
      kinds.set('default', declarationOf(source, context, kind, head));
    } else if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration !== null) record(node.declaration, kinds, source, context);
    } else {
      record(node, kinds, source, context);
    }
  }

  return kinds;
}
