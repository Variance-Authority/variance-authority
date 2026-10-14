import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { transformSync } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveModules } from './captured-modules.js';
import { probedAfter } from './jest-after.js';

const PRICE = 'export function price(amount: number) {\n  if (amount > 10) {\n    return 1;\n  }\n  return 2;\n}\n';
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** A project with `files` on disk. */
async function project(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-jest-after-')));
  temporary.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(resolve(root, path, '..'), { recursive: true });
    await writeFile(resolve(root, path), text);
  }
  return root;
}

describe('the probes on what a Jest transformer wrote', () => {
  it('places them through the map the transformer left only inline, and hands that map on carried onto the probed text', async () => {
    const root = await project({ 'src/price.ts': PRICE });
    const path = resolve(root, 'src/price.ts');
    const written = transformSync(PRICE, { loader: 'ts', format: 'cjs', sourcemap: 'inline', sourcefile: path });

    const done = probedAfter(root, path, PRICE, { code: written.code, map: null }, 'presence', undefined);

    expect(done?.code).toMatch(/if \(amount > 10\) \{\s*__va\(\d+\);/);
    expect(done?.code).not.toContain('sourceMappingURL');
    expect(JSON.parse(done!.map as string)).toMatchObject({ sources: [path] });
  });

  it('hands the map back as it came where the transformer wrote the file unchanged', async () => {
    const source = 'export const one = 1;\n';
    const root = await project({ 'src/one.js': source });
    const path = resolve(root, 'src/one.js');
    const map = { version: 3, sources: [path], names: [], mappings: 'AAAA' };

    const done = probedAfter(root, path, source, { code: source, map }, 'presence', undefined);

    expect(done?.code).toMatch(/\.r\("src\/one\.js@[0-9a-f]{32}"/);
    expect(JSON.parse(done!.map as string)).toEqual(map);
  });

  it('hands back what the transformer wrote, unprobed, for a module the default `include` leaves out', async () => {
    const root = await project({ 'dist/price.ts': PRICE });
    const path = resolve(root, 'dist/price.ts');
    const written = transformSync(PRICE, { loader: 'ts', format: 'cjs', sourcemap: 'external', sourcefile: path });
    const given = { code: written.code, map: written.map };

    expect(probedAfter(root, path, PRICE, given, 'presence', undefined)).toBe(given);
  });

  it('records a module built with a map of its own under the source that map names', async () => {
    const built = 'export function price(amount) {\n  return amount > 10 ? 1 : 2;\n}\n//# sourceMappingURL=price.js.map\n';
    const root = await project({
      'lib/price.js': built,
      'lib/price.js.map': JSON.stringify({ version: 3, sources: ['../src/price.ts'], names: [], mappings: 'AAAA;AACA;AACA' }),
      'src/price.ts': 'export function price(amount: number) {\n  return amount > 10 ? 1 : 2;\n}\n',
    });
    const path = resolve(root, 'lib/price.js');
    const written = transformSync(built, { loader: 'js', format: 'cjs', sourcemap: 'external', sourcefile: path });

    const done = probedAfter(root, path, built, { code: written.code, map: written.map }, 'presence', undefined);

    const id = /\.r\("(lib\/price\.js@[0-9a-f]{32})"/.exec(done!.code)![1]!;
    expect((await deriveModules(root, [id], undefined)).get(id)?.file).toBe('src/price.ts');
  });
});
