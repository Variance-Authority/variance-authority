import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureResetHandler } from '@variance-authority/ioc/reset/setup';
import { isolated } from './node.js';
import * as runtime from './runtime.js';
import { addSessionSource, nextSession } from './session.js';
import { isolate } from './transform.js';

/** Evaluate a CommonJS module the way a bundler would after the transform: its exports. */
const load = <T>(code: string): T => {
  const module = { exports: {} as T };
  const require = (specifier: string): unknown => {
    if (specifier !== '@variance-authority/isolator/runtime') throw new Error(`unexpected require: ${specifier}`);
    return runtime;
  };
  new Function('require', 'module', 'exports', isolate(code, 'module.cjs').code)(require, module, module.exports);
  return module.exports;
};

const counter = () =>
  load<{ next: () => number; peek: () => number }>(
    'let count = 0;\nmodule.exports = { next: () => ++count, peek: () => count };',
  );

afterEach(() => nextSession());

describe('a variable', () => {
  it('starts every new session from the value the module was loaded with', () => {
    const { next, peek } = counter();
    nextSession();
    next();
    next();
    expect(peek()).toBe(2);
    nextSession();
    expect(peek()).toBe(0);
    expect(next()).toBe(1);
  });

  it('reads the value its own session wrote, while another session runs concurrently', async () => {
    const { next, peek } = counter();
    const tick = () => Promise.resolve();
    const run = (times: number) =>
      isolated(async () => {
        for (let n = 0; n < times; n++) {
          next();
          await tick();
        }
        return peek();
      });
    expect(await Promise.all([run(3), run(5)])).toEqual([3, 5]);
    expect(peek()).toBe(0);
  });

  it('reads the innermost isolated session, whichever copy of the Node entry started it', async () => {
    const { next, peek } = counter();
    vi.resetModules();
    const other = await import('./node.js');
    const inner = () => {
      next();
      return peek();
    };
    const outer = (start: <T>(fn: () => T) => T, within: <T>(fn: () => T) => T) =>
      start(() => {
        next();
        return within(inner);
      });
    expect([outer(isolated, other.isolated), outer(other.isolated, isolated)]).toEqual([1, 1]);
  });

  it('starts again for every test once ioc drives resets', async () => {
    // A runner evaluates its setup before the modules a test imports: so here.
    const IOC = Symbol.for('@variance-authority/ioc/reset');
    delete (globalThis as Record<symbol, unknown>)[IOC];
    const hooks: Array<() => void> = [];
    configureResetHandler((run) => hooks.push(run));
    vi.resetModules();
    await import('./session.js');
    const { next, peek } = counter();
    hooks.forEach((run) => run());
    next();
    hooks.forEach((run) => run());
    expect(peek()).toBe(0);
  });

  it('answers with the first source that has a session', () => {
    const { next, peek } = counter();
    const session = {};
    const remove = addSessionSource(() => session);
    next();
    remove();
    expect(peek()).toBe(0);
    const again = addSessionSource(() => session);
    expect(peek()).toBe(1);
    again();
  });

  it('starts every other session from what the module held when it loaded, not what the session it loaded in wrote since', () => {
    const { next, peek } = counter();
    next();
    next();
    nextSession();
    expect(peek()).toBe(0);
  });

  it('keeps what the module did to it while it loaded', () => {
    const { mode } = load<{ mode: () => string }>('let mode = "dev";\nmode = "prod";\nmodule.exports = { mode: () => mode };');
    nextSession();
    expect(mode()).toBe('prod');
  });
});

describe("a module's frame", () => {
  it('keeps one object for two names when one of them every session shares', () => {
    const { same } = load<{ same: () => boolean }>(
      'const state = { items: [] };\nconst keep = [];\nkeep.push(state.items);\nmodule.exports = { same: () => keep[0] === state.items };',
    );
    nextSession();
    expect(same()).toBe(true);
  });

  it('runs every declaration once, as the module reaches it', () => {
    const calls: string[] = [];
    (globalThis as Record<string, unknown>).record = (at: string) => calls.push(at);
    const { read } = load<{ read: () => number }>('let x = (record("x"), 1);\nlet y = (record("y"), 2);\nmodule.exports = { read: () => x + y };');
    nextSession();
    expect(read()).toBe(3);
    expect(calls).toEqual(['x', 'y']);
    delete (globalThis as Record<string, unknown>).record;
  });

  it('keeps an alias an alias of the object its session holds', () => {
    const { bump, peek } = load<{ bump: () => number; peek: () => number }>(
      'let x = { n: 0 };\nconst y = { x };\nmodule.exports = { bump: () => ++y.x.n, peek: () => x.n };',
    );
    nextSession();
    bump();
    nextSession();
    expect(bump()).toBe(1);
    expect(peek()).toBe(1);
  });

  it('keeps a let in its dead zone and a var hoisted until the declaration runs', () => {
    expect(() => load('const early = () => x;\nearly();\nlet x = 1;')).toThrow(ReferenceError);
    expect(load<{ seen: unknown }>('const early = () => x;\nconst seen = early();\nvar x = 1;\nmodule.exports = { seen };').seen).toBeUndefined();
  });

  it('refuses a write to a let inside its own initializer, as the module would', () => {
    expect(() => load('let count = (count = 1);')).toThrow(ReferenceError);
    expect(() => load('let { a = (a = 1) } = {};')).toThrow(ReferenceError);
  });

  it('refuses to assign a const, as the module would', () => {
    const { set } = load<{ set: () => void }>('const list = [];\nmodule.exports = { set: () => { list = []; } };');
    expect(set).toThrow(TypeError);
  });

  it('gives a destructuring declaration one value per session', () => {
    const { next } = load<{ next: () => number }>('let { n } = { n: 0 };\nmodule.exports = { next: () => ++n };');
    nextSession();
    next();
    nextSession();
    expect(next()).toBe(1);
  });
});

describe('an object a module holds', () => {
  const store = () =>
    load<{
      handlers: () => unknown[];
      registry: () => Map<string, { n: number }>;
      tags: () => Set<object>;
      config: () => { mode: string; nested: { on: boolean } };
      tag: object;
    }>(
      [
        'const handlers = [];',
        'handlers.push("loaded");',
        'const registry = new Map();',
        'registry.set("a", { n: 0 });',
        'const tag = {};',
        'const tags = new Set([tag]);',
        'const config = { mode: "a", nested: { on: false } };',
        'module.exports = { handlers: () => handlers, registry: () => registry, tags: () => tags, config: () => config, tag };',
      ].join('\n'),
    );

  it('holds what the module put in it while it loaded, in every session', () => {
    const { handlers, registry } = store();
    nextSession();
    expect(handlers()).toEqual(['loaded']);
    expect(registry().get('a')).toEqual({ n: 0 });
  });

  it('is a copy of its own in every session, as deep as arrays, plain objects and Map values go', () => {
    const { handlers, registry, config } = store();
    nextSession();
    handlers().push('test');
    registry().get('a')!.n = 1;
    registry().set('b', { n: 2 });
    config().nested.on = true;
    nextSession();
    expect(handlers()).toEqual(['loaded']);
    expect([...registry().entries()]).toEqual([['a', { n: 0 }]]);
    expect(config()).toEqual({ mode: 'a', nested: { on: false } });
  });

  it('shares what a Set holds and a frozen object', () => {
    const { tags, tag } = store();
    nextSession();
    expect([...tags()][0]).toBe(tag);
    const { frozen } = load<{ frozen: () => object }>('const list = [Object.freeze({ a: 1 })];\nmodule.exports = { frozen: () => list[0] };');
    const first = frozen();
    nextSession();
    expect(frozen()).toBe(first);
  });

  it('shares an instance of a class', () => {
    (globalThis as Record<string, unknown>).Box = class Box {
      n = 0;
    };
    const { box } = load<{ box: () => { n: number } }>('let box = { inner: new globalThis.Box() };\nmodule.exports = { box: () => box.inner };');
    nextSession();
    box().n = 1;
    nextSession();
    expect(box().n).toBe(1);
    delete (globalThis as Record<string, unknown>).Box;
  });

  it('keeps the symbols and holes of an array', () => {
    const { items } = load<{ items: () => unknown[] & Record<PropertyKey, unknown> }>(
      [
        'const items = [];',
        'items[Symbol.for("metadata")] = 42;',
        'items.length = 2;',
        'module.exports = { items: () => items };',
      ].join('\n'),
    );
    nextSession();
    expect(items()[Symbol.for('metadata')]).toBe(42);
    expect([items().length, 0 in items()]).toEqual([2, false]);
  });

  it('can be frozen', () => {
    const { freeze } = load<{ freeze: () => unknown }>('const config = { mode: "a" };\nmodule.exports = { freeze: () => Object.freeze(config) };');
    expect(Object.isFrozen(freeze())).toBe(true);
  });
});
