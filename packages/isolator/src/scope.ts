/**
 * Which identifiers in a module name one of its own top-level bindings.
 *
 * The transform moves a top-level `let` into its module's frame, so every place that
 * names the binding has to read the frame instead — and only those places: a
 * parameter, a block-scoped `let` or a catch clause that declares the same name
 * is a different variable, and an object key or a member property spelled the
 * same is not a variable at all. This walks the module with a chain of scopes
 * and keeps an identifier only when no scope inside the module declares it.
 *
 * ESTree as `oxc-parser` writes it, with TypeScript's nodes: a type is never a
 * value, so a type subtree is not entered, and an expression wrapped in `as`,
 * `satisfies` or `!` is.
 */

// FIXME: a second scope resolver beside `oxc_semantic` in the sense addon's instrument crate; the walk moves there, behind an entry a build transform can load without sense.

/** An ESTree node as `oxc-parser` writes it: a type, a span, and its children. */
export interface Node {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

/** One place a module-level binding is named. */
export interface Reference {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  /** `{ name }`, where the one identifier is both the key and the value. */
  readonly shorthand: boolean;
  /** A call's callee or a template's tag: read as a member, it would be called with the frame as `this`. */
  readonly called: boolean;
  /** Inside a function, so it runs when the function is called, not when the module loads. */
  readonly deferred: boolean;
  /**
   * Where its value can be kept by what reads it: passed, assigned, returned,
   * exported or put into an object. Not where it is only read and let go — a
   * call, an operator's operand, a test, a write to it. A member read is
   * whichever its own place is: `state.items` kept keeps a part of `state`.
   */
  readonly stored: boolean;
  /** Where it is written: an assignment's target, an update's operand, a `for…in`/`for…of` head. */
  readonly written: boolean;
}

/** What the walk found in one module. */
export interface ModuleReferences {
  readonly references: readonly Reference[];
  /** A direct `eval` names variables by string, so no walk can say which. */
  readonly evaluates: boolean;
}

/** Keys that hold a type, never a value. */
const TYPE_KEYS = new Set(['typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', 'superTypeArguments', 'implements']);

/** TypeScript wrappers around a value: only their `expression` is one. */
const VALUE_WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression',
]);

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** The children whose value is read and let go there and then, by the type of their parent. */
const LET_GO: Readonly<Record<string, ReadonlySet<string>>> = {
  AssignmentExpression: new Set(['left']),
  BinaryExpression: new Set(['left', 'right']),
  CallExpression: new Set(['callee']),
  ConditionalExpression: new Set(['test']),
  DoWhileStatement: new Set(['test']),
  ExpressionStatement: new Set(['expression']),
  ForInStatement: new Set(['right']),
  ForOfStatement: new Set(['right']),
  ForStatement: new Set(['test', 'update']),
  IfStatement: new Set(['test']),
  NewExpression: new Set(['callee']),
  SwitchCase: new Set(['test']),
  TemplateLiteral: new Set(['expressions']),
  UnaryExpression: new Set(['argument']),
  UpdateExpression: new Set(['argument']),
  WhileStatement: new Set(['test']),
};

/**
 * Every identifier that names one of `names` as the module declares it, in
 * source order. A declaration of the binding at the top level is not a
 * reference: `declared` holds those identifiers, by start.
 */
export function moduleReferences(program: Node, names: ReadonlySet<string>, declared: ReadonlySet<number>): ModuleReferences {
  const references: Reference[] = [];
  const shorthands = new Set<Node>();
  const callees = new Set<Node>();
  const writes = new Set<Node>();
  const scopes: Set<string>[] = [];
  let evaluates = false;
  let functions = 0;

  const shadowed = (name: string): boolean => scopes.some((scope) => scope.has(name));
  const reference = (id: Node, name: string, stored: boolean): void => {
    if (!names.has(name) || declared.has(id.start) || shadowed(name)) return;
    references.push({ name, start: id.start, end: id.end, shorthand: shorthands.has(id), called: callees.has(id), deferred: functions > 0, stored, written: writes.has(id) });
  };
  const within = (scope: Set<string>, visit: () => void): void => {
    scopes.push(scope);
    visit();
    scopes.pop();
  };
  const each = (value: unknown): void => {
    if (Array.isArray(value)) for (const item of value) each(item);
    else if (isNode(value)) walk(value);
  };
  /** Walk a value that is read and let go: an identifier there, or the object a member is read from, is not stored. */
  const letGo = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(letGo);
    const inner = unwrapped(value);
    if (isNode(inner) && inner.type === 'Identifier') reference(inner, inner.name as string, false);
    else if (isNode(inner) && inner.type === 'ChainExpression') letGo(inner.expression);
    else if (isNode(inner) && inner.type === 'MemberExpression') {
      letGo(inner.object);
      if (inner.computed === true) each(inner.property);
    } else each(value);
  };
  /** Mark the identifiers a target writes; a member it writes is not one of them. */
  const writesTo = (target: unknown): void => {
    const inner = unwrapped(target);
    if (isNode(inner)) for (const id of binders(inner)) writes.add(id);
  };
  /** Mark the identifier a call or a tag calls. */
  const calls = (callee: unknown): void => {
    const inner = unwrapped(callee);
    if (isNode(inner) && inner.type === 'Identifier') callees.add(inner);
  };
  const children = (node: Node, skip?: ReadonlySet<string>): void => {
    const keys = LET_GO[node.type];
    for (const key in node) {
      if (key === 'type' || key === 'start' || key === 'end' || TYPE_KEYS.has(key) || skip?.has(key)) continue;
      if (keys?.has(key) === true) letGo(node[key]);
      else each(node[key]);
    }
  };

  function walk(node: Node): void {
    if (node.declare === true) return;
    if (VALUE_WRAPPERS.has(node.type)) return each(node.expression);
    switch (node.type) {
      case 'Identifier':
        return reference(node, node.name as string, true);
      case 'TSParameterProperty':
        return each(node.parameter);
      case 'TSEnumDeclaration':
        return each((node.body as Node | undefined)?.members ?? node.members);
      case 'TSEnumMember':
        return each(node.initializer);
      case 'TSExportAssignment':
        return each(node.expression);
      case 'TSModuleDeclaration':
        return each(node.body);
      case 'TSModuleBlock':
        return within(declarations(node.body as Node[], true), () => each(node.body));
      case 'LabeledStatement':
        return each(node.body);
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ExportSpecifier':
      case 'MetaProperty':
      case 'BreakStatement':
      case 'ContinueStatement':
        return;
      case 'ExportNamedDeclaration':
        return node.source == null ? each(node.declaration) : undefined;
      case 'TaggedTemplateExpression':
        calls(node.tag);
        return children(node);
      case 'AssignmentExpression':
        writesTo(node.left);
        return children(node);
      case 'UpdateExpression':
        writesTo(node.argument);
        return children(node);
      case 'CallExpression':
        calls(node.callee);
        if (isNode(node.callee) && node.callee.type === 'Identifier' && node.callee.name === 'eval' && !shadowed('eval')) evaluates = true;
        return children(node);
      case 'MemberExpression':
        each(node.object);
        return node.computed === true ? each(node.property) : undefined;
      case 'Property':
        if (node.shorthand === true && isNode(node.value)) {
          shorthands.add(node.value.type === 'AssignmentPattern' ? (node.value.left as Node) : node.value);
        }
        if (node.computed === true) each(node.key);
        return each(node.value);
      case 'MethodDefinition':
      case 'PropertyDefinition':
      case 'AccessorProperty':
      case 'TSAbstractMethodDefinition':
      case 'TSAbstractPropertyDefinition':
        if (node.computed === true) each(node.key);
        return each(node.value);
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        return fn(node);
      case 'ClassExpression':
        return isNode(node.id)
          ? within(new Set([node.id.name as string]), () => children(node, ID))
          : children(node, ID);
      case 'ClassDeclaration':
        return children(node, ID);
      case 'BlockStatement':
        return within(declarations(node.body as Node[], false), () => each(node.body));
      case 'StaticBlock':
        return within(declarations(node.body as Node[], true), () => each(node.body));
      case 'SwitchStatement':
        letGo(node.discriminant);
        return within(declarations((node.cases as Node[]).flatMap((c) => c.consequent as Node[]), false), () => each(node.cases));
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        const head = (node.init ?? node.left) as Node | null;
        const scope = head?.type === 'VariableDeclaration' && head.kind !== 'var' ? declarations([head], false) : new Set<string>();
        if (node.type !== 'ForStatement' && head?.type !== 'VariableDeclaration') writesTo(head);
        return within(scope, () => children(node));
      }
      case 'CatchClause':
        return within(bound(node.param as Node | null), () => children(node));
      case 'JSXOpeningElement':
      case 'JSXClosingElement':
        jsxName(node.name as Node, true);
        return node.type === 'JSXOpeningElement' ? each(node.attributes) : undefined;
      case 'JSXAttribute':
        return each(node.value);
      case 'JSXIdentifier':
      case 'JSXNamespacedName':
        return;
      default:
        if (node.type.startsWith('TS')) return;
        return children(node);
    }
  }

  /** `<Foo>` names a variable and `<div>` a tag; `<a.b>` names `a` whatever its case. */
  function jsxName(name: Node, tag: boolean): void {
    if (name.type === 'JSXMemberExpression') return jsxName(name.object as Node, false);
    if (name.type !== 'JSXIdentifier') return;
    const text = name.name as string;
    if (text === 'this' || (tag && !/^[A-Z_$]/.test(text))) return;
    reference(name, text, false);
  }

  /** A parameter's default sees the parameters and the function's own name, never what its body declares. */
  function fn(node: Node): void {
    const params = new Set<string>();
    if (node.type === 'FunctionExpression' && isNode(node.id)) params.add(node.id.name as string);
    for (const param of node.params as Node[]) for (const name of bound(param)) params.add(name);
    const body = node.body as Node | null;
    functions++;
    within(params, () => {
      each(node.params);
      if (body?.type === 'BlockStatement') within(declarations(body.body as Node[], true), () => each(body.body));
      else each(body);
    });
    functions--;
  }

  walk(program);
  return { references, evaluates };
}

const ID = new Set(['id']);

/**
 * The names a list of statements declares in its own scope: `let`, `const`,
 * `class` and `function` at this level, and with `hoisting` every `var` below it
 * that no nested function owns.
 */
export function declarations(statements: readonly Node[], hoisting: boolean): Set<string> {
  const names = new Set<string>();
  for (const statement of statements) {
    const declaration = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
      ? (statement.declaration as Node | null)
      : statement;
    if (declaration == null) continue;
    if (declaration.type === 'VariableDeclaration' && declaration.kind !== 'var') {
      for (const declarator of declaration.declarations as Node[]) for (const name of bound(declarator.id as Node)) names.add(name);
    } else if (/^(?:Function|Class|TSEnum|TSModule)Declaration$/.test(declaration.type) && isNode(declaration.id)) {
      if (declaration.id.type === 'Identifier') names.add(declaration.id.name as string);
    }
  }
  if (hoisting) for (const name of varNames(statements)) names.add(name);
  return names;
}

/** Every `var` a list of statements declares, below any block, but not inside a function. */
export function varNames(statements: readonly Node[]): string[] {
  const names: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!isNode(value) || FUNCTIONS.has(value.type) || value.type === 'StaticBlock' || value.type.startsWith('TS')) return;
    if (value.type === 'VariableDeclaration' && value.kind === 'var') {
      for (const declarator of value.declarations as Node[]) names.push(...bound(declarator.id as Node));
    }
    for (const key in value) if (key !== 'type' && !TYPE_KEYS.has(key)) visit(value[key]);
  };
  visit(statements);
  return names;
}

/** The names a binding pattern declares. */
export function bound(pattern: Node | null | undefined): Set<string> {
  return new Set(binders(pattern).map((id) => id.name as string));
}

/** The identifiers a pattern binds, in source order: not its defaults, nor its computed keys. */
export function binders(pattern: Node | null | undefined): Node[] {
  const ids: Node[] = [];
  const visit = (node: Node | null | undefined): void => {
    if (node == null) return;
    switch (node.type) {
      case 'Identifier':
        ids.push(node);
        return;
      case 'ObjectPattern':
        for (const property of node.properties as Node[]) visit(property.type === 'RestElement' ? property : (property.value as Node));
        return;
      case 'ArrayPattern':
        for (const element of node.elements as (Node | null)[]) visit(element);
        return;
      case 'AssignmentPattern':
        return visit(node.left as Node);
      case 'RestElement':
        return visit(node.argument as Node);
      case 'TSParameterProperty':
        return visit(node.parameter as Node);
    }
  };
  visit(pattern);
  return ids;
}

export function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/** A value without the parentheses and type assertions around it. */
function unwrapped(value: unknown): unknown {
  let inner = value;
  while (isNode(inner) && (VALUE_WRAPPERS.has(inner.type) || inner.type === 'ParenthesizedExpression')) inner = inner.expression;
  return inner;
}
