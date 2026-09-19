/**
 * A candidate-driven reader for framework calls that name modules as strings.
 *
 * The candidate set is required. Without it, discovering a rare convention
 * would open every module in the repository merely to ask whether its text
 * contains a call name. Candidate discovery belongs to the caller that already
 * has the cheapest signal — an editor event, a changed-file list, or one
 * repository-wide text search during bootstrap.
 */

// compass: variance-authority.reach

import type { ImportDiff, Node, Taint, TaintSubject } from './index.js';

export interface ModuleCallsTaintOptions {
  /** Cache and report identity. Change it when the call rule changes. */
  readonly name: string;
  /** The only files this reader may open, relative to the scan root. */
  readonly files: ReadonlySet<string>;
  /** Call identifier to zero-based argument positions containing module specifiers. */
  readonly calls: Readonly<Record<string, number | readonly number[]>>;
}

/**
 * Add import edges named by configured call arguments.
 *
 * Only string literals and template literals without substitutions count. A
 * function argument containing `import()` is deliberately ignored: the native
 * module parser already records that edge.
 */
export function moduleCallsTaint(options: ModuleCallsTaintOptions): Taint {
  const calls = new Map(
    Object.entries(options.calls).map(([name, positions]) => [
      name,
      typeof positions === 'number' ? [positions] : [...positions],
    ]),
  );
  const needles = [...calls.keys()];

  return {
    name: options.name,
    files: (file) => options.files.has(file),
    read: (subject) => modulesIn(subject, calls, needles),
  };
}

function modulesIn(
  subject: TaintSubject,
  calls: ReadonlyMap<string, readonly number[]>,
  needles: readonly string[],
): ImportDiff | undefined {
  if (!needles.some((name) => subject.source.includes(name))) return undefined;

  const plus = new Set<string>();
  each(subject.program(), (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee as Node;
    if (callee.type !== 'Identifier') return;
    const positions = calls.get(String(callee.name));
    if (positions === undefined) return;

    const args = node.arguments as readonly Node[];
    for (const position of positions) {
      const specifier = stringOf(args[position]);
      if (specifier !== undefined && specifier !== '') plus.add(specifier);
    }
  });

  return plus.size === 0 ? undefined : { plus: [...plus] };
}

function stringOf(node: Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (node.type === 'Literal') {
    const value = (node as { value?: unknown }).value;
    return typeof value === 'string' ? value : undefined;
  }
  if (node.type !== 'TemplateLiteral') return undefined;

  const expressions = node.expressions as readonly Node[];
  const quasis = node.quasis as readonly Node[];
  const [only] = quasis;
  if (expressions.length !== 0 || quasis.length !== 1 || only === undefined) return undefined;
  const cooked = (only.value as { cooked?: unknown }).cooked;
  return typeof cooked === 'string' ? cooked : undefined;
}

function each(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (value === null || typeof value !== 'object') continue;
    const children = Array.isArray(value) ? value : [value];
    for (const child of children) if (isNode(child)) each(child, visit);
  }
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
