import type {
  BindingPattern,
  Comment,
  Declaration,
  ExportDefaultDeclarationKind,
  Program,
  Statement,
  VariableDeclarator,
} from 'oxc-parser';

/** A source span in the UTF-16 offsets JavaScript strings use. */
export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

export type SourceSymbolKind =
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
  | 'object';

/** One top-level declaration, reduced while the parser still holds its AST. */
export interface SourceSymbol {
  readonly name: string;
  readonly kind: SourceSymbolKind;
  readonly line: number;
  readonly signature?: TextSpan;
  readonly doc?: TextSpan;
}

const KINDS: Readonly<Record<string, SourceSymbolKind>> = {
  FunctionDeclaration: 'function',
  ClassDeclaration: 'class',
  TSInterfaceDeclaration: 'interface',
  TSTypeAliasDeclaration: 'type',
  TSEnumDeclaration: 'enum',
  TSModuleDeclaration: 'namespace',
};

function linesOf(contents: string): (offset: number) => number {
  const starts: number[] = [0];
  for (let at = contents.indexOf('\n'); at !== -1; at = contents.indexOf('\n', at + 1)) starts.push(at + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((starts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}

export function harvestDocs(contents: string, comments: readonly Comment[]): ReadonlyMap<number, TextSpan> {
  const docs = new Map<number, TextSpan>();
  for (const comment of comments) {
    if (comment.type !== 'Block' || contents.charAt(comment.start + 2) !== '*') continue;
    let subject = comment.end;
    while (subject < contents.length && /\s/.test(contents.charAt(subject))) subject += 1;
    docs.set(subject, { start: comment.start + 2, end: comment.end - 2 });
  }
  return docs;
}

function headEnd(node: { readonly end: number; readonly body?: { readonly start: number } | null }): number {
  return node.body?.start ?? node.end;
}

function declaratorEnd(declarator: VariableDeclarator): number {
  const init = declarator.init;
  if (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression') return init.body?.start ?? init.end;
  return declarator.id.end;
}

function bindings(pattern: BindingPattern, found: string[]): void {
  switch (pattern.type) {
    case 'Identifier':
      found.push(pattern.name);
      return;
    case 'ObjectPattern':
      for (const property of pattern.properties) bindings(property.type === 'RestElement' ? property.argument : property.value, found);
      return;
    case 'ArrayPattern':
      for (const element of pattern.elements) if (element !== null) bindings(element.type === 'RestElement' ? element.argument : element, found);
      return;
    case 'AssignmentPattern':
      bindings(pattern.left, found);
  }
}

function push(
  into: SourceSymbol[],
  name: string,
  kind: SourceSymbolKind,
  line: number,
  doc: TextSpan | undefined,
  signature: TextSpan | undefined,
): void {
  into.push({ name, kind, line, ...(signature === undefined ? {} : { signature }), ...(doc === undefined ? {} : { doc }) });
}

function record(node: Declaration, into: SourceSymbol[], line: number, doc: TextSpan | undefined): void {
  if (node.type === 'VariableDeclaration') {
    for (const declarator of node.declarations) {
      const names: string[] = [];
      bindings(declarator.id, names);
      const signature = { start: node.start, end: declaratorEnd(declarator) };
      for (const name of names) push(into, name, node.kind, line, doc, signature);
    }
    return;
  }

  const kind = KINDS[node.type];
  if (kind === undefined || !('id' in node) || node.id?.type !== 'Identifier') return;
  push(into, node.id.name, kind, line, doc, { start: node.start, end: headEnd(node) });
}

function recordDefault(
  node: ExportDefaultDeclarationKind,
  into: SourceSymbol[],
  line: number,
  doc: TextSpan | undefined,
): void {
  const kind = KINDS[node.type];
  if (kind !== undefined) {
    const signature = { start: node.start, end: headEnd(node) };
    push(into, 'default', kind, line, doc, signature);
    if ('id' in node && node.id?.type === 'Identifier') push(into, node.id.name, kind, line, doc, signature);
    return;
  }
  if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
    push(into, 'default', 'function', line, doc, { start: node.start, end: node.body?.start ?? node.end });
  } else if (node.type === 'ClassExpression') {
    push(into, 'default', 'class', line, doc, { start: node.start, end: node.body.start });
  } else if (node.type === 'ObjectExpression' || node.type === 'ArrayExpression') {
    push(into, 'default', 'object', line, doc, undefined);
  } else if (node.type !== 'Identifier') {
    push(into, 'default', 'const', line, doc, undefined);
  }
}

/** Extract declaration facts without retaining the AST that produced them. */
export function harvestSymbols(
  program: Program,
  contents: string,
  docs: ReadonlyMap<number, TextSpan>,
): readonly SourceSymbol[] {
  const lineAt = linesOf(contents);
  const symbols: SourceSymbol[] = [];

  for (const statement of program.body as readonly Statement[]) {
    const line = lineAt(statement.start);
    const doc = docs.get(statement.start);
    if (statement.type === 'ExportDefaultDeclaration') recordDefault(statement.declaration, symbols, line, doc);
    else if (statement.type === 'ExportNamedDeclaration' && statement.declaration !== null) {
      record(statement.declaration, symbols, line, doc);
    } else if (statement.type !== 'ExportNamedDeclaration' && statement.type !== 'ExportAllDeclaration') {
      record(statement as Declaration, symbols, line, doc);
    }
  }
  return symbols;
}
