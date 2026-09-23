/**
 * The taint every test runner implies: a mocked module is not imported.
 *
 * `vi.mock('./api')`, `jest.mock('./api')` and `sb.mock(import('./api'))` all
 * say the same thing in three spellings — the file names `./api` and the
 * runner hands it something else. The edge the scan drew from the test to
 * `api.ts` is one no execution follows, and a change to `api.ts` selects that
 * test for nothing. This reads those calls off the tree and subtracts them.
 *
 * ## The real module, loaded by name, is an import
 *
 * `jest.requireActual('./api')` and `vi.importActual('./api')` load the real
 * module wherever they are written — in the factory, in a `beforeEach` that
 * hands a mock the original implementation, anywhere in the file. Each is a
 * plus: the file imports `./api`, and a mock of `./api` in the same file cuts
 * nothing, because the run enters the real module through that call. A factory
 * taking vitest's `importOriginal` argument does the same for the module it
 * mocks, and so does a `{ spy: true }` option. A factory that loads a
 * different module (`jest.mock('./a', () => jest.requireActual('./b'))`) cuts
 * `./a` and adds `./b`, which is what runs.
 *
 * ## What is not subtracted
 *
 * A factory that is not written inside the call — an identifier, a member,
 * anything but a function literal — has a body this cannot read, and a body
 * this cannot read is assumed to reach the original; so is a factory loading
 * the real thing by a specifier that is not a string literal. `vi.doMock` and
 * `jest.doMock` replace only what is imported after they run, and the static
 * imports above them ran the real module: they are not read. `vi.unmock` and
 * `jest.unmock` restore an edge the file wrote, and the file's own row already
 * has it. A mock whose specifier is not a string literal names a module this
 * cannot see, and an edge this cannot see is kept.
 *
 * ## Which files are opened
 *
 * Test, spec and story files, setup files and anything under `.storybook/`.
 * A mock anywhere else is not read, and the edge it would have cut stays — the
 * direction to miss in. Pass `files` to widen it.
 */

// compass: variance-authority.reach

import type { ImportDiff, Node, Taint, TaintSubject } from './index.js';

export interface MockTaintOptions {
  /** The objects whose `mock` is a mock. `vi`, `jest` and `sb` by default. */
  readonly callers?: readonly string[];
  /** Which files to read. Test, spec, story, setup and Storybook files by default. */
  readonly files?: (file: string) => boolean;
}

const CALLERS = ['jest', 'sb', 'vi'];
const MOCKING = new Set(['mock']);
const ACTUAL = new Set(['importActual', 'requireActual']);

export function mockTaint(options: MockTaintOptions = {}): Taint {
  const callers = new Set(options.callers ?? CALLERS);

  return {
    name: 'mocks',
    files: options.files ?? isTestLike,
    read: (subject) => mocksIn(subject, callers),
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

function mocksIn(subject: TaintSubject, callers: ReadonlySet<string>): ImportDiff | undefined {
  // A file that neither mocks nor loads an original has nothing to say. The parse is the cost this skips.
  if (!/\.(?:mock|requireActual|importActual)\b/u.test(subject.source)) return undefined;

  const mocked: string[] = [];
  const actual = new Set<string>();
  each(subject.program(), (node) => {
    const method = methodOf(node, callers);
    if (method === undefined) return;
    const [subjectArgument, ...rest] = node.arguments as readonly Node[];
    const specifier = specifierOf(subjectArgument);
    if (specifier === undefined) return;
    if (ACTUAL.has(method)) {
      actual.add(specifier);
      return;
    }
    if (!MOCKING.has(method)) return;
    if (rest.some((argument) => opaque(argument) || spies(argument) || original(argument, callers))) {
      actual.add(specifier);
      return;
    }
    mocked.push(specifier);
  });

  const minus = mocked.filter((specifier) => !actual.has(specifier));
  const plus = [...actual];
  if (minus.length === 0 && plus.length === 0) return undefined;
  return { ...(minus.length === 0 ? {} : { minus }), ...(plus.length === 0 ? {} : { plus }) };
}

/** `mock` in `vi.mock(…)`, when `vi` is one of the callers. */
function methodOf(node: Node, callers: ReadonlySet<string>): string | undefined {
  if (node.type !== 'CallExpression') return undefined;
  const callee = node.callee as Node;
  if (callee.type !== 'MemberExpression') return undefined;
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
    return quasis.length === 1 && only !== undefined
      ? String((only.value as { cooked?: unknown }).cooked)
      : undefined;
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
 * literal is read as its own plus wherever it is written.
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
    return key?.type === 'Identifier' && String(key.name) === 'spy';
  });
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
