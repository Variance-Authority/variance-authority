import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { instrument } from './index.js';

/**
 * Differential execution, in miniature.
 *
 * The acceptance test for the whole transform is the repository's own suite run
 * twice, and that costs a minute. This is the same assertion at a scale that costs
 * a millisecond: evaluate a fixture with and without probes and require the
 * observable trace to be identical. Every hazard the transform can introduce — a
 * rebound `else`, a wrapped expression body that dropped its value, a synthesized
 * `default` that swallowed a fallthrough — shows up here as a difference in `out`.
 */
async function trace(source: string): Promise<readonly unknown[]> {
  const out: unknown[] = [];
  const context = realm(out);

  runInContext(source, context, { filename: 'fixture.js' });
  await (context as { done?: unknown }).done;

  return out;
}

/**
 * The globals a fixture runs against.
 *
 * `foreign` is what `page.evaluate` is: source text compiled somewhere the calling
 * module's scope does not exist. A fixture cannot use `new Function` for this —
 * `runInContext` evaluates at the context's *global* scope, so the header's
 * declarations would be globals there and a rebuilt function would find them. A
 * second context is the only faithful model, and it is also the true one: a page
 * really is a different realm.
 */
function realm(out: unknown[], extra: Record<string, unknown> = {}): object {
  return createContext({
    out,
    done: undefined,
    foreign: (source: string): unknown => runInContext(source, createContext({})),
    ...extra,
  });
}

/** The counters one evaluation set, by block ordinal. */
async function hits(source: string): Promise<Uint32Array> {
  const instrumented = instrument(source, 'fixture.js');
  expect(instrumented).toBeDefined();

  const counters = new Map<string, Uint32Array>();
  const out: unknown[] = [];
  const context = realm(out, {
    __VA__: (id: string, count: number) => {
      const held = counters.get(id) ?? new Uint32Array(count);
      counters.set(id, held);
      return held;
    },
  });

  runInContext(instrumented!.code, context, { filename: 'fixture.js' });
  await (context as { done?: unknown }).done;

  return counters.get('fixture.js') ?? new Uint32Array();
}

/** Both traces, so a fixture states its expectation once. */
async function both(source: string): Promise<readonly [readonly unknown[], readonly unknown[]]> {
  const instrumented = instrument(source, 'fixture.js');
  expect(instrumented).toBeDefined();

  return [await trace(source), await trace(instrumented!.code)];
}

const FIXTURES: ReadonlyArray<readonly [string, string]> = [
  [
    'a bare `if` whose `else` is synthesized cannot rebind a dangling one',
    `function f(a, b) { if (a) if (b) out.push('ab'); else out.push('a!b'); }
     f(1, 1); f(1, 0); f(0, 0);`,
  ],
  [
    'a bare statement body is wrapped, not left where a probe cannot go',
    `function f(n) { if (n) out.push('yes'); else out.push('no'); }
     f(1); f(0);`,
  ],
  [
    'an arrow with an expression body keeps returning it',
    `const double = (n) => n * 2;
     out.push(double(21));`,
  ],
  [
    'an arrow returning an object literal is still parenthesized correctly',
    `const make = () => ({ a: 1, b: [2, 3] });
     out.push(JSON.stringify(make()));`,
  ],
  [
    'a switch keeps its fallthrough, and a synthesized default swallows nothing',
    `function f(n) { switch (n) { case 1: case 2: out.push('low'); break; case 3: out.push('three'); } }
     f(1); f(2); f(3); f(9);`,
  ],
  [
    'a written default is not duplicated',
    `function f(n) { switch (n) { case 1: out.push(1); break; default: out.push('other'); } }
     f(1); f(2);`,
  ],
  [
    'try, catch and finally run in order and rethrow what they were given',
    `function f(bad) {
       try { if (bad) throw new Error('x'); out.push('ok'); }
       catch (error) { out.push('caught ' + error.message); }
       finally { out.push('finally'); }
     }
     f(false); f(true);`,
  ],
  [
    'a loop with a bare body still iterates',
    `for (let i = 0; i < 3; i += 1) out.push(i);
     let n = 3;
     do out.push('down ' + n); while ((n -= 1) > 0);`,
  ],
  [
    'a labelled break leaves the loop it names',
    `outer: for (const a of [1, 2]) { for (const b of [1, 2]) { if (b === 2) continue outer; out.push(a + ':' + b); } }`,
  ],
  [
    'a loop body that runs zero times leaves the code after it reachable',
    `function f(items) { for (const item of items) out.push(item); out.push('after'); }
     f([]); f(['x']);`,
  ],
  [
    'an await hands its value on unchanged, and nested awaits nest',
    `done = (async () => {
       const inner = async () => 41;
       out.push(await await Promise.resolve(inner()));
       out.push((await Promise.resolve(1)) + 1);
     })();`,
  ],
  [
    'an await inside a catch still resolves',
    `done = (async () => {
       try { await Promise.reject(new Error('no')); }
       catch (error) { out.push('caught ' + (await Promise.resolve(error.message))); }
     })();`,
  ],
  [
    'class methods, accessors and static blocks keep their bodies',
    `class K {
       static seen = [];
       static { K.seen.push('static'); }
       constructor(n) { this.n = n; }
       get twice() { return this.n * 2; }
       run() { if (this.n > 1) return 'big'; return 'small'; }
     }
     out.push(K.seen.join(''), new K(3).twice, new K(3).run(), new K(0).run());`,
  ],
  [
    'a closure passed to an array method is instrumented where it sits',
    `out.push([1, 2, 3].reduce((total, n) => total + (n > 1 ? n : 0), 0));`,
  ],
  [
    'a generator still yields in order',
    `function* count(n) { for (let i = 0; i < n; i += 1) yield i; }
     out.push([...count(3)].join(','));`,
  ],
  [
    'a directive prologue keeps its position',
    `'use strict';
     function f() { try { undeclared = 1; } catch (error) { out.push(error.constructor.name); } }
     f();`,
  ],
  [
    'an empty function body is still a region',
    `function f() {}
     const g = () => {};
     out.push(typeof f(), typeof g());`,
  ],
  [
    'a function rebuilt from its own source runs in a realm that has no runtime',
    // What `page.evaluate(fn)` does, and what `preview-fake.ts` does to prove it:
    // the *text* of a closure crosses into somewhere this module's scope does not
    // exist. Differential execution over this repository found this, in twelve
    // files, as `ReferenceError: __va is not defined`.
    `function decide(n) { if (n > 1) { return 'big'; } return 'small'; }
     const rebuilt = foreign('(' + decide.toString() + ')');
     out.push(rebuilt(3), rebuilt(0));`,
  ],
  [
    'so does an async one, whose awaits were wrapped',
    `const load = async (n) => { const got = await Promise.resolve(n); return got + 1; };
     done = (async () => {
       const rebuilt = foreign('(' + load.toString() + ')');
       out.push(await rebuilt(41));
     })();`,
  ],
];

describe('instrumented code does what the original did', () => {
  it.each(FIXTURES)('%s', async (_name, source) => {
    const [plain, probed] = await both(source);

    expect(probed).toEqual(plain);
    expect(plain.length).toBeGreaterThan(0);
  });

  it.each(FIXTURES)('%s — on the same lines', (_name, source) => {
    // Nothing emitted contains a newline, so a stack trace, a downstream source
    // map and a second coverage tool all still agree about where a statement is.
    const instrumented = instrument(source, 'fixture.js');

    expect(instrumented?.code.split('\n')).toHaveLength(source.split('\n').length);
  });

  it('runs correctly with no runtime installed at all', async () => {
    // The fallback is what makes differential execution possible: the same file,
    // twice, one of the two with nothing listening.
    const source = `function f(n) { if (n) out.push('y'); } f(1); f(0);`;
    const instrumented = instrument(source, 'fixture.js');

    expect(await trace(instrumented!.code)).toEqual(['y']);
  });
});

describe('the probes record what was entered', () => {
  it('gives a bare `if` both outcomes', async () => {
    const source = `function f(n) { if (n) out.push('y'); } f(1); f(0); f(0);`;
    const instrumented = instrument(source, 'fixture.js')!;
    const counted = await hits(source);

    const at = (path: string): number =>
      counted[instrumented.blocks.find((block) => block.path === path)!.ordinal]!;

    expect(at('if#0/then')).toBe(1);
    expect(at('if#0/else')).toBe(2);
  });

  it('counts a loop body once per iteration and its continuation once per call', async () => {
    const source = `function f(items) { for (const i of items) out.push(i); out.push('after'); }
      f([1, 2, 3]); f([]);`;
    const instrumented = instrument(source, 'fixture.js')!;
    const counted = await hits(source);

    const at = (path: string): number =>
      counted[instrumented.blocks.find((block) => block.path === path)!.ordinal]!;

    expect(at('entry')).toBe(2);
    expect(at('for#0/body')).toBe(3);
    expect(at('for#0/after')).toBe(2);
  });

  it('never fires a region no test entered', async () => {
    const source = `function f(n) { if (n > 10) out.push('big'); else out.push('small'); } f(1);`;
    const instrumented = instrument(source, 'fixture.js')!;
    const counted = await hits(source);

    const cold = instrumented.blocks.filter((block) => counted[block.ordinal] === 0);

    expect(cold.map((block) => block.path)).toEqual(['if#0/then']);
  });

  it('always makes the module its own block, at ordinal zero', async () => {
    const instrumented = instrument(`out.push(1);`, 'fixture.js')!;

    expect(instrumented.blocks[0]).toMatchObject({ ordinal: 0, kind: 'module', path: 'module' });
    expect((await hits(`out.push(1);`))[0]).toBe(1);
  });
});

describe('a source it cannot read is not a source with no blocks', () => {
  it('returns nothing rather than a partial tree', () => {
    // ADR-0008: the honest report is *not instrumented*, never *not executed*, and
    // a caller cannot tell those apart from an empty block list.
    expect(instrument(`function f( {`, 'broken.js')).toBeUndefined();
  });
});
