/**
 * `node:test`, with each case run inside the recording's observer.
 *
 * `node-test-child.ts` points the module hooks at this file for `node:test`, so
 * `import { it } from 'node:test'` and `require('node:test')` both land here.
 * Each declaration is the real one with its body wrapped: the case's name is
 * the path of the `describe` blocks around it, taken when it is declared, and
 * the body runs inside `observer.case`. Hooks and subtests pass through, so
 * what they run is recorded against the case or file that ran them.
 * CommonJS on purpose: `require` and `import` read the same exports from it.
 */

import nodeTest = require('node:test');

/** What `node-test-child.ts` leaves for this module to find; absent outside a recording. */
const OBSERVER = Symbol.for('variance-authority.node-test.observer');
type Observer = { case<Result>(name: readonly string[], body: () => Result): Result };
const observer = (globalThis as unknown as Record<symbol, Observer | undefined>)[OBSERVER];

type Body = (...args: unknown[]) => unknown;
const path: string[] = [];

/** The body, run as a case; a `done` callback is the case's end when the body takes one. */
function observed(name: readonly string[], body: Body): Body {
  return (...args) => observer!.case(name, () => (body.length > 1
    ? new Promise((done, fail) => { void body(args[0], (error?: unknown) => (error ? fail(error) : done(undefined))); })
    : body(...args)));
}

/**
 * Rewrites the `(name, options, body)` arguments of a declaration, and the body in whichever place it stands.
 * `skip`, `only` and `todo` are declarations too, so each is wrapped the same way.
 */
function declaring(declare: (...args: unknown[]) => unknown, wrap: (name: string, body: Body) => Body) {
  const declared = (...args: unknown[]): unknown => {
    const name = typeof args[0] === 'string' ? args[0] : (args[0] as { name?: string } | undefined)?.name ?? '';
    const at = args.findIndex((argument) => typeof argument === 'function');
    if (at < 0) return declare(...args);
    const rest = [...args];
    rest[at] = wrap(name, args[at] as Body);
    return declare(...rest);
  };
  for (const member of ['skip', 'only', 'todo'] as const) {
    const modifier = (declare as unknown as Record<string, unknown>)[member];
    if (typeof modifier === 'function') {
      (declared as unknown as Record<string, unknown>)[member] = declaring(modifier.bind(declare) as never, wrap);
    }
  }
  return declared;
}

const test = declaring(nodeTest.test as never, (name, body) => observed([...path, name], body));
const suite = declaring(nodeTest.describe as never, (name, body) => (...args) => {
  path.push(name);
  try { return body(...args); } finally { path.pop(); }
});

// Outside a recording the real module is handed on as it is. Inside one, each
// export is assigned by name, which is how an `import { it }` finds it: Node
// reads a CommonJS module's names from statements of this shape. `skip`, `todo`
// and `only` are not assigned: they are already members of `test`, wrapped.
module.exports = observer === undefined ? nodeTest : test;
if (observer !== undefined) {
  module.exports.test = test;
  module.exports.it = test;
  module.exports.describe = suite;
  module.exports.suite = suite;
  module.exports.before = nodeTest.before;
  module.exports.after = nodeTest.after;
  module.exports.beforeEach = nodeTest.beforeEach;
  module.exports.afterEach = nodeTest.afterEach;
  module.exports.mock = nodeTest.mock;
  module.exports.run = nodeTest.run;
  module.exports.snapshot = (nodeTest as unknown as Record<string, unknown>).snapshot;
  // Any other export the running Node adds is carried as it is, though only by `require`.
  for (const [name, value] of Object.entries(nodeTest)) {
    if (!(name in module.exports)) (module.exports as Record<string, unknown>)[name] = value;
  }
}
