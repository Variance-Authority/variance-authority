/**
 * The walk that decides where a probe goes, and what the region behind it is called.
 *
 * Two questions, one descent, because neither can be answered without the other's
 * state: `if#1/then` is numbered within the path that contains it and against the
 * scope that opened it, and both are only known while standing in them. The rule
 * this applies — one arrival condition per region — and the vocabulary it produces
 * are in [`blocks.ts`](./blocks.ts).
 *
 * ## Nothing is re-printed
 *
 * Every emission is an insertion at an offset in the original source. A region
 * whose body is already a block gets one splice after its `{`; a bare statement
 * body is wrapped in `{`…`}`, which is also what removes the dangling-`else`
 * hazard — a synthesized `else` can never rebind, because by the time it is
 * appended the `if` it follows always has a braced consequent.
 *
 * Closing insertions are pushed **after** the subtree is walked, so a stable sort
 * by offset puts an inner `}` in front of an outer one. `if (a) if (b) x();` grows
 * two synthesized `else` clauses at the same offset and they nest correctly for
 * that reason alone.
 */

import type { Block, BlockKind, Edit, Node, Probes } from './blocks.js';

/** A scope for names, carried down so a nested function knows what contains it. */
export interface Scope {
  /** The declaration name path built so far. */
  readonly name: string;
  /** Step counters keyed by structural path, so numbering stays local to a parent. */
  readonly counts: Map<string, number>;
  /** Anonymous-function counter for this name scope. */
  readonly anon: { at: number };
}

/** Type positions hold no executable code, and walking them is pure cost. */
const TYPE_KEYS = new Set([
  'typeAnnotation',
  'typeParameters',
  'typeArguments',
  'returnType',
  'superTypeArguments',
  'superTypeParameters',
  'implements',
]);

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

const LOOPS = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
]);

export const scope = (name: string): Scope => ({ name, counts: new Map(), anon: { at: 0 } });

/**
 * The recursive descent itself.
 *
 * `visit` returns the structural label of a decision it just handled, or
 * `undefined`. That return is what lets a statement list place the continuation
 * probe: the list knows there is a following statement, the decision knows what it
 * is called, and neither can work it out alone.
 */
export class Walker {
  readonly blocks: Block[] = [];
  readonly edits: Edit[] = [];

  constructor(private readonly probes: Probes) {}

  open(kind: BlockKind, at: Scope, path: string, start: number, end: number): number {
    const ordinal = this.blocks.length;
    this.blocks.push({ ordinal, kind, name: at.name, path, start, end });
    return ordinal;
  }

  list(statements: readonly Node[], at: Scope, path = ''): void {
    const last = statements.at(-1);

    for (const [index, statement] of statements.entries()) {
      const decision = this.visit(statement, at, path);
      const next = statements[index + 1];
      if (decision === undefined || next === undefined || last === undefined) continue;

      // The region after a decision. Reaching it does not follow from reaching the
      // code above, because a branch may have returned, thrown or broken out.
      const ordinal = this.open('continuation', at, `${decision}/after`, next.start, last.end);
      this.edits.push({ at: next.start, text: `${this.probes.hit(ordinal)};` });
    }
  }

  visit(node: Node, at: Scope, path: string, hint?: string): string | undefined {
    switch (node.type) {
      case 'IfStatement':
        return this.branch(node, at, path);
      case 'SwitchStatement':
        return this.switched(node, at, path);
      case 'TryStatement':
        return this.guarded(node, at, path);
      case 'AwaitExpression':
        this.resume(node, at, path);
        return undefined;
      case 'LabeledStatement':
        // The label is not a region; whatever it labels may be.
        return this.visit(node.body as Node, at, path);
      case 'BlockStatement':
      case 'StaticBlock':
        this.list(node.body as readonly Node[], at, path);
        return undefined;
      case 'ClassDeclaration':
      case 'ClassExpression':
        this.descend(node, this.named(node, at, hint), path);
        return undefined;
      // TODO: `ConditionalExpression` and `LogicalExpression` fall through to
      // `descend`, so `a ? b : c` and `x ?? y` belong to the region containing
      // them and no run can say which side was taken — needs an outcome region in
      // expression position. The `census` script prices it against Istanbul's
      // counters, and the price is not repeated here because it is a figure over
      // this repository's own source and moves every time a file is added.
      default:
        break;
    }

    if (LOOPS.has(node.type)) return this.loop(node, at, path);

    if (FUNCTIONS.has(node.type)) {
      this.entered(node, at, hint);
      return undefined;
    }

    this.descend(node, at, path);
    return undefined;
  }

  /**
   * Put a probe at the head of a region, wrapping a bare statement in a block.
   *
   * The wrap is not a convenience. `if (c) foo();` with a synthesized `else`
   * appended would otherwise rebind a dangling `else` further out, and a bare loop
   * body has nowhere to put a statement at all. The returned closer is called after
   * the subtree is walked, which is what nests the braces.
   */
  private enter(body: Node, kind: BlockKind, at: Scope, path: string): () => void {
    const ordinal = this.open(kind, at, path, body.start, body.end);

    if (body.type === 'BlockStatement') {
      this.edits.push({ at: body.start + 1, text: `${this.probes.hit(ordinal)};` });
      return () => {};
    }

    this.edits.push({ at: body.start, text: `{${this.probes.hit(ordinal)};` });
    return () => this.edits.push({ at: body.end, text: '}' });
  }

  /** `if`/`else`, and the `else` nobody wrote is still an outcome. */
  private branch(node: Node, at: Scope, path: string): string {
    const label = this.step(at, path, 'if');
    const consequent = node.consequent as Node;
    const alternate = node.alternate as Node | null;

    this.visit(node.test as Node, at, path);

    const closeThen = this.enter(consequent, 'branch', at, `${label}/then`);
    this.visit(consequent, at, `${label}/then`);
    closeThen();

    if (alternate === null) {
      // Zero-width, because it has no source. A change to the condition still
      // reaches every test that fell through here.
      const ordinal = this.open('branch', at, `${label}/else`, consequent.end, consequent.end);
      this.edits.push({ at: consequent.end, text: ` else{${this.probes.hit(ordinal)};}` });
      return label;
    }

    const closeElse = this.enter(alternate, 'branch', at, `${label}/else`);
    this.visit(alternate, at, `${label}/else`);
    closeElse();

    return label;
  }

  /**
   * One probe per clause, including a `default` nobody wrote.
   *
   * The synthesized `default` goes last and holds nothing but its probe, so a
   * clause falling through into it records a region control genuinely reached, and
   * a switch that matches nothing still runs no statement it did not run before.
   */
  private switched(node: Node, at: Scope, path: string): string {
    const label = this.step(at, path, 'switch');
    const cases = node.cases as readonly Node[];
    let written = false;

    this.visit(node.discriminant as Node, at, path);

    for (const [index, clause] of cases.entries()) {
      const body = clause.consequent as readonly Node[];
      const step = clause.test === null ? `${label}/default` : `${label}/case#${index}`;
      written ||= clause.test === null;

      // An empty clause is pure fallthrough, and its colon is where the probe goes.
      const head = body[0]?.start ?? clause.end;
      const ordinal = this.open('case', at, step, head, clause.end);
      this.edits.push({ at: head, text: `${this.probes.hit(ordinal)};` });

      if (clause.test !== null) this.visit(clause.test as Node, at, path);
      this.list(body, at, step);
    }

    if (!written) {
      const ordinal = this.open('case', at, `${label}/default`, node.end - 1, node.end - 1);
      this.edits.push({ at: node.end - 1, text: `default:${this.probes.hit(ordinal)};` });
    }

    return label;
  }

  /**
   * `catch` and `finally` are regions; the `try` block is not.
   *
   * Entering `try` follows from entering the code above it, so its test set is the
   * enclosing region's and a probe there would record a fact already held.
   */
  private guarded(node: Node, at: Scope, path: string): string {
    const label = this.step(at, path, 'try');
    const handler = node.handler as Node | null;
    const finalizer = node.finalizer as Node | null;

    this.visit(node.block as Node, at, `${label}/try`);

    if (handler !== null) {
      const body = handler.body as Node;
      const bound = handler.param as Node | null;
      if (bound !== null) this.visit(bound, at, path);

      const close = this.enter(body, 'handler', at, `${label}/catch`);
      this.visit(body, at, `${label}/catch`);
      close();
    }

    if (finalizer !== null) {
      const close = this.enter(finalizer, 'handler', at, `${label}/finally`);
      this.visit(finalizer, at, `${label}/finally`);
      close();
    }

    return label;
  }

  /** A loop body may run zero times, which is the only reason it needs a probe. */
  private loop(node: Node, at: Scope, path: string): string {
    const label = this.step(at, path, node.type.startsWith('For') ? 'for' : 'while');
    const body = node.body as Node;

    for (const key of ['init', 'test', 'update', 'left', 'right'] as const) {
      const part = node[key] as Node | null | undefined;
      if (part !== null && part !== undefined) this.visit(part, at, path);
    }

    const close = this.enter(body, 'loop', at, `${label}/body`);
    this.visit(body, at, `${label}/body`);
    close();

    return label;
  }

  /**
   * Execution came back, and the stack after is not the stack before.
   *
   * Wrapped rather than preceded, because the value has to survive: a comma
   * expression would record the resumption and then throw the awaited value away.
   * The open text is pushed before the descent and the close after it, so
   * `await await f()` closes inner-before-outer at offsets that are otherwise equal.
   */
  private resume(node: Node, at: Scope, path: string): void {
    const label = this.step(at, path, 'await');
    const ordinal = this.open('resume', at, label, node.start, node.end);
    const [open, close] = this.probes.around(ordinal);

    this.edits.push({ at: node.start, text: open });
    this.descend(node, at, path);
    this.edits.push({ at: node.end, text: close });
  }

  /**
   * A function is a new name scope and a fresh structural path.
   *
   * Its entry block owns everything before the first decision, which is why a
   * change to `normalize(input)` on the first line reaches every test that ever
   * called the function.
   */
  private entered(node: Node, at: Scope, hint?: string): void {
    const inner = this.named(node, at, hint);
    const body = node.body as Node | null;

    for (const parameter of node.params as readonly Node[]) this.visit(parameter, inner, '');

    // A TypeScript overload signature or an `abstract` method has no body at all.
    if (body === null) return;

    if (body.type !== 'BlockStatement') {
      // An expression body: `(n) => n * 2` becomes `(n) => (probe, n * 2)`.
      const ordinal = this.open('function', inner, 'entry', body.start, body.end);
      this.edits.push({ at: body.start, text: `(${this.probes.hit(ordinal)},` });
      this.visit(body, inner, '');
      this.edits.push({ at: body.end, text: ')' });
      return;
    }

    this.enter(body, 'function', inner, 'entry');
    this.list(body.body as readonly Node[], inner, '');
  }

  /** Everything with no region of its own, with the naming hints its children need. */
  private descend(node: Node, at: Scope, path: string): void {
    const hints = hintsFor(node);

    for (const key of Object.keys(node)) {
      if (TYPE_KEYS.has(key)) continue;

      const value = node[key];
      if (value === null || typeof value !== 'object') continue;

      const children = Array.isArray(value) ? value : [value];
      for (const [index, child] of children.entries()) {
        if (isNode(child)) this.visit(child, at, path, hints?.(key, index));
      }
    }
  }

  /** `if#0`, `if#1`, `for#0` — numbered within the path that contains them. */
  private step(at: Scope, path: string, kind: string): string {
    const key = `${path} ${kind}`;
    const index = at.counts.get(key) ?? 0;
    at.counts.set(key, index + 1);

    return path === '' ? `${kind}#${index}` : `${path}/${kind}#${index}`;
  }

  /** The scope a named declaration opens, or the enclosing one if it has no name. */
  private named(node: Node, at: Scope, hint: string | undefined): Scope {
    const own = declaredName(node, hint);
    if (own === undefined) return scope(joined(at.name, `anon#${at.anon.at++}`));

    return scope(joined(at.name, own));
  }
}

const joined = (outer: string, own: string): string => (outer === '' ? own : `${outer}/${own}`);

function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

/**
 * The name a function takes from whatever holds it.
 *
 * A closure passed to `reduce` is `reduce.arg0`, which is what the report prints,
 * and a method is its key. Nothing here guesses: a shape with no name available
 * falls through to a positional `anon#i`, and positional names are why
 * [spec 0029](../../../../docs/specs/0029-what-a-run-remembers.md) treats an
 * identity rebound by anything other than an exact match as provisional.
 */
function declaredName(node: Node, hint: string | undefined): string | undefined {
  const id = node.id as Node | null | undefined;
  if (id?.type === 'Identifier') return String(id.name);

  return hint;
}

/** Which parents name their children, and what they call them. */
function hintsFor(node: Node): ((key: string, index: number) => string | undefined) | undefined {
  switch (node.type) {
    case 'VariableDeclarator':
      return (key) => (key === 'init' ? nameOf(node.id as Node) : undefined);
    case 'Property':
    case 'PropertyDefinition':
    case 'MethodDefinition':
      return (key) => (key === 'value' ? nameOf(node.key as Node) : undefined);
    case 'AssignmentExpression':
      return (key) => (key === 'right' ? nameOf(node.left as Node) : undefined);
    case 'CallExpression':
    case 'NewExpression': {
      const callee = nameOf(node.callee as Node) ?? 'call';
      return (key, index) => (key === 'arguments' ? `${callee}.arg${index}` : undefined);
    }
    default:
      return undefined;
  }
}

function nameOf(node: Node | null | undefined): string | undefined {
  if (node === null || node === undefined) return undefined;

  switch (node.type) {
    case 'Identifier':
    case 'PrivateIdentifier':
      return String(node.name);
    case 'Literal':
      return String((node as { value?: unknown }).value);
    case 'MemberExpression':
      return nameOf(node.property as Node);
    default:
      return undefined;
  }
}
