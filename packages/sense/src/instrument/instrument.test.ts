import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { walkBlocks } from './blocks.js';
import {
  EVALUATING,
  INSTRUMENTATION_ID,
  instrument,
  instrumentationId,
  instrumentModeOf,
  type ModuleId,
} from './index.js';

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
async function trace(source: string, withRuntime = false): Promise<readonly unknown[]> {
  const out: unknown[] = [];
  const context = realm(
    out,
    withRuntime ? { __VA__: (_id: ModuleId, count: number) => new Uint32Array(count) } : {},
  );

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

/** The counters one evaluation set, by block ordinal, without the evaluating bit. */
async function hits(source: string): Promise<Uint32Array> {
  return (await raw(source)).map((count) => (count & ~EVALUATING) >>> 0);
}

/** The counters as the collector sees them, evaluating bit and all. */
async function raw(source: string): Promise<Uint32Array> {
  const instrumented = instrument(source, 'fixture.js');
  expect(instrumented).toBeDefined();

  const counters = new Map<ModuleId, Uint32Array>();
  const out: unknown[] = [];
  const context = realm(out, {
    __VA__: (id: ModuleId, count: number) => {
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

  return [await trace(source), await trace(instrumented!.code, true)];
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

  it('names the situation when no collector is installed', () => {
    const source = `function f(n) { if (n) out.push('y'); } f(1); f(0);`;
    const instrumented = instrument(source, 'fixture.js');

    expect(() => runInContext(instrumented!.code, realm([]), { filename: 'fixture.js' })).toThrow(
      /fixture\.js was instrumented for test selection, but the counter factory globalThis\.__VA__/,
    );
  });

  it('calls its generated runtime without a guard', () => {
    const code = instrument(`async function f() { await Promise.resolve(1); }`, 'fixture.js')!.code;

    expect(code).toContain('__va(');
    expect(code).toContain('__vaR(');
    expect(code).not.toContain('typeof __va');
  });

  it('throws when a reconstructed function loses its injected runtime', () => {
    const source = `function decide(n) { if (n > 1) { return 'big'; } return 'small'; }
      const rebuilt = foreign('(' + decide.toString() + ')');
      rebuilt(3);`;
    const instrumented = instrument(source, 'fixture.js');

    expect(() =>
      runInContext(
        instrumented!.code,
        realm([], { __VA__: (_id: ModuleId, count: number) => new Uint32Array(count) }),
        { filename: 'fixture.js' },
      ),
    ).toThrow(/__va is not defined/);
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

  it('marks what ran while the module was evaluating, and nothing after', async () => {
    // The top level calls `f` once, and a microtask calls it again after the
    // last statement has run: the first call is every subject's, the second is
    // whoever was painted.
    const source = `function f(n) { if (n) out.push('y'); else out.push('n'); }
      f(1); done = Promise.resolve().then(() => f(0));`;
    const instrumented = instrument(source, 'fixture.js')!;
    const counted = await raw(source);
    const at = (path: string): number =>
      counted[instrumented.blocks.find((block) => block.path === path)!.ordinal]!;

    expect(at('module')).toBe(EVALUATING + 1);
    expect(at('if#0/then')).toBe(EVALUATING + 1);
    expect(at('entry')).toBe(EVALUATING + 2);
    expect(at('if#0/else')).toBe(1);
  });

  it('closes the window after the last statement, whatever follows it', () => {
    const shapes = [
      `out.push(1); // a trailing comment, with no newline after it`,
      `export default out
/* nothing after this */`,
      `export const one = 1`,
      `'use strict';`,
      `// only a comment`,
      `#!/usr/bin/env node
import x from 'y';`,
      ``,
    ];
    for (const source of shapes) {
      const code = instrument(source, 'fixture.js')!.code;
      expect(code, source).toContain(';__vaE();');
      expect(code.indexOf(';__vaE();'), source).toBeGreaterThan(code.indexOf('__va(0);'));
      expect(code.split('\n'), source).toHaveLength(source.split('\n').length);
      expect(parseSync('fixture.js', code, { sourceType: 'module' }).errors, source).toEqual([]);
    }
  });

  it('keeps marking after a module threw while evaluating', async () => {
    // The window never closed, so what runs later on this realm is shared too:
    // over-including is the direction a failed evaluation may err in.
    const source = `function f() { out.push('later'); }
      done = Promise.resolve().then(() => f());
      throw new Error('mid-evaluation');`;
    const instrumented = instrument(source, 'fixture.js')!;
    const counters = new Uint32Array(instrumented.blocks.length);
    const context = realm([], { __VA__: () => counters });

    expect(() => runInContext(instrumented.code, context, { filename: 'fixture.js' })).toThrow(
      'mid-evaluation',
    );
    await (context as { done?: unknown }).done;

    const entry = instrumented.blocks.find((block) => block.path === 'entry')!.ordinal;
    expect(counters[entry]).toBe(EVALUATING + 1);
  });

  it('makes each outcome and later decision name the arrival region that governs it', () => {
    const source = `function decide(n) {
      if (n > 0) out.push('positive');
      out.push('between');
      if (n > 10) out.push('large');
    }`;
    const blocks = instrument(source, 'fixture.js')!.blocks;
    const at = (path: string) => blocks.find((block) => block.path === path)!;

    expect(at('module').owner).toBeUndefined();
    expect(at('entry').owner).toBe(at('module').ordinal);
    expect(at('if#0/then').owner).toBe(at('entry').ordinal);
    expect(at('if#0/else').owner).toBe(at('entry').ordinal);
    expect(at('if#0/after').owner).toBe(at('entry').ordinal);
    expect(at('if#1/then').owner).toBe(at('if#0/after').ordinal);
    expect(at('if#1/else').owner).toBe(at('if#0/after').ordinal);
  });

  it('digests a precondition independently of the outcome bodies it governs', () => {
    const first = instrument(
      `function decide(n) { const ready = n > 0; if (ready) out.push('yes'); else out.push('no'); }`,
      'fixture.js',
    )!;
    const changedOutcome = instrument(
      `function decide(n) { const ready = n > 0; if (ready) out.push('YES'); else out.push('no'); }`,
      'fixture.js',
    )!;
    const changedPrecondition = instrument(
      `function decide(n) { const ready = n >= 0; if (ready) out.push('yes'); else out.push('no'); }`,
      'fixture.js',
    )!;
    const digest = (result: typeof first, path: string) =>
      result.blocks.find((block) => block.path === path)!.digest;

    expect(digest(changedOutcome, 'entry')).toBe(digest(first, 'entry'));
    expect(digest(changedOutcome, 'if#0/then')).not.toBe(digest(first, 'if#0/then'));
    expect(digest(changedPrecondition, 'entry')).not.toBe(digest(first, 'entry'));
    expect(digest(changedPrecondition, 'if#0/then')).toBe(digest(first, 'if#0/then'));
    expect(changedPrecondition.sourceDigest).not.toBe(first.sourceDigest);
    expect(changedPrecondition.instrumentation).toBe(first.instrumentation);
  });
});

describe('the entries mode records where control arrives from outside', () => {
  const entries = { mode: 'entries' } as const;

  it.each(FIXTURES)('%s', async (_name, source) => {
    const instrumented = instrument(source, 'fixture.js', 'fixture.js', entries);
    expect(instrumented).toBeDefined();

    expect(await trace(instrumented!.code, true)).toEqual(await trace(source));
  });

  it('opens a region for the module and each function, and for no decision', () => {
    const source = `export async function f(items) {
      for (const item of items) { if (item) out.push(item); else out.push('none'); }
      try { await Promise.resolve(1); } catch { out.push('caught'); }
      switch (items.length) { case 0: return; default: out.push('some'); }
      return items.map((item) => item * 2);
    }`;
    const blocks = instrument(source, 'fixture.js', 'fixture.js', entries)!.blocks;

    expect(blocks.map((block) => [block.kind, block.name, block.path])).toEqual([
      ['module', '', 'module'],
      ['function', 'f', 'entry'],
      ['function', 'f/map.arg0', 'entry'],
    ]);
    expect(blocks.map((block) => block.owner)).toEqual([undefined, 0, 1]);
  });

  it('keeps every function at the address the presence walk gives it', () => {
    const source = `function outer(n) { if (n) { return [1].map((x) => x); } return []; }
      const later = (n) => n;`;
    const address = (mode: 'presence' | 'entries'): readonly string[] =>
      instrument(source, 'fixture.js', 'fixture.js', { mode })!.blocks
        .filter((block) => block.kind === 'function')
        .map((block) => `${block.name}\0${block.path}`);

    expect(address('entries')).toEqual(address('presence'));
  });

  it('reports under an identity of its own, and names its mode by it', () => {
    const presence = instrument(`out.push(1);`, 'fixture.js')!;
    const fast = instrument(`out.push(1);`, 'fixture.js', 'fixture.js', entries)!;

    expect([presence.instrumentation, fast.instrumentation]).toEqual([INSTRUMENTATION_ID, instrumentationId('entries')]);
    expect([fast, presence].map((done) => instrumentModeOf(done.instrumentation))).toEqual(['entries', 'presence']);
    expect(instrumentModeOf('sense:instrument/nothing')).toBeUndefined();
  });
});

describe('a source it cannot read is not a source with no blocks', () => {
  it('returns nothing rather than a partial tree', () => {
    // ADR-0008: the honest report is *not instrumented*, never *not executed*, and
    // a caller cannot tell those apart from an empty block list.
    expect(instrument(`function f( {`, 'broken.js')).toBeUndefined();
  });
});

describe('the tree the parser hands over', () => {
  /**
   * Raw transfer and the default JSON round trip produce the same tree, which is
   * the entire permission for taking the fast one.
   *
   * `index.ts` asks oxc for its buffer rather than its JSON because the re-parse
   * is a third of an instrumentation pass. That is a speed decision and it is
   * only allowed to be one: a transfer that quietly dropped a field would move
   * block boundaries, and a moved boundary is a digest that says a region
   * changed when nothing did. The option is experimental upstream, so this is
   * the canary — it goes red when oxc changes what either path returns, before
   * anybody has a snapshot full of regions that never moved.
   */
  const fixture = `
    export const enum Mode { Quiet, Loud }
    export default async function* run<T extends { at: number }>(items: T[], mode: Mode = Mode.Quiet) {
      label: for (const item of items) {
        try {
          switch (item.at) {
            case 0: continue label;
            case 1n as unknown as number: break;
            default: yield <div key={item.at}>{\`\${item.at}\`}</div>;
          }
        } catch (error: unknown) {
          if (error instanceof Error) throw error; else yield null;
        } finally {
          await Promise.resolve(/x[a-z]+/giu.test(String(item.at)) ? item?.at ?? 0 : 0);
        }
      }
    }
  `;

  it('is the same tree either way it crosses', () => {
    const json = parseSync('fixture.tsx', fixture);
    const raw = parseSync('fixture.tsx', fixture, { experimentalRawTransfer: true } as never);

    expect(raw.errors).toEqual(json.errors);
    expect(raw.comments).toEqual(json.comments);
    expect(raw.program).toEqual(json.program);
  });

  it('finds the same regions in it either way', () => {
    // The tree comparison above is the general statement; this is the one that
    // matters. A platform with no buffer to read takes the slow path, and a
    // block whose extent moved between the two would be a digest that reports a
    // region changed on a machine that merely parsed it differently.
    const probes = {
      hit: (ordinal: number) => `__va(${ordinal})`,
      around: (ordinal: number) => [`__vaA(${ordinal},`, ')'] as const,
    };
    const walked = (options: object | undefined) =>
      walkBlocks(parseSync('fixture.tsx', fixture, options as never).program, fixture, probes);

    expect(walked({ experimentalRawTransfer: true }).blocks).toEqual(walked(undefined).blocks);
    expect(walked({ experimentalRawTransfer: true }).edits).toEqual(walked(undefined).edits);
  });
});
