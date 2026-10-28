/**
 * The taint every test runner implies: a mocked module is not imported.
 *
 * `vi.mock('./api')`, `jest.mock('./api')` and `sb.mock(import('./api'))` all
 * say the same thing in three spellings — the file names `./api` and the
 * runner hands it something else. The edge the scan drew from the test to
 * `api.ts` is one no execution follows, and a change to `api.ts` selects that
 * test for nothing. This reads those calls off the tree and subtracts them.
 *
 * ## A factory replaces an import; it does not request one
 *
 * A factory loading its own target cancels the replacement: `jest.mock('./api',
 * () => jest.requireActual('./api'))` preserves an existing import and adds
 * nothing when the file never imports `./api`. The same holds for vitest's
 * `importOriginal` callback, `{ spy: true }`, and an opaque factory.
 *
 * Loading a different target in the factory cuts the mocked module and adds
 * the loaded one: `jest.mock('./api', () => require('./other'))` is minus
 * `./api`, plus `./other`. Literal `require`, `module.require`, `requireActual`
 * and `importActual` follow this rule. A `requireActual` or `importActual`
 * outside the factory is an independent real load, including a `beforeEach`
 * that restores an implementation: it remains a plus and prevents a mock of
 * that target from cutting it.
 *
 * ## What is not subtracted
 *
 * A factory that is not written inside the call — an identifier, a member,
 * anything but a function literal — has a body this cannot read, and a body
 * this cannot read preserves existing imports of the original without adding
 * one; so does a factory loading the real thing by a specifier that is not a
 * string literal. `vi.doMock` and
 * `jest.doMock` replace only what is imported after they run, and the static
 * imports above them ran the real module: they are not read. `vi.unmock` and
 * `jest.unmock` restore an edge the file wrote, and the file's own row already
 * has it. A mock whose specifier is not a string literal names a module this
 * cannot see, and an edge this cannot see is kept.
 *
 * ## Which files are asked
 *
 * Test, spec and story files, setup files and anything under `.storybook/`.
 * A mock anywhere else is not applied, and the edge it would have cut stays —
 * the direction to miss in. Pass `files` to widen it.
 *
 * ## Answered from the scan
 *
 * The module reader already holds the tree, so it reads the default callers'
 * mocks while it is there and the parse carries them ({@link mockDiff}). This
 * taint answers from that parse and opens nothing. The scan keeps written
 * imports, except a factory's same-target `require`: that forwarding call is
 * part of the replacement, not an independent request. Only a caller that
 * passes this taint sees the remaining mock cuts. A taint with its own `callers` asks a
 * question the scan did not, and reads the file.
 */

// compass: variance-authority.reach

import { codeUnitOrder } from '@variance-authority/core/segment';
import type { ImportDiff, Node, Taint } from './index.js';

export interface MockTaintOptions {
  /** The objects whose `mock` is a mock. `vi`, `jest` and `sb` by default. */
  readonly callers?: readonly string[];
  /** Which files to read. Test, spec, story, setup and Storybook files by default. */
  readonly files?: (file: string) => boolean;
}

const CALLERS = ['jest', 'sb', 'vi'];
const DEFAULT_CALLERS: ReadonlySet<string> = new Set(CALLERS);
const MOCKING = new Set(['mock']);
const ACTUAL = new Set(['importActual', 'requireActual']);

/**
 * The taint that cuts every edge a mock replaces. With no `callers` it answers
 * from what the parse recorded and opens nothing; with its own `callers` it
 * reads each file it covers.
 */
export function mockTaint(options: MockTaintOptions = {}): Taint {
  const callers = new Set(options.callers ?? CALLERS);
  const scanned = options.callers === undefined;

  return {
    name: 'mocks',
    files: options.files ?? isTestLike,
    ...(scanned ? { parsed: (parsed) => parsed.mocks } : {}),
    read: (subject) => mockDiff(subject.source, subject.program, callers),
  };
}

/** Where a mock is expected to be written. */
export function isTestLike(file: string): boolean {
  return (
    /\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(file) ||
    /(^|\/)(setup|setupTests|test-setup|vitest\.setup|jest\.setup)\.[cm]?[jt]sx?$/.test(file) ||
    /(^|\/)\.storybook\//.test(file)
  );
}

/**
 * Whether `source` may mock a module or load an original: `false` means
 * {@link mockDiff} has nothing to say, without the parse it costs.
 */
export function mayMock(source: string): boolean {
  return /\.(?:mock|requireActual|importActual)\b/u.test(source);
}

/**
 * What `source` mocks and loads for real, under `callers` — `vi`, `jest` and
 * `sb` when absent, which is what the module reader records in every parse.
 */
export function mockDiff(
  source: string,
  program: () => Node,
  callers: ReadonlySet<string> = DEFAULT_CALLERS,
): ImportDiff | undefined {
  // A file that neither mocks nor loads an original has nothing to say. The parse is the cost this skips.
  if (!mayMock(source)) return undefined;

  const mocked = new Set<string>();
  const actual = new Set<string>();
  const preserved = new Set<string>();
  const read = (node: Node, factory?: string): boolean | undefined => {
    const method = methodOf(node, callers);
    const required = factory !== undefined && requires(node);
    if (method === undefined && !required) return;
    const [subjectArgument, ...rest] = node.arguments as readonly Node[];
    const specifier = specifierOf(subjectArgument);
    if (specifier === undefined) return;
    if (required || (method !== undefined && ACTUAL.has(method))) {
      if (factory === specifier) preserved.add(specifier);
      else actual.add(specifier);
      return;
    }
    if (method === undefined || !MOCKING.has(method)) return;
    if (rest.some((argument) => opaque(argument) || spies(argument) || original(argument, callers))) preserved.add(specifier);
    else mocked.add(specifier);
    for (const [index, argument] of rest.entries()) {
      const deferred = index === 0 && ['ArrowFunctionExpression', 'FunctionExpression'].includes(argument.type);
      each(argument, (inner) => read(inner, deferred ? specifier : factory));
    }
    return false;
  };
  each(program(), read);

  // Sets, sorted by code unit: a diff is compared across the two readers that
  // write it, and neither's walk order is part of the answer.
  const minus = [...mocked].filter((specifier) => !actual.has(specifier) && !preserved.has(specifier)).sort(codeUnitOrder);
  const plus = [...actual].sort(codeUnitOrder);
  if (minus.length === 0 && plus.length === 0) return undefined;
  return { ...(minus.length === 0 ? {} : { minus }), ...(plus.length === 0 ? {} : { plus }) };
}

/** The native loader's two CommonJS spellings, only deferred under a mock factory. */
function requires(node: Node): boolean {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee as Node;
  if (callee.type === 'Identifier') return callee.name === 'require';
  if (callee.type !== 'MemberExpression' || callee.computed === true) return false;
  const object = callee.object as Node;
  const property = callee.property as Node;
  return object.type === 'Identifier' && object.name === 'module' && property.type === 'Identifier' && property.name === 'require';
}

/** `mock` in `vi.mock(…)`, when `vi` is one of the callers. */
function methodOf(node: Node, callers: ReadonlySet<string>): string | undefined {
  if (node.type !== 'CallExpression') return undefined;
  const callee = node.callee as Node;
  // `vi[mock]` names whatever `mock` holds, not a method called `mock`.
  if (callee.type !== 'MemberExpression' || callee.computed === true) return undefined;
  const object = callee.object as Node;
  const property = callee.property as Node;
  if (object.type !== 'Identifier' || !callers.has(String(object.name))) return undefined;
  return property.type === 'Identifier' ? String(property.name) : undefined;
}

/** `'./x'`, or `import('./x')` for the Storybook spelling. */
function specifierOf(node: Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (node.type === 'Literal') {
    const value = (node as { value?: unknown }).value;
    return typeof value === 'string' ? value : undefined;
  }
  if (node.type === 'TemplateLiteral') {
    const quasis = node.quasis as readonly Node[];
    const [only] = quasis;
    const cooked = quasis.length === 1 ? (only?.value as { cooked?: unknown } | undefined)?.cooked : undefined;
    return typeof cooked === 'string' ? cooked : undefined;
  }
  if (node.type === 'ImportExpression') return specifierOf(node.source as Node);

  return undefined;
}

/** A factory whose body is elsewhere: `vi.mock('./api', factory)`. */
function opaque(node: Node): boolean {
  return !['ArrowFunctionExpression', 'FunctionExpression', 'ObjectExpression', 'Literal'].includes(node.type);
}

/**
 * A factory that reaches the module it mocks: vitest's `importOriginal`, or an
 * original loaded by a specifier this cannot read. An original loaded by a
 * literal is normalized against the target of its own factory.
 */
function original(node: Node, callers: ReadonlySet<string>): boolean {
  let found = false;
  each(node, (inner) => {
    if (inner.type === 'Identifier' && String(inner.name) === 'importOriginal') found = true;
    const method = methodOf(inner, callers);
    if (method !== undefined && ACTUAL.has(method) && specifierOf((inner.arguments as readonly Node[])[0]) === undefined) found = true;
  });
  return found;
}

/** `{ spy: true }` — the original runs, wrapped. */
function spies(node: Node): boolean {
  if (node.type !== 'ObjectExpression') return false;

  return (node.properties as readonly Node[]).some((property) => {
    const key = property.key as Node | undefined;
    return property.computed !== true && key?.type === 'Identifier' && String(key.name) === 'spy';
  });
}

function each(node: Node, visit: (node: Node) => boolean | undefined | void): void {
  if (visit(node) === false) return;
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
