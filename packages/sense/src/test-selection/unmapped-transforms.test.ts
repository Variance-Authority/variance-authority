import { describe, expect, it, vi } from 'vitest';
import { transformsAfter, unmappedSteps, warnTransformsAfter, watchUnmapped } from './unmapped-transforms.js';

/**
 * The steps ahead of the probes that wrote a module and returned no map, as
 * the probes read them: noted on the pass's context under a dev server, and
 * by module, in the watcher's own notes, in a build.
 */

const SELF = 'variance-authority:test-selection-probes';

type Hook = (this: object, ...args: string[]) => unknown;

/** A plugin as Vite resolves it, with a `transform` that answers `answer` and a `load` that answers `loads`. */
function plugin(name: string, answer: (code: string) => unknown, loads?: unknown) {
  return {
    name,
    transform: answer as unknown,
    ...(loads === undefined ? {} : { load: (() => loads) as unknown }),
  };
}

function call(hook: unknown, context: object, ...args: string[]): unknown {
  const handler = typeof hook === 'function' ? hook : (hook as { handler: Hook }).handler;
  return (handler as Hook).call(context, ...args);
}

describe('a step that wrote a module and returned no map', () => {
  it('is noted for each build by its own watcher, so a second build in the process reads none of the first\'s', () => {
    // Two builds, each with its own plugins and its own probes, transform a
    // module of the same name: only the first one's plugin returned no map.
    const first = plugin('first-compiler', (code) => `/* first */${code}`);
    const second = plugin('second-compiler', (code) => ({ code: `/* second */${code}`, map: { mappings: 'AAAA' } }));
    const firstNotes = watchUnmapped([first], SELF, 'module');
    const secondNotes = watchUnmapped([second], SELF, 'module');

    call(first.transform, {}, 'export const a = 1;\n', '/src/a.ts');
    call(second.transform, {}, 'export const a = 1;\n', '/src/a.ts');

    expect(unmappedSteps({}, '/src/a.ts', secondNotes)).toEqual([]);
    expect(unmappedSteps({}, '/src/a.ts', firstNotes)).toEqual([{ plugin: 'first-compiler' }]);
    // Taken when read: the next transform of the module reads it afresh.
    expect(unmappedSteps({}, '/src/a.ts', firstNotes)).toEqual([]);
  });

  it('is noted for every watcher that resolved the same plugin', () => {
    const shared = plugin('shared-compiler', (code) => `/* shared */${code}`);
    const one = watchUnmapped([shared], SELF, 'module');
    const other = watchUnmapped([shared], SELF, 'module');

    call(shared.transform, {}, 'export const b = 1;\n', '/src/b.ts');

    expect(unmappedSteps({}, '/src/b.ts', one)).toEqual([{ plugin: 'shared-compiler' }]);
    expect(unmappedSteps({}, '/src/b.ts', other)).toEqual([{ plugin: 'shared-compiler' }]);
  });

  it('is noted on the pass\'s context under a dev server, once by name, with the module\'s own load notes after it', async () => {
    const compiler = { name: 'object-hook', transform: { order: 'pre', handler: async (code: string) => `${code}\n// compiled` } };
    const loader = plugin('loader', (code) => code, 'export const c = 2;\n');
    const notes = watchUnmapped([compiler, loader], SELF);
    const context = {};

    expect(compiler.transform.order).toBe('pre');
    await call(compiler.transform, context, 'export const c = 1;\n', '/src/c.ts');
    await call(compiler.transform, context, 'export const c = 1;\n', '/src/c.ts');
    call(loader.load, context, '/src/c.ts');

    expect(unmappedSteps(context, '/src/c.ts', notes)).toEqual([
      { plugin: 'object-hook' },
      { plugin: 'loader', loaded: 'export const c = 2;\n' },
    ]);
    expect(unmappedSteps({}, '/src/c.ts', notes)).toEqual([]);
  });

  it('is not noted where the plugin returned `map: null`, changed nothing, or is the probes themselves', () => {
    const declared = plugin('declares-nothing-moved', (code) => ({ code: `${code}\n`, map: null }));
    const unchanged = plugin('unchanged', (code) => code);
    const self = plugin(SELF, (code) => `/* probes */${code}`);
    const notes = watchUnmapped([declared, unchanged, self], SELF, 'module');

    call(declared.transform, {}, 'export const d = 1;\n', '/src/d.ts');
    call(unchanged.transform, {}, 'export const d = 1;\n', '/src/d.ts');
    call(self.transform, {}, 'export const d = 1;\n', '/src/d.ts');

    expect(unmappedSteps({}, '/src/d.ts', notes)).toEqual([]);
  });
});

describe('a plugin whose transform runs after the probes', () => {
  const handler = (code: string) => code;
  const plugins = [
    { name: 'ahead', transform: { order: 'post', handler } },
    { name: SELF, transform: { order: 'post', handler } },
    { name: 'post-unordered', transform: handler },
    { name: 'after-the-probes', transform: { order: 'post', handler } },
    { name: 'vite:import-analysis', transform: { order: 'post', handler } },
  ];

  it('is one ordered `post` and listed after them, which Vite runs last', () => {
    expect(transformsAfter(plugins, SELF)).toEqual(['after-the-probes']);
    expect(transformsAfter(plugins.slice(0, 1), SELF)).toEqual([]);
  });

  it('is named in a warning when the configuration resolves', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      warnTransformsAfter(plugins, SELF);
      warnTransformsAfter(plugins.slice(0, 2), SELF);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toMatch(/`after-the-probes` runs its `transform` after `variance-authority:test-selection-probes`/);
    } finally {
      warn.mockRestore();
    }
  });
});
