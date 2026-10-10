import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVALUATING } from '../instrument/index.js';
import { captureModule, deriveModules, markModule, pathOf, planModule } from './captured-modules.js';
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

describe('a module marked as loaded', () => {
  const SCRIPT = 'function total(items) {\n  return items.length > 0 ? items.length : 0;\n}\n';

  it('keeps its text whole, so a function read from it crosses with no probe in it', async () => {
    const { root, file } = await checkout(SCRIPT);
    const marked = markModule(root, file, SCRIPT, defaultInclude)!;

    expect(marked.code!.startsWith(SCRIPT)).toBe(true);
    const total = runInNewContext(`${marked.code}\ntotal`, { __VA__: recordingRoot() }) as (items: unknown[]) => number;
    expect(runInNewContext(`(${total.toString()})([1, 2])`)).toBe(2);
  });

  it('reports its own region once, as entered while it evaluated', async () => {
    const { root, file } = await checkout(SCRIPT);
    const marked = markModule(root, file, SCRIPT, defaultInclude)!;
    const fake = recordingRoot();

    runInNewContext(marked.code!, { __VA__: fake });

    expect(fake.calls).toEqual([['r', marked.module.id, 1], ['e'], ['g', EVALUATING >>> 0], ['x']]);
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
    expect(fake.calls).toEqual([['r', captured.module.id, 1], ['e'], ['g', EVALUATING >>> 0], ['x']]);
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
