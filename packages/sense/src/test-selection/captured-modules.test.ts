import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureModule, deriveModules, pathOf } from './captured-modules.js';
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
