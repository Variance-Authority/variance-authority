import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { instrument } from './index.js';
import probeLog from './probe-log.cjs';

/**
 * A parameter list that can throw while it binds carries its function's probe.
 *
 * The walk moves the parameters from the first one that can throw into an
 * object pattern over a rest parameter, and the probe into that pattern's first
 * computed key (`native/src/instrument_params.rs`). Each fixture here runs
 * with and without the probes and has to leave the same trace: arity,
 * `arguments`, where every argument lands, defaults and the scope they see,
 * the order parameters bind in, when a generator and an async function throw,
 * and what a derived constructor may touch before `super()`.
 *
 * A first parameter that is an object pattern is left as it was written:
 * Vitest, Playwright and Rstest read fixture names out of its source text.
 */

async function trace(source: string, root?: unknown): Promise<readonly unknown[]> {
  const out: unknown[] = [];
  const context = createContext({ out, done: undefined, ...(root === undefined ? {} : { __VA__: root }) });
  runInContext(source, context, { filename: 'fixture.js' });
  await (context as { done?: unknown }).done;
  return out;
}

function recorder(): { root: unknown; entered(count: number): number[] } {
  const engine = probeLog.createEngine(false);
  const bucket = engine.open('');
  engine.use(bucket);
  return {
    root: engine.root,
    entered(count) {
      const out = Array.from({ length: count }, () => 0);
      for (const list of engine.lists(engine.read(bucket), true)) {
        for (const ordinal of [...list.hits, ...list.shared]) out[ordinal] = 1;
      }
      return out;
    },
  };
}

/** A call, and what it threw: a trace entry either way. */
const CALL = `function call(f) { try { return f(); } catch (error) { return error.constructor.name; } }`;

const FIXTURES: ReadonlyArray<readonly [string, string]> = [
  [
    'arity is the count in front of the first default or rest',
    `function a({ x }) {} function b(p, { x }, q = 1, r) {} function c(p = 1, q = g()) {}
     function d(p, ...[q]) {} function e({ x }, ...rest) {} const f = async ({ x },) => x;
     out.push(a.length, b.length, c.length, d.length, e.length, f.length);`,
  ],
  [
    'every argument lands where it did, and a missing one takes its default',
    `function f(p, { x }, q = 'dq', r, ...rest) { out.push(JSON.stringify([p, x, q, r, rest])); }
     f(1, { x: 2 }); f(1, { x: 2 }, undefined, 4, 5, 6); f(1, { x: 2 }, null, 4);`,
  ],
  [
    'arguments holds what was passed, unmapped as it was',
    `function f(p, { x }) { p = 'changed'; out.push(arguments.length, arguments[0], JSON.stringify([...arguments])); }
     f('p', { x: 1 }, 'extra');`,
  ],
  [
    'a default sees this, the earlier parameters and arguments, and a later one is in its dead zone',
    `const o = { k: 'k', m(p, { x }, y = this.k + x + arguments.length) { return y; } };
     out.push(o.m(0, { x: 1 }));
     ${CALL}
     function tdz(p, { x }, a = b, b = 1) { return a; }
     out.push(call(() => tdz(0, { x: 1 })));`,
  ],
  [
    'a destructured parameter throws what it threw',
    `${CALL}
     function f({ required }) { return required; }
     const g = ({ required }) => { return required; };
     function h(p, [first] = null) { return first; }
     out.push(call(() => f()), call(() => g(null)), call(() => h(1)), f({ required: 3 }));`,
  ],
  [
    'a generator throws when it is called, before it is iterated',
    `${CALL}
     function* g(p, { limit }) { out.push('body'); yield limit; }
     out.push(call(() => g(0)));
     const it = g(0, { limit: 2 }); out.push('called'); out.push(it.next().value);`,
  ],
  [
    'an async function rejects with what binding threw',
    `async function f(p, { url }) { return url; }
     done = f(0).then(() => out.push('resolved'), (error) => out.push('rejected ' + error.constructor.name))
       .then(() => f(0, { url: 'u' })).then((url) => out.push(url));`,
  ],
  [
    'a derived constructor may not touch this before super, and binds after it can',
    `${CALL}
     class B { constructor() { this.b = 1; } }
     class C extends B { constructor(p, { a } = {}, t = this) { super(); } }
     class D extends B { constructor(p, { a }, f = () => this.b) { super(); this.v = a + f(); } }
     out.push(call(() => new C()), new D(0, { a: 1 }).v, call(() => new D()));`,
  ],
  [
    'a default closure keeps its inferred name',
    `function f(p, { x }, callback = () => {}) { return callback.name; }
     out.push(f(0, { x: 1 }));`,
  ],
];

describe('a parameter list that can throw', () => {
  it.each(FIXTURES)('%s', async (_, source) => {
    const instrumented = instrument(source, 'fixture.js');
    expect(instrumented).toBeDefined();
    expect(instrumented!.code).toContain('...{[(__va(');

    const expected = await trace(source);
    expect(await trace(instrumented!.code, recorder().root)).toEqual(expected);
  });

  it('records the function as entered when binding throws', async () => {
    const source = `try { (function f(p, { required }) { return required; })(0); } catch {}`;
    const instrumented = instrument(source, 'fixture.js')!;
    const recorded = recorder();

    await trace(instrumented.code, recorded.root);

    const function_ = instrumented.blocks.findIndex((block) => block.kind === 'function');
    expect(recorded.entered(instrumented.blocks.length)[function_]).toBe(1);
  });

  it('leaves a first parameter that is an object pattern as it was written', () => {
    const source = `const fixture = async ({ task }, use) => { await use(task); };
function helper({ name } = {}, other = name.length) { return other; }`;
    const instrumented = instrument(source, 'fixture.js')!;

    expect(instrumented.code).toContain('async ({ task }, use) =>');
    expect(instrumented.code).toContain('function helper({ name } = {}, other = name.length)');
  });
});
