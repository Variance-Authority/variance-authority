import { describe, expect, it } from 'vitest';
import { afterHook, type HookedPlugin } from './plugin-hooks.js';

/** A hook replaced on a resolved plugin answers what `then` makes of the plugin's own answer. */

const context = { pass: 1 };
const seen = function (this: unknown, answer: unknown, args: readonly unknown[]) {
  return { answer, args, context: this };
};

describe('afterHook', () => {
  it("hands a function hook's answer, its context and its arguments to `then`", () => {
    const plugin: HookedPlugin = { name: 'one', transform: (code: string) => `${code}!` };

    expect(afterHook(plugin, 'transform', seen)).toBe(true);

    expect((plugin.transform as Function).call(context, 'a', 'x.ts')).toEqual({ answer: 'a!', args: ['a', 'x.ts'], context });
  });

  it('keeps an object hook’s `order` and `filter`, and replaces its handler', () => {
    const filter = { id: /x/ };
    const plugin: HookedPlugin = { name: 'one', load: { order: 'pre', filter, handler: (id: string) => `load ${id}` } };

    afterHook(plugin, 'load', seen);

    const hook = plugin.load as { order: string; filter: object; handler: Function };
    expect([hook.order, hook.filter]).toEqual(['pre', filter]);
    expect(hook.handler.call(context, 'x.ts')).toEqual({ answer: 'load x.ts', args: ['x.ts'], context });
  });

  it('hands `then` what a promise settles to, and answers a promise', async () => {
    const plugin: HookedPlugin = { name: 'one', transform: async (code: string) => `${code}!` };

    afterHook(plugin, 'transform', seen);

    const answered = (plugin.transform as Function).call(context, 'a', 'x.ts');
    expect(answered).toBeInstanceOf(Promise);
    expect(await answered).toEqual({ answer: 'a!', args: ['a', 'x.ts'], context });
  });

  it('leaves a plugin without the hook as it is', () => {
    const plugin: HookedPlugin = { name: 'one' };

    expect(afterHook(plugin, 'transform', seen)).toBe(false);
    expect(plugin).toEqual({ name: 'one' });
  });
});
