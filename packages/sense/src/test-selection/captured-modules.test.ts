import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureAfter, captureModule, deriveModules, markModule, pathOf, planModule } from './captured-modules.js';
import { defaultInclude } from './instrumented-modules.js';

/** The most reads the derivation had in flight at once. */
const reading = vi.hoisted(() => ({ now: 0, most: 0 }));
vi.mock('node:fs/promises', async (actual) => {
  const fs = await actual<typeof import('node:fs/promises')>();
  return {
    ...fs,
    readFile: async (...args: Parameters<typeof fs.readFile>) => {
      reading.most = Math.max(reading.most, ++reading.now);
      try {
        return await fs.readFile(...args);
      } finally {
        reading.now -= 1;
      }
    },
  };
});

const SOURCE = 'export function total(items) {\n  return items.length > 0 ? items.length : 0;\n}\n';

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { force: true, recursive: true });
  root = undefined;
});

async function checkout(text: string): Promise<{ root: string; file: string }> {
  root = await mkdtemp(resolve(tmpdir(), 'variance-captured-'));
  const file = resolve(root, 'src-cart.js');
  await writeFile(file, text, 'utf8');
  return { root, file };
}

describe('the module the probes name', () => {
  it('names the file and the text the probes were placed on', async () => {
    const { root, file } = await checkout(SOURCE);
    const captured = captureModule(root, file, SOURCE, defaultInclude, undefined)!;

    expect(captured.module.id).toMatch(/^src-cart\.js@[0-9a-f]{32}$/);
    expect(pathOf(captured.module.id)).toBe('src-cart.js');
  });
});

describe('a module with no file on disk', () => {
  // A bundler's virtual entry — Storybook's `storybook-stories.js` — is handed
  // over under a path in the checkout that `include` accepts, and no diff is
  // ever written against it.
  it('is not probed, as a bundler hands over its virtual entry', async () => {
    const { root } = await checkout(SOURCE);
    const virtual = resolve(root, 'storybook-stories.js');

    expect(captureModule(root, virtual, SOURCE, defaultInclude, undefined)).toBeUndefined();
  });

  it('is not probed after the transforms either, whatever map arrives with it', async () => {
    const { root } = await checkout(SOURCE);
    const virtual = resolve(root, 'storybook-config-entry.js');
    const map = () => ({ sources: ['storybook-config-entry.js'], mappings: 'AAAA;AACA;AACA' });

    expect(captureAfter(root, virtual, SOURCE, defaultInclude, undefined, map)).toBeUndefined();
  });

  it('is not probed under node_modules where `include` accepts it', async () => {
    const { root } = await checkout(SOURCE);
    const virtual = resolve(root, 'node_modules', '.cache', 'storybook', 'entry.js');

    expect(captureModule(root, virtual, SOURCE, () => true, undefined)).toBeUndefined();
  });

  it('is probed under node_modules where `include` accepts it and the file is there', async () => {
    const { root } = await checkout(SOURCE);
    const vendored = resolve(root, 'node_modules', 'cart', 'index.js');
    await mkdir(resolve(root, 'node_modules', 'cart'), { recursive: true });
    await writeFile(vendored, SOURCE, 'utf8');

    expect(captureModule(root, vendored, SOURCE, () => true, undefined)).toBeDefined();
  });
});

describe('a module whose file is there and cannot be read', () => {
  it('fails after the transforms, naming the file and why: only a file that is not there is no file', async () => {
    const { root, file } = await checkout(SOURCE);
    const map = () => ({ sources: ['src-cart.js'], mappings: 'AAAA;AACA;AACA' });
    // A directory where the file was: unreadable to every user, root included.
    await rm(file);
    await mkdir(file);
    expect(() => captureAfter(root, file, SOURCE, defaultInclude, undefined, map)).toThrow(/src-cart\.js.*EISDIR/s);
  });
});

describe('a module whose probes go in after the transforms', () => {
  it('reports the id and the regions the file on disk is cut into', async () => {
    const { root, file } = await checkout(SOURCE);
    const transformed = `${SOURCE}\n`;
    // Every line to itself, from its first column.
    const map = () => ({ sources: ['src-cart.js'], mappings: 'AAAA;AACA;AACA' });
    const after = captureAfter(root, file, transformed, defaultInclude, undefined, map)!;
    const before = captureModule(root, file, SOURCE, defaultInclude, undefined)!;

    expect(after.module).toEqual(before.module);
    expect(after.code.endsWith('\n\n')).toBe(true);
  });

  it('is refused where a map with no mappings carries code written from a file with more than module code', async () => {
    const { root, file } = await checkout(SOURCE);
    const map = () => ({ sources: ['src-cart.js'], mappings: '' });

    expect(() => captureAfter(root, file, `${SOURCE}\n`, defaultInclude, undefined, map)).toThrow(
      /`src-cart\.js`: the transforms ahead of the probes rewrote the file and handed on a map with no mappings/,
    );
  });

  it('is refused where the map carries a text for the file that is not the file, though it names the file', async () => {
    const { root, file } = await checkout(SOURCE);
    // A `load` hook moved every line down one and returned no map: the map
    // that follows starts from its text, and names the file by its name.
    const loaded = `/* banner */\n${SOURCE}`;
    const map = () => ({ sources: ['src-cart.js'], sourcesContent: [loaded], mappings: 'AAAA;AACA;AACA;AACA' });

    expect(() => captureAfter(root, file, loaded, defaultInclude, undefined, map)).toThrow(
      /`src-cart\.js`: the map back to the file carries a text for it that is not the file on disk/,
    );
    const own = () => ({ sources: ['src-cart.js'], sourcesContent: [SOURCE], mappings: 'AAAA;AACA;AACA' });
    expect(captureAfter(root, file, `${SOURCE}\n`, defaultInclude, undefined, own)!.module.instrumented).toBe(true);
  });

  it('is refused where the map names no source that resolves to the file', async () => {
    const { root, file } = await checkout(SOURCE);
    const map = () => ({ sources: ['elsewhere.js'], mappings: 'AAAA;AACA;AACA' });

    expect(() => captureAfter(root, file, `${SOURCE}\n`, defaultInclude, undefined, map)).toThrow(
      /`src-cart\.js`: the transforms ahead of the probes rewrote the file and left no map back to it/,
    );
  });

  it('is refused where the transforms wrote text that cannot be parsed from a file that can', async () => {
    const { root, file } = await checkout(SOURCE);
    // A transform that left a syntax the instrumenter does not read, mapped line for line.
    const unparsed = 'export function total(items) {\n  return items.length > 0 ? items.length : 0;\n}}\n';
    const map = () => ({ sources: ['src-cart.js'], mappings: 'AAAA;AACA;AACA' });

    expect(() => captureAfter(root, file, unparsed, defaultInclude, undefined, map)).toThrow(
      /`src-cart\.js`: the transforms ahead of the probes wrote text the instrumenter cannot parse/,
    );
  });

  it('holds the probe of loading a file the instrumenter cannot parse, as the probes going in first do', async () => {
    const UNPARSED = 'export function total(items) {\n  return items.length >;\n}\n';
    const { root, file } = await checkout(UNPARSED);
    const map = () => ({ sources: ['src-cart.js'], mappings: 'AAAA;AACA;AACA' });
    const after = captureAfter(root, file, `${UNPARSED}\n`, defaultInclude, undefined, map)!;

    expect(after.module).toEqual(captureModule(root, file, UNPARSED, defaultInclude, undefined)!.module);
  });

  it('is marked as loaded where the import asked for a variant of the file no map leads back from', async () => {
    const { root, file } = await checkout(SOURCE);
    const raw = `export default ${JSON.stringify(SOURCE)};\n`;
    const after = captureAfter(root, file, raw, defaultInclude, undefined, () => ({ sources: ['src-cart.js'], sourcesContent: [raw], mappings: 'AAAA' }), {
      variant: true,
      unmapped: [{ plugin: 'vite:asset', loaded: raw }],
    })!;

    expect(after.module).toEqual(markModule(root, file, SOURCE, defaultInclude)!.module);
    expect(after.code.startsWith(raw)).toBe(true);
  });

  it('is marked as loaded on what the transforms wrote where `unprobed` names it, its map carried on', async () => {
    const { root, file } = await checkout(SOURCE);
    const compiled = `"use strict";\n${SOURCE}`;
    const mappings = ';AAAA;AACA;AACA';
    const after = captureAfter(root, file, compiled, defaultInclude, undefined, () => ({ sources: ['src-cart.js'], mappings }), {
      unprobed: (path) => path === file,
      carry: true,
    })!;

    expect(after.module).toEqual(markModule(root, file, SOURCE, defaultInclude)!.module);
    // The text runs as the transforms wrote it, and a runner no bundler composes maps for reads its lines through the map they wrote.
    expect(after.code.startsWith(compiled)).toBe(true);
    expect(after.carried).toBe(mappings);
  });

  it('holds the probe of loading a module of types, which compiles to code that maps to nothing', async () => {
    const TYPES = 'export interface Cart {\n  readonly total: number;\n}\n';
    const { root, file } = await checkout(TYPES);
    // What `@swc/jest` writes for it: the CommonJS prologue, and a map with no source.
    const compiled = '"use strict";\nObject.defineProperty(exports, "__esModule", {\n    value: true\n});\n';
    const after = captureAfter(root, file, compiled, defaultInclude, undefined, () => ({ sources: [], mappings: '' }))!;

    expect(after.module).toEqual(captureModule(root, file, TYPES, defaultInclude, undefined)!.module);
    expect(after.code).toContain(`.m(${JSON.stringify(after.module.id)});`);
  });
});

describe('a module marked as loaded', () => {
  const SCRIPT = 'function total(items) {\n  return items.length > 0 ? items.length : 0;\n}\n';

  it('keeps its text whole, so a function read from it crosses with no probe in it', async () => {
    const { root, file } = await checkout(SCRIPT);
    const marked = markModule(root, file, SCRIPT, defaultInclude)!;

    expect(marked.code!.startsWith(SCRIPT)).toBe(true);
    const total = runInNewContext(`${marked.code}\ntotal`, { __VA__: recordingRoot() }) as (items: unknown[]) => number;
    expect(runInNewContext(`(${total.toString()})([1, 2])`)).toBe(2);
  });

  it('reports itself loaded in one call, after its last line', async () => {
    const { root, file } = await checkout(SCRIPT);
    const marked = markModule(root, file, SCRIPT, defaultInclude)!;
    const fake = recordingRoot();

    runInNewContext(marked.code!, { __VA__: fake });

    expect(fake.calls).toEqual([['m', marked.module.id]]);
    expect(marked.code).toBe(`${SCRIPT}\n;globalThis.__VA__.m(${JSON.stringify(marked.module.id)});`);
  });

  it('is the module the transform would have probed, recorded as not instrumented', async () => {
    const { root, file } = await checkout(SOURCE);
    const captured = captureModule(root, file, SOURCE, defaultInclude, undefined)!;

    expect(markModule(root, file, SOURCE, defaultInclude)!.module).toEqual({
      ...captured.module,
      id: captured.module.id.replace('@', '@~'),
      instrumented: false,
      blocks: [],
    });
  });

  it('is how the loads recipe places a module, which it never probes', async () => {
    const { root, file } = await checkout(SOURCE);

    expect(captureModule(root, file, SOURCE, defaultInclude, 'loads')).toEqual(markModule(root, file, SOURCE, defaultInclude));
  });

  it('is not marked under the loads recipe when `include` refuses it', async () => {
    const { root, file } = await checkout(SOURCE);

    expect(captureModule(root, file, SOURCE, () => false, 'loads')).toBeUndefined();
  });

  it('is not marked when the predicate refuses it', async () => {
    const { root, file } = await checkout(SOURCE);

    expect(markModule(root, file, SOURCE, () => false)).toBeUndefined();
  });

  it('is not marked when it lies outside the checkout, though the predicate names it', async () => {
    const { root, file } = await checkout(SOURCE);

    expect(markModule(resolve(root, 'packages'), file, SOURCE, () => true)).toBeUndefined();
  });

  it('stays under its own name when its map names a source outside the checkout', async () => {
    // A built file in the checkout whose map points at a sibling repository's
    // source: the mark is recorded under the file that was named, never under a
    // path that leaves the checkout.
    root = await mkdtemp(resolve(tmpdir(), 'variance-captured-'));
    const checkoutRoot = resolve(root, 'repo');
    const file = resolve(checkoutRoot, 'dist', 'cart.js');
    await mkdir(resolve(checkoutRoot, 'dist'), { recursive: true });
    await mkdir(resolve(root, 'elsewhere'), { recursive: true });
    await writeFile(resolve(root, 'elsewhere', 'cart.js'), SOURCE, 'utf8');
    const built = `${SOURCE}//# sourceMappingURL=cart.js.map\n`;
    await writeFile(file, built, 'utf8');
    await writeFile(
      `${file}.map`,
      JSON.stringify({ version: 3, sources: ['../../elsewhere/cart.js'], mappings: 'AAAA;AACA;AACA' }),
      'utf8',
    );
    const unprobed = (at: string) => at === file;

    const plan = planModule(checkoutRoot, file, built, () => true, undefined, unprobed)!;

    expect(plan.marked).toBe(true);
    expect(plan.file).toBe('dist/cart.js');
  });

  it('is not instrumented when it is cut again from the checkout, though the text could carry probes', async () => {
    const { root, file } = await checkout(SCRIPT);
    const marked = markModule(root, file, SCRIPT, defaultInclude)!;

    const derived = await deriveModules(root, [marked.module.id], undefined);

    expect(derived.get(marked.module.id)).toEqual(marked.module);
  });
});

describe('a module the instrumenter cannot read', () => {
  const BROKEN = 'export const = ;\n';

  it('runs marked as loaded, so the test that loaded it still reports it', async () => {
    const { root, file } = await checkout(BROKEN);
    const captured = captureModule(root, file, BROKEN, defaultInclude, undefined)!;
    const fake = recordingRoot();

    expect(captured.module.instrumented).toBe(false);
    expect(captured.code?.startsWith(BROKEN)).toBe(true);
    runInNewContext(captured.code!.slice(BROKEN.length), { __VA__: fake });
    expect(fake.calls).toEqual([['m', captured.module.id]]);
  });

  it('is not instrumented when it is cut again from the checkout', async () => {
    const { root, file } = await checkout(BROKEN);
    const captured = captureModule(root, file, BROKEN, defaultInclude, undefined)!;

    const derived = await deriveModules(root, [captured.module.id], undefined);

    expect(derived.get(captured.module.id)).toEqual(captured.module);
  });
});

/** A probe root that writes down what a module asked of it, in order. */
function recordingRoot(): { calls: unknown[][] } & Record<string, unknown> {
  const calls: unknown[][] = [];
  return {
    calls,
    a: 0,
    s: null,
    r: (id: string, count: number) => {
      calls.push(['r', id, count]);
      return { f: new Uint8Array(count), s: new Uint8Array(count), b: 0, p: new Uint8Array([1]) };
    },
    e: () => calls.push(['e']),
    x: () => calls.push(['x']),
    g: (entry: number) => calls.push(['g', entry >>> 0]),
    m: (id: string) => calls.push(['m', id]),
  };
}

describe('a module cut again from the checkout', () => {
  it('is the module the transform cut', async () => {
    const { root, file } = await checkout(SOURCE);
    const { module } = captureModule(root, file, SOURCE, defaultInclude, undefined)!;

    const derived = await deriveModules(root, [module.id], undefined);

    expect(derived.get(module.id)).toEqual(module);
  });

  it('is not instrumented once the file has moved on since the build', async () => {
    const { root, file } = await checkout(SOURCE);
    const { module } = captureModule(root, file, SOURCE, defaultInclude, undefined)!;
    await writeFile(file, `// edited after the build\n${SOURCE}`, 'utf8');

    const derived = await deriveModules(root, [module.id], undefined);

    expect(derived.get(module.id)).toMatchObject({ file: 'src-cart.js', instrumented: false, blocks: [] });
  });

  it('is left out once the file is gone', async () => {
    const { root, file } = await checkout(SOURCE);
    const { module } = captureModule(root, file, SOURCE, defaultInclude, undefined)!;
    await rm(file);

    expect((await deriveModules(root, [module.id], undefined)).size).toBe(0);
  });

  it('is left out when its id names no text', async () => {
    const { root } = await checkout(SOURCE);

    expect((await deriveModules(root, ['src-cart.js'], undefined)).size).toBe(0);
  });

  it('reads a bounded number of files at once however many modules the journals name', async () => {
    const { root } = await checkout(SOURCE);
    const ids = Array.from({ length: 1000 }, (_, at) => `missing-${at}.js@${'0'.repeat(32)}`);
    reading.most = 0;

    await deriveModules(root, ids, undefined);

    expect(reading.most).toBeLessThanOrEqual(64);
  });

  it('throws what reading the file threw when the file is there', async () => {
    const { root } = await checkout(SOURCE);

    await expect(deriveModules(root, [`.@${'0'.repeat(32)}`], undefined)).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
