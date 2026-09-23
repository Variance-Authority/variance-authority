/**
 * What a Python file asks for and what it publishes.
 *
 * The same two questions [`read.ts`](./read.ts) asks of a JavaScript module, in
 * a language whose answers are shaped differently in three ways that matter.
 *
 * ## One statement is several modules
 *
 * `from briefcase.platform.answer import diagnose` runs four files: the three
 * package `__init__.py` on the way down, and then either
 * `answer/diagnose.py` — if `diagnose` is a module — or nothing more, if it is a
 * name that `answer/__init__.py` defines. **Which of the two is a fact about the
 * disk, not about the statement**, and the language offers no way to tell them
 * apart by reading.
 *
 * So the reader emits every module path the statement could have meant and marks
 * the ones it derived rather than read as {@link Request.guessed}. A guessed
 * request that resolves is an edge; one that does not is silence — not an
 * unresolved specifier, not a hole, not an `unknown`. Measured over `briefcase`,
 * 299 files and 597 first-party requests: resolving only the written module
 * misses **64 edges**, a tenth of them, and the shape it misses is a test
 * importing three sibling modules from their package. A change to one of those
 * modules would not select that test. That is the failure this package exists to
 * refuse, so the guesses are taken.
 *
 * ## An import executes the packages above it
 *
 * `import a.b.c` runs `a/__init__.py` and `a/b/__init__.py` before `a/b/c.py`,
 * so a change to either reaches every importer. Those are real edges — 246 of
 * them over `briefcase` that nothing else reaches — and they are guessed for a
 * different reason than submodules are: a package directory with no
 * `__init__.py` is a namespace package (PEP 420), which is ordinary and means
 * there is no file to depend on. A prefix that does not resolve is therefore not
 * a hole either.
 *
 * ## `if TYPE_CHECKING:` is `import type`
 *
 * The block is erased before anything runs, exactly as a TypeScript type import
 * is, so it is read as one. The `else:` branch of that same statement is not:
 * it is the runtime half, and marking it type-only would erase a real edge.
 *
 * ## What is unknown
 *
 * A parse error, and a non-literal `importlib.import_module(x)` or `__import__(x)`.
 * A literal one is read and becomes a `dynamic` edge, for the reason the module
 * reader reads a literal `require`: a dynamic corner of a repository that is
 * legible belongs in the graph.
 */

import type { EdgeKind } from '@variance-authority/core/relate';
import { missingGrammar, parserFor, type GrammarNode } from './grammar.js';
import { NAMESPACE_NAME, type Binding, type Export, type Read, type Request } from './read.js';
import type { TreeWorld } from './world.js';

/** Files a package is made of, in the order Python looks for them. */
const MODULE_FILES = ['.py', '/__init__.py', '.pyi', '/__init__.pyi'];

/** Manifests whose directory is a source root, and whose `src/` is one too. */
const MANIFESTS = ['pyproject.toml', 'setup.py', 'setup.cfg'];

interface Gathering {
  readonly requests: Map<string, { value: string; kind: EdgeKind; line: number; guessed: boolean; bindings: Binding[] }>;
  readonly exports: Map<string, Export>;
  readonly opaque: Export[];
  readonly reasons: string[];
  explicit: readonly string[] | undefined;
}

/** Everything a Python file's bytes say, without touching a disk. */
export function readPython(file: string, source: string): Read {
  const parser = parserFor('python');
  // An absent grammar makes the language unreadable, not edgeless. Every file
  // in it is answered with `unknown` naming the package to install, so a report
  // on the scan says so rather than showing a language with no imports
  // ([`grammar.ts`](./grammar.ts)).
  if (parser === undefined) {
    return { requests: [], unknown: missingGrammar(file, 'python') };
  }

  const tree = parser.parse(source);
  if (tree === null) {
    return { requests: [], unknown: `${file} could not be parsed.` };
  }

  const at: Gathering = {
    requests: new Map(),
    exports: new Map(),
    opaque: [],
    reasons: [],
    explicit: undefined,
  };
  if (tree.rootNode.hasError) {
    at.reasons.push('the parser reported an error, so what follows may stop at it');
  }

  walk(at, tree.rootNode, false, true);

  const exports = at.explicit === undefined
    ? [...at.exports.values(), ...at.opaque]
    // `__all__` is the published set when it is written, and it is written to
    // narrow: a name the module binds and leaves out of it is not published.
    : [
      ...at.explicit.map((name) => at.exports.get(name) ?? { exported: name, type: false, line: 1 }),
      ...at.opaque,
    ];

  return {
    requests: [...at.requests.values()].map(asRequest),
    ...(exports.length === 0 ? {} : { exports }),
    ...(at.reasons.length === 0 ? {} : { unknown: `${file} — ${at.reasons.join('; ')}` }),
  };
}

function asRequest(held: Gathering['requests'] extends Map<string, infer V> ? V : never): Request {
  return {
    value: held.value,
    kind: held.kind,
    bindings: held.bindings,
    line: held.line,
    ...(held.guessed ? { guessed: true } : {}),
  };
}

function want(
  at: Gathering,
  value: string,
  kind: EdgeKind,
  line: number,
  guessed: boolean,
  bindings: readonly Binding[],
): void {
  const held = at.requests.get(value);
  if (held === undefined) {
    at.requests.set(value, { value, kind, line, guessed, bindings: [...bindings] });
    return;
  }

  held.bindings.push(...bindings);
  // A value written once and derived once is written: whichever reading gives
  // it the stronger claim wins, in both directions.
  if (!guessed) held.guessed = false;
  if (held.kind === 'type' && kind !== 'type') held.kind = kind;
  if (line < held.line) held.line = line;
}

/** Every package above a module path, which an import of it executes. */
function prefixesOf(value: string): readonly string[] {
  const dots = leadingDots(value);
  const parts = value.slice(dots).split('.').filter((part) => part !== '');
  const stem = '.'.repeat(dots);

  return parts.slice(0, -1).map((_, index) => stem + parts.slice(0, index + 1).join('.'));
}

function leadingDots(value: string): number {
  let dots = 0;
  while (dots < value.length && value[dots] === '.') dots += 1;
  return dots;
}

function walk(at: Gathering, node: GrammarNode, typing: boolean, top: boolean): void {
  switch (node.type) {
    case 'import_statement':
      return readImport(at, node, typing, top);
    case 'import_from_statement':
      return readImportFrom(at, node, typing, top);
    case 'if_statement': {
      // Only the consequence is erased. The `else:` of an `if TYPE_CHECKING:`
      // is the branch that runs.
      const condition = node.childForFieldName('condition');
      const consequence = node.childForFieldName('consequence');
      const guarded = typing || /\bTYPE_CHECKING\b/.test(condition?.text ?? '');
      for (const child of node.namedChildren) {
        const erased = consequence !== null && child.equals(consequence) ? guarded : typing;
        walk(at, child, erased, top && child !== condition);
      }
      return;
    }
    case 'function_definition':
    case 'class_definition': {
      if (top) publish(at, node.childForFieldName('name'), node.startPosition.row + 1);
      // A body binds nothing at module scope, but it may import.
      const body = node.childForFieldName('body');
      if (body !== null) walk(at, body, typing, false);
      return;
    }
    case 'expression_statement':
      if (top) readAssignment(at, node);
      break;
    case 'call':
      readDynamic(at, node, typing);
      break;
    default:
      break;
  }

  // `block` keeps the scope its parent set; everything else at module level —
  // `try`, `with`, `for` — still binds at module scope.
  const inner = node.type === 'module' || node.type === 'block' || isStatement(node.type);
  for (const child of node.namedChildren) walk(at, child, typing, top && inner);
}

function isStatement(type: string): boolean {
  return type.endsWith('_statement') || type.endsWith('_clause');
}

function readImport(at: Gathering, node: GrammarNode, typing: boolean, top: boolean): void {
  const line = node.startPosition.row + 1;
  const kind: EdgeKind = typing ? 'type' : 'imports';

  for (const child of node.childrenForFieldName('name')) {
    const aliased = child.type === 'aliased_import';
    const name = aliased ? child.childForFieldName('name') : child;
    const alias = aliased ? child.childForFieldName('alias') : null;
    if (name === null) continue;

    const value = name.text;
    // `import a.b.c` binds `a`; `import a.b.c as x` binds `x` to `a.b.c`.
    const local = alias === null ? value.split('.')[0]! : alias.text;
    want(at, value, kind, line, false, [{ imported: NAMESPACE_NAME, local, type: typing, line }]);
    for (const prefix of prefixesOf(value)) want(at, prefix, kind, line, true, []);
    if (top && !typing) at.exports.set(local, { exported: local, from: value, imported: NAMESPACE_NAME, type: false, line });
  }
}

function readImportFrom(at: Gathering, node: GrammarNode, typing: boolean, top: boolean): void {
  const line = node.startPosition.row + 1;
  const kind: EdgeKind = typing ? 'type' : 'imports';
  const module = node.childForFieldName('module_name');
  if (module === null) return;

  // As written, dots and all: the dot count is the resolution, and `.` and `..`
  // are different modules that this is the only record of.
  const value = module.text;
  const star = node.namedChildren.some((child) => child.type === 'wildcard_import');

  if (star) {
    want(at, value, kind, line, false, []);
    for (const prefix of prefixesOf(value)) want(at, prefix, kind, line, true, []);
    // Every name that module publishes is published again from here, and this
    // file never names them. The same answer `export * from './x'` gets: a
    // published set with no name in it, which is *not knowable* rather than
    // empty ([`read.ts`](./read.ts)).
    if (top) at.opaque.push({ from: value, type: false, line });
    return;
  }

  const bindings: Binding[] = [];
  const guesses: string[] = [];
  for (const child of node.childrenForFieldName('name')) {
    const aliased = child.type === 'aliased_import';
    const name = aliased ? child.childForFieldName('name') : child;
    const alias = aliased ? child.childForFieldName('alias') : null;
    if (name === null) continue;

    const imported = name.text;
    const local = alias === null ? imported : alias.text;
    bindings.push({ imported, local, type: typing, line });
    // `import x` after a dotted module needs no separator; `from . import x`
    // does not get one either, because the dots are the separator.
    guesses.push(value.endsWith('.') ? `${value}${imported}` : `${value}.${imported}`);
    if (top && !typing) at.exports.set(local, { exported: local, from: value, imported, type: false, line });
  }

  want(at, value, kind, line, false, bindings);
  for (const prefix of prefixesOf(value)) want(at, prefix, kind, line, true, []);
  for (const guess of guesses) want(at, guess, kind, line, true, []);
}

function readAssignment(at: Gathering, node: GrammarNode): void {
  for (const child of node.namedChildren) {
    if (child.type !== 'assignment') continue;
    const left = child.childForFieldName('left');
    if (left === null) continue;

    if (left.text === '__all__') {
      const right = child.childForFieldName('right');
      const named = right === null ? [] : stringsIn(right);
      // A computed `__all__` is not a narrowing this can read. Falling back to
      // the bound names over-reports the published set, which costs a lookup;
      // reading it as empty would report a module as publishing nothing.
      at.explicit = named.length === 0 ? undefined : named;
      continue;
    }

    if (left.type === 'identifier') publish(at, left, child.startPosition.row + 1);
  }
}

function stringsIn(node: GrammarNode): readonly string[] {
  if (node.type === 'string') {
    return node.namedChildren.filter((c) => c.type === 'string_content').map((c) => c.text);
  }
  return node.namedChildren.flatMap((child) => stringsIn(child));
}

/**
 * Record a name this module binds at top level.
 *
 * Leading-underscore names are left out, which is the convention `from x import *`
 * itself obeys and the only published-set rule the language has in the absence
 * of `__all__`.
 */
function publish(at: Gathering, name: GrammarNode | null, line: number): void {
  if (name === null || name.text.startsWith('_')) return;
  at.exports.set(name.text, { exported: name.text, local: name.text, type: false, line });
}

/** `importlib.import_module('a.b')` and `__import__('a.b')`, literal or not. */
function readDynamic(at: Gathering, node: GrammarNode, typing: boolean): void {
  const callee = node.childForFieldName('function');
  if (callee === null) return;

  const name = callee.text;
  if (name !== '__import__' && !name.endsWith('importlib.import_module') && name !== 'import_module') return;

  const line = node.startPosition.row + 1;
  const first = node.childForFieldName('arguments')?.namedChildren[0];
  if (first === undefined) return;

  if (first.type === 'string') {
    const literal = stringsIn(first).join('');
    if (literal !== '') {
      want(at, literal, typing ? 'type' : 'dynamic', line, false, []);
      for (const prefix of prefixesOf(literal)) want(at, prefix, 'dynamic', line, true, []);
      return;
    }
  }

  at.reasons.push(`${name}(…) on line ${line} names a module this cannot read`);
}

/**
 * Where Python looks for a top-level module, in the order it looks.
 *
 * A distribution's own directory, and its `src/` when it has one — the layout
 * `briefcase` uses nineteen times over, where one `briefcase` package is spread
 * across nineteen `src/` roots and only their union resolves it. The repository
 * root is last and always present, because a script beside its imports is the
 * layout with no manifest at all.
 */
export function pythonRootsOf(paths: Iterable<string>): readonly string[] {
  const all = [...paths];
  const directories = new Set<string>();
  for (const path of all) {
    const cut = path.lastIndexOf('/');
    directories.add(cut === -1 ? '' : path.slice(0, cut));
  }

  const roots = new Set<string>();
  for (const path of all) {
    const cut = path.lastIndexOf('/');
    if (!MANIFESTS.includes(path.slice(cut + 1))) continue;
    const dir = cut === -1 ? '' : path.slice(0, cut);
    const src = dir === '' ? 'src' : `${dir}/src`;
    // `src/` counts when something is under it, not when it is merely named:
    // an empty one resolves nothing and costs a lookup on every request.
    if ([...directories].some((at) => at === src || at.startsWith(`${src}/`))) roots.add(src);
    roots.add(dir);
  }
  roots.add('');

  return [...roots];
}

/**
 * Where one Python specifier lands, repository-relative, or nothing.
 *
 * `exists` is asked rather than a disk, because the scan already holds the
 * tree's path set and a namespace package spread over nineteen roots turns one
 * specifier into seventy-six candidate paths — which is a memo lookup each, and
 * would be seventy-six `stat` calls otherwise.
 */
export function resolvePython(input: {
  readonly from: string;
  readonly request: string;
  readonly world: TreeWorld;
}): readonly string[] {
  const { from, request, world } = input;
  const exists = (path: string): boolean => world.has(path);
  const roots = pythonRoots(world);
  const dots = leadingDots(request);
  const tail = request.slice(dots).replaceAll('.', '/');

  if (dots > 0) {
    // One dot is this package — the directory the file is in. Each further dot
    // is one package up.
    const parts = from.split('/').slice(0, -1);
    if (dots - 1 > parts.length) return [];
    const base = parts.slice(0, parts.length - (dots - 1)).join('/');
    const landed = found(base === '' ? tail : tail === '' ? base : `${base}/${tail}`, exists);
    return landed === undefined ? [] : [landed];
  }

  for (const root of roots) {
    const landed = found(root === '' ? tail : `${root}/${tail}`, exists);
    if (landed !== undefined) return [landed];
  }

  return [];
}

/** The source roots of this tree, walked once and held for the scan. */
function pythonRoots(world: TreeWorld): readonly string[] {
  return world.index('python:roots', (tree) => pythonRootsOf(tree.below('')));
}

function found(base: string, exists: (path: string) => boolean): string | undefined {
  if (base === '') return undefined;
  for (const end of MODULE_FILES) {
    const candidate = `${base}${end}`;
    if (exists(candidate)) return candidate;
  }
  return undefined;
}

/** Whether a Python specifier names something inside this tree by construction. */
export function isPythonRelative(request: string): boolean {
  return request.startsWith('.');
}
