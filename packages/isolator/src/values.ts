/**
 * What a module's top level holds, names and reaches, read from its tree: the
 * questions the transform asks before it decides what moves into the frame.
 */

import { isNode, type Node } from './scope.js';

/** The object, array or instance a declarator's value literally is. */
export interface Held {
  readonly node: Node;
  /** An object or array literal, or a new `Map`, `Set`, `Array` or `Object`: what a session's copy can be made of. */
  readonly copyable: boolean;
}

/** A function or a class, under any `as`. */
export function callable(value: Node | null): boolean {
  const node = unwrap(value);
  return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression' || node?.type === 'ClassExpression';
}

/** A value no copy can tell from the one it was copied from. */
export function primitive(value: Node | null): boolean {
  const node = unwrap(value);
  return node === undefined || node.type === 'Literal' || (node.type === 'TemplateLiteral' && (node.expressions as Node[]).length === 0);
}

const COPYABLE = new Set(['Map', 'Set', 'Array', 'Object']);

/** The object, array or instance a declarator's value literally is, under any `as`. */
export function heldObject(declarator: Node): Held | undefined {
  if ((declarator.id as Node).type !== 'Identifier') return undefined;
  const init = unwrap(declarator.init);
  if (init?.type === 'ObjectExpression' || init?.type === 'ArrayExpression') return { node: init, copyable: true };
  if (init?.type !== 'NewExpression') return undefined;
  const callee = init.callee as Node;
  return { node: init, copyable: callee.type === 'Identifier' && COPYABLE.has(callee.name as string) };
}

/** Where, in a value, a name is that value or a part of it — what one session's copy of it copies along. */
export function flows(value: Node | null | undefined, into = new Set<number>()): Set<number> {
  const node = unwrap(value);
  if (node?.type === 'Identifier') into.add(node.start);
  else if (node?.type === 'SpreadElement') flows(node.argument as Node, into);
  else if (node?.type === 'ArrayExpression') for (const element of node.elements as (Node | null)[]) flows(element, into);
  else if (node?.type === 'ObjectExpression') {
    for (const property of node.properties as Node[]) flows((property.type === 'Property' ? property.value : property) as Node, into);
  }
  return into;
}

function unwrap(value: unknown): Node | undefined {
  let node = isNode(value) ? value : undefined;
  while (node !== undefined && /^(?:TSAsExpression|TSSatisfiesExpression|TSNonNullExpression|TSTypeAssertion|ParenthesizedExpression)$/.test(node.type)) {
    node = node.expression as Node;
  }
  return node;
}

/** Names `export { a, b as c }` exports from this module's own bindings. */
export function exportedNames(body: readonly Node[]): Set<string> {
  const names = new Set<string>();
  for (const statement of body) {
    if (statement.type !== 'ExportNamedDeclaration' || statement.source != null) continue;
    for (const specifier of statement.specifiers as Node[]) {
      const local = specifier.local as Node;
      if (local.type === 'Identifier') names.add(local.name as string);
    }
  }
  return names;
}

/** Module-level names a function or a class declares. */
export function functionNames(body: readonly Node[]): Set<string> {
  const names = new Set<string>();
  for (const statement of body) {
    const node = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
      ? (statement.declaration as Node | null)
      : statement;
    if ((node?.type === 'FunctionDeclaration' || node?.type === 'ClassDeclaration') && isNode(node.id)) names.add(node.id.name as string);
  }
  return names;
}

/** Names the module imports as values; a type it imports holds nothing at run time. */
export function importedNames(body: readonly Node[]): string[] {
  return body
    .filter((statement) => statement.type === 'ImportDeclaration' && statement.importKind !== 'type')
    .flatMap((statement) => (statement.specifiers as Node[]).filter((specifier) => specifier.importKind !== 'type'))
    .map((specifier) => (specifier.local as Node).name as string);
}

/**
 * Whether a node `test` accepts is in a value, inside its functions too only
 * when `deep`. Short of `deep`, a class is entered where it runs as it is
 * defined — what it extends, its decorators, computed keys, static fields and
 * static blocks — and not in its methods or instance fields.
 */
export function reaches(value: unknown, test: (node: Node) => boolean, deep: boolean): boolean {
  if (Array.isArray(value)) return value.some((item) => reaches(item, test, deep));
  if (!isNode(value)) return false;
  if (test(value)) return true;
  if (!deep && /^Class(?:Expression|Declaration)$/.test(value.type)) {
    return reaches([value.superClass, value.decorators], test, deep) || ((value.body as Node).body as Node[]).some((member) => definedWith(member, test));
  }
  if (!deep && /^(?:Function(?:Expression|Declaration)|ArrowFunctionExpression)$/.test(value.type)) return false;
  for (const key in value) if (key !== 'type' && reaches(value[key], test, deep)) return true;
  return false;
}

/** Whether a class member runs a node `test` accepts as its class is defined. */
function definedWith(member: Node, test: (node: Node) => boolean): boolean {
  if (member.type === 'StaticBlock') return reaches(member.body, test, false);
  if (reaches(member.decorators, test, false) || (member.computed === true && reaches(member.key, test, false))) return true;
  return member.static === true && member.type !== 'MethodDefinition' && reaches(member.value, test, false);
}

/**
 * Whether a top level, outside the functions and classes it declares, can write
 * into another module as it runs: a call, a `new`, a tag, or a write to a member
 * other than this module's own exports.
 */
export function reachesOut(body: readonly Node[]): boolean {
  const ownExports = (target: Node): boolean => {
    let object = target;
    while (object.type === 'MemberExpression') object = object.object as Node;
    return object.type === 'Identifier' && (object.name === 'module' || object.name === 'exports');
  };
  const member = (target: unknown): boolean => isNode(target) && target.type === 'MemberExpression' && !ownExports(target);
  return reaches(
    body,
    (node) =>
      node.type === 'CallExpression' ||
      node.type === 'NewExpression' ||
      node.type === 'TaggedTemplateExpression' ||
      (node.type === 'AssignmentExpression' && member(node.left)) ||
      (node.type === 'UpdateExpression' && member(node.argument)) ||
      (node.type === 'UnaryExpression' && node.operator === 'delete'),
    false,
  );
}
