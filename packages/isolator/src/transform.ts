/**
 * The rewrite: a module's variables a session can change move into one frame
 * the session owns.
 *
 * Each such declaration becomes a step of the module's frame that writes its
 * variables through `init`, and every other place that names one reads the
 * frame through `$`, which checks what the module would:
 *
 * ```ts
 * let count = 0;            __frame.step(() => { __frame.init.count = 0 });
 * count += 1;          →    __frame.$.count += 1;
 * ```
 *
 * The module runs every step once, as it always did, and tells its frame when
 * its last statement has run: every session starts from a copy of what the
 * module held then.
 *
 * Only state a session can change moves: a `let` or `var` the module writes
 * somewhere — an assignment, an update, a loop head — and any declaration that
 * holds an object or an array literal, or a new `Map`, `Set`, `Array` or
 * `Object`. A `let` nobody writes reads as the `const` it could have been. A
 * function or a class is never wrapped, however it is declared, and nor is a
 * value built by a call — `memoize(fn)`, `createStore()`, a higher-order
 * component: the call decides what it holds, and a module that has to reset
 * it says so with `registerResetHandler` from `@variance-authority/ioc/reset`.
 *
 * What it cannot rewrite it leaves, and says so in `left`: an exported `let`,
 * since an ES module's importers read the binding itself; an object that leaves
 * the module when it loads — exported, or handed to something — since whoever
 * took it keeps the one the module made; an instance of a class, which no
 * session can copy; a `var` declared twice, or by a function too; an
 * object that holds an object every session shares, since its copy would hold
 * a copy instead; a function the module reassigns; a module that awaits at its
 * top level, or reads through `with`.
 *
 * Every line stays where it was, so a stack trace names the line it did before.
 */

import MagicString, { type SourceMap } from 'magic-string';
import { parseSync } from 'oxc-parser';
import { binders, bound, isNode, moduleReferences, varNames, type Node } from './scope.js';

/** The specifier a rewritten module imports its frame from. */
const RUNTIME = '@variance-authority/isolator/runtime';

/** One declaration the transform did not rewrite, and why. */
export interface Left {
  /** 1-based, in the file as it was read. */
  readonly line: number;
  readonly name: string;
  readonly reason: string;
}

/** One module, rewritten, and what it left shared. */
export interface Isolated {
  readonly code: string;
  /** Absent when nothing was rewritten. */
  readonly map: SourceMap | undefined;
  readonly left: readonly Left[];
}

const IGNORE_FILE = '@isolator-ignore-file';
const IGNORE = /@isolator-ignore(?!-file)/;

const LEAVES = 'it holds an object that leaves the module when it loads, exported or handed to something, so every session shares it';
const INSTANCE = 'it holds an instance of a class, which a session cannot copy, so every session shares it';
const HOLDS = 'it holds an object every session shares, which a copy of it would not, so every session shares it too';
const FUNCTION = 'it holds a function, and isolator never wraps one, so every session shares it';
const NESTED = 'a `var` inside a top-level block, loop head or `try` belongs to the module, but no step can stand in for its declaration, so every session shares it';

/** One top-level declarator, and what it becomes: a step of the frame, or itself. */
interface Declarator {
  readonly node: Node;
  readonly declaration: Node;
  readonly kind: 'let' | 'var' | 'const';
  readonly names: readonly string[];
  readonly exported: boolean;
  /** The object, array or instance its value is, literally. */
  readonly object: Held | undefined;
  role: 'step' | 'keep';
}

interface Held {
  readonly node: Node;
  /** An object or array literal, or a new `Map`, `Set`, `Array` or `Object`: what a session's copy can be made of. */
  readonly copyable: boolean;
}

/**
 * Rewrite one module: the whole transform, which the Jest transformer and the
 * loader only call. Any other build tool calls it the same way, with the text
 * it read and its path, and hands on `code` and `map`.
 *
 * `file` is read for its extension, which decides how it is
 * parsed — `.ts`, `.tsx`, `.jsx`, `.cjs` — and is the map's source.
 */
export function isolate(code: string, file: string): Isolated {
  const unchanged = (left: Left[] = []): Isolated => ({ code, map: undefined, left });
  const parsed = parseSync(file, code);
  if (parsed.comments.some((comment) => comment.value.includes(IGNORE_FILE))) return unchanged();
  return isolateParsed(code, file, parsed, unchanged);
}

function isolateParsed(
  code: string,
  file: string,
  parsed: ReturnType<typeof parseSync>,
  unchanged: (left?: Left[]) => Isolated,
): Isolated {
  if (parsed.errors.length > 0) {
    return unchanged([{ line: 1, name: '', reason: `it does not parse: ${parsed.errors[0]!.message}` }]);
  }
  const program = parsed.program as unknown as Node;
  const body = program.body as Node[];
  const lines = lineStarts(code);
  const lineOf = (at: number): number => line(lines, at);
  // While a module waits it is still loading, and every session's writes would be where all of them start.
  if (reaches(body, (node) => node.type === 'AwaitExpression' || (node.type === 'ForOfStatement' && node.await === true), false)) {
    return unchanged([{ line: 1, name: 'await', reason: 'a module that awaits at its top level is still loading while other sessions run, so none is rewritten' }]);
  }
  if (reaches(body, (node) => node.type === 'WithStatement', true)) {
    return unchanged([{ line: 1, name: 'with', reason: 'a `with` block can stand an object in for any variable, so none is rewritten' }]);
  }
  // A comment alone on its line opts out its line and the next; one after code, its own line.
  const ignored = new Set<number>();
  for (const comment of parsed.comments) {
    if (!IGNORE.test(comment.value)) continue;
    const at = lineOf(comment.start);
    ignored.add(at);
    const alone = code.slice(lines[at - 1]!, comment.start).trim() === '' && code.slice(comment.end, lines[lineOf(comment.end)] ?? code.length).trim() === '';
    if (alone) ignored.add(lineOf(comment.end) + 1);
  }
  const optedOut = (node: Node): boolean => ignored.has(lineOf(node.start));

  const left: Left[] = [];
  const declarators = topLevel(body, optedOut);
  const labelOf = (declarator: Declarator): string => {
    const id = declarator.node.id as Node;
    return id.type === 'Identifier' ? (id.name as string) : code.slice(id.start, id.end);
  };
  const leave = (declarator: Declarator, reason: string): void => {
    declarator.role = 'keep';
    left.push({ line: lineOf(declarator.node.start), name: labelOf(declarator), reason });
  };

  // Only what a session can change moves: a `let` or `var` nobody writes is a
  // `const` by another name, and a function, however declared, is never state.
  const declaredAt = new Set(declarators.map(({ node }) => node.id as Node).filter((id) => id.type === 'Identifier').map((id) => id.start));
  // An import is one binding every session shares, so an object that holds one cannot be copied.
  const found = moduleReferences(program, new Set([...declarators.flatMap(({ names }) => names), ...importedNames(body)]), declaredAt);
  if (found.evaluates) {
    return unchanged([{ line: 1, name: 'eval', reason: 'a direct `eval` can name any variable, so none is rewritten' }]);
  }
  const written = new Set(found.references.filter(({ written }) => written).map(({ name }) => name));

  const functions = functionNames(body);
  const declaredBy = new Map<string, number>();
  for (const name of varNames(body)) declaredBy.set(name, (declaredBy.get(name) ?? 0) + 1);
  for (const declarator of declarators) {
    const { kind, object } = declarator;
    const changes = kind !== 'const' && declarator.names.some((name) => written.has(name));
    if (callable(declarator.node.init as Node | null)) {
      if (changes) leave(declarator, FUNCTION);
    } else if (kind !== 'const' && !changes && object === undefined) {
      // Never written: what it holds stays, as a `const`'s would.
    } else if (kind !== 'const' && declarator.exported) {
      leave(declarator, `an exported \`${kind}\` is read by its importers as a live binding, which no getter can stand in for`);
    } else if (kind === 'const' && object === undefined) {
      // A value no session can change, or one a call decided.
    } else if (kind === 'var' && declarator.names.some((name) => functions.has(name))) {
      leave(declarator, 'a function or a class declares it too');
    } else if (kind === 'var' && declarator.names.some((name) => declaredBy.get(name)! > 1)) {
      leave(declarator, 'more than one `var` declares it');
    } else if (object?.copyable === false) {
      leave(declarator, INSTANCE);
    } else if (declarator.exported) {
      leave(declarator, LEAVES);
    } else {
      declarator.role = 'step';
    }
  }

  // A `var` below a top-level block, loop head or `try` is the module's too,
  // but its declaration is no statement a step can stand in for.
  for (const statement of body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? (statement.declaration as Node | null) : statement;
    if (declaration?.type === 'VariableDeclaration') continue;
    for (const name of varNames([statement])) left.push({ line: lineOf(statement.start), name, reason: NESTED });
  }

  const roleOf = new Map(declarators.map((declarator) => [declarator.node, declarator]));
  const ownerOf = new Map(declarators.flatMap((declarator) => declarator.names.map((name) => [name, declarator] as const)));

  // An object stays one object only while every name for it moves with it: a
  // session's copy keeps two of its names two names for one copy, and nothing
  // else. So an object kept anywhere but in another moving object stays, and so
  // does whatever moving name is handed one that stays.
  const containerOf = within(declarators.map(({ node }) => node));
  const statementOf = within(body);
  const flowing = new Map(declarators.map((declarator) => [declarator.node, flows(declarator.node.init as Node | null)]));
  const atLoad = found.references.filter(({ deferred }) => !deferred);
  const holders = (at: number): Declarator[] => {
    const container = containerOf(at);
    if (container !== undefined) return [roleOf.get(container)!];
    const statement = statementOf(at)!;
    return atLoad.filter(({ start }) => start >= statement.start && start < statement.end).flatMap(({ name }) => ownerOf.get(name) ?? []);
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const reference of atLoad) {
      if (!reference.stored) continue;
      const owner = ownerOf.get(reference.name);
      if (owner === undefined || (owner.role === 'keep' && !primitive(owner.node.init as Node | null))) {
        for (const holder of holders(reference.start)) {
          if (holder === owner || holder.role !== 'step') continue;
          leave(holder, HOLDS);
          changed = true;
        }
      } else if (owner.role === 'step' && owner.object !== undefined) {
        const container = containerOf(reference.start);
        if (container === owner.node || (container !== undefined && roleOf.get(container)!.role === 'step' && flowing.get(container)!.has(reference.start))) continue;
        leave(owner, LEAVES);
        changed = true;
      }
    }
  }
  const moved = new Set(declarators.filter(({ role }) => role === 'step').flatMap(({ names }) => names));
  if (moved.size === 0) return unchanged(left);

  const ns = fresh(code, '__isolator');
  const frame = fresh(code, '__frame');
  const s = new MagicString(code);
  // Every overwrite comes before every insertion: an overwrite replaces the
  // intro and outro of the chunks it covers, so an insertion made first is lost.
  // A pattern's own names are its declaration's writes; its defaults are not.
  const declares = new Set(
    declarators.filter(({ role, node }) => role === 'step' && (node.id as Node).type !== 'Identifier').flatMap(({ node }) => binders(node.id as Node).map(({ start }) => start)),
  );
  for (const { name, start, end, shorthand, called } of found.references.filter(({ name }) => moved.has(name))) {
    const value = called ? `(0, ${frame}.$.${name})` : `${frame}.${declares.has(start) ? 'init' : '$'}.${name}`;
    s.overwrite(start, end, shorthand ? `${name}: ${value}` : value);
  }
  const steps = declarators.filter(({ role }) => role === 'step');
  for (const declaration of new Set(steps.map(({ declaration }) => declaration))) {
    const kind = declaration.kind as string;
    const all = declaration.declarations as Node[];
    const step = (node: Node): Declarator | undefined => (roleOf.get(node)?.role === 'step' ? roleOf.get(node) : undefined);
    const head = (node: Node): string => {
      const moving = step(node);
      return moving === undefined ? kind : `${frame}.step(() => {`;
    };
    s.overwrite(declaration.start, declaration.start + kind.length, head(all[0]!));
    for (let index = 1; index < all.length; index++) {
      if (step(all[index - 1]!) === undefined && step(all[index]!) === undefined) continue;
      const comma = commaBetween(code, all[index - 1]!.end, all[index]!.start);
      s.overwrite(comma, comma + 1, `; ${head(all[index]!)}`);
    }
    for (const node of all) {
      if (step(node) === undefined) continue;
      const id = node.id as Node;
      const init = node.init as Node | null;
      if (id.type !== 'Identifier') {
        const annotation = id.typeAnnotation as Node | null | undefined;
        if (annotation != null) {
          const newlines = countNewlines(code.slice(annotation.start, annotation.end));
          if (newlines === 0) s.remove(annotation.start, annotation.end);
          else s.overwrite(annotation.start, annotation.end, '\n'.repeat(newlines));
        }
      } else if (init == null) {
        const empty = kind === 'var' ? 'void 0' : `${frame}.init.${id.name as string} = undefined`;
        s.overwrite(node.start, node.end, keepLines(empty, code, node.start, node.end));
      } else {
        s.overwrite(node.start, init.start, keepLines(`${frame}.init.${id.name as string} = `, code, node.start, init.start));
      }
    }
  }
  for (const { node } of steps) {
    if ((node.id as Node).type !== 'Identifier') {
      s.prependRight(node.start, '(');
      s.appendLeft(node.end, ')');
    }
    s.appendLeft(node.end, ' })');
  }

  const kinds: Record<string, string> = {};
  for (const { names, kind } of steps) for (const name of names) kinds[name] = kind;
  const runtime = JSON.stringify(RUNTIME);
  const imported = isModule(file, parsed.module.hasModuleSyntax) ? `import * as ${ns} from ${runtime};` : `const ${ns} = require(${runtime});`;
  s.prependRight(headerAt(code, body), `${imported} const ${frame} = ${ns}.frame(${JSON.stringify(kinds)}); `);
  s.appendLeft(body.at(-1)!.end, `; ${frame}.loaded();`);
  return { code: s.toString(), map: s.generateMap({ hires: true, source: file, includeContent: true }), left };
}

/** Every top-level `let`, `var` and `const` declarator, but those marked to stay. */
function topLevel(body: readonly Node[], optedOut: (node: Node) => boolean): Declarator[] {
  const exported = exportedNames(body);
  const declarators: Declarator[] = [];
  for (const statement of body) {
    const isExport = statement.type === 'ExportNamedDeclaration';
    const declaration = isExport ? (statement.declaration as Node | null) : statement;
    if (declaration?.type !== 'VariableDeclaration' || declaration.declare === true || optedOut(statement)) continue;
    const kind = declaration.kind as string;
    if (kind !== 'let' && kind !== 'var' && kind !== 'const') continue;
    for (const node of declaration.declarations as Node[]) {
      if (optedOut(node)) continue;
      const names = [...bound(node.id as Node)];
      declarators.push({
        node,
        declaration,
        kind,
        names,
        exported: isExport || names.some((name) => exported.has(name)),
        object: heldObject(node),
        role: 'keep',
      });
    }
  }
  return declarators;
}

/** The node whose span holds a position, if any: they are in source order and never overlap. */
function within(nodes: readonly Node[]): (at: number) => Node | undefined {
  return (at) => {
    let low = 0;
    let high = nodes.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const node = nodes[mid]!;
      if (at < node.start) high = mid - 1;
      else if (at >= node.end) low = mid + 1;
      else return node;
    }
    return undefined;
  };
}

/** A function or a class, under any `as`. */
function callable(value: Node | null): boolean {
  const node = unwrap(value);
  return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression' || node?.type === 'ClassExpression';
}

/** A value no copy can tell from the one it was copied from. */
function primitive(value: Node | null): boolean {
  const node = unwrap(value);
  return node === undefined || node.type === 'Literal' || (node.type === 'TemplateLiteral' && (node.expressions as Node[]).length === 0);
}


const COPYABLE = new Set(['Map', 'Set', 'Array', 'Object']);

/** The object, array or instance a declarator's value literally is, under any `as`. */
function heldObject(declarator: Node): Held | undefined {
  if ((declarator.id as Node).type !== 'Identifier') return undefined;
  const init = unwrap(declarator.init);
  if (init?.type === 'ObjectExpression' || init?.type === 'ArrayExpression') return { node: init, copyable: true };
  if (init?.type !== 'NewExpression') return undefined;
  const callee = init.callee as Node;
  return { node: init, copyable: callee.type === 'Identifier' && COPYABLE.has(callee.name as string) };
}

/** Where, in a value, a name is that value or a part of it — what one session's copy of it copies along. */
function flows(value: Node | null | undefined, into = new Set<number>()): Set<number> {
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
function exportedNames(body: readonly Node[]): Set<string> {
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
function functionNames(body: readonly Node[]): Set<string> {
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
function importedNames(body: readonly Node[]): string[] {
  return body
    .filter((statement) => statement.type === 'ImportDeclaration' && statement.importKind !== 'type')
    .flatMap((statement) => (statement.specifiers as Node[]).filter((specifier) => specifier.importKind !== 'type'))
    .map((specifier) => (specifier.local as Node).name as string);
}

/** Whether a node `test` accepts is in a value, inside its functions too only when `deep`. */
function reaches(value: unknown, test: (node: Node) => boolean, deep: boolean): boolean {
  if (Array.isArray(value)) return value.some((item) => reaches(item, test, deep));
  if (!isNode(value)) return false;
  if (test(value)) return true;
  if (!deep && /^(?:Function(?:Expression|Declaration)|ArrowFunctionExpression|Class(?:Expression|Declaration))$/.test(value.type)) return false;
  for (const key in value) if (key !== 'type' && reaches(value[key], test, deep)) return true;
  return false;
}

/** ES module syntax, or an extension that says so; anything else is CommonJS. */
function isModule(file: string, hasModuleSyntax: boolean): boolean {
  if (/\.c[jt]s$/.test(file)) return false;
  if (/\.m[jt]s$/.test(file)) return true;
  return hasModuleSyntax;
}

/** The first line of code: after a shebang, and after the directive prologue, on the same line. */
function headerAt(code: string, body: readonly Node[]): number {
  let at = code.startsWith('#!') ? code.indexOf('\n') + 1 : 0;
  for (const statement of body) {
    if (statement.type !== 'ExpressionStatement' || typeof statement.directive !== 'string') break;
    at = statement.end;
  }
  return at;
}

/** A name the module does not spell anywhere, so it cannot collide with one of its own. */
function fresh(code: string, base: string): string {
  let name = base;
  for (let n = 1; new RegExp(`(?<![\\w$])${name.replaceAll('$', '\\$')}(?![\\w$])`).test(code); n++) name = `${base}${n}`;
  return name;
}

/** The comma that separates two declarators, skipping any comment between them. */
function commaBetween(code: string, from: number, to: number): number {
  for (let at = from; at < to; at++) {
    if (code.startsWith('/*', at)) at = code.indexOf('*/', at + 2) + 1;
    else if (code.startsWith('//', at)) at = code.indexOf('\n', at);
    else if (code[at] === ',') return at;
  }
  throw new Error(`no comma between declarators at ${from}`);
}

/** `text`, followed by as many newlines as the span it replaces held, so no line moves. */
function keepLines(text: string, code: string, start: number, end: number): string {
  const lost = countNewlines(code.slice(start, end)) - countNewlines(text);
  return lost > 0 ? text + '\n'.repeat(lost) : text;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count++;
  return count;
}

function lineStarts(code: string): number[] {
  const starts = [0];
  for (let at = code.indexOf('\n'); at !== -1; at = code.indexOf('\n', at + 1)) starts.push(at + 1);
  return starts;
}

function line(starts: readonly number[], at: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= at) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}
