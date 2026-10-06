import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureModule, deriveModules, pathOf } from './captured-modules.js';
import { defaultInclude } from './instrumented-modules.js';

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
});
