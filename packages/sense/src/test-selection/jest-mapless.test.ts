import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTransformer, type JestTransformRequest } from './jest-transform.js';
import { sourceLines, type TransformSourceMap } from './source-lines.js';

const temporary: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** A project whose Jest transformer rewrites every module and returns no map, counting what it was handed. */
async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-jest-mapless-'));
  temporary.push(root);
  await mkdir(resolve(root, 'src'), { recursive: true });
  await writeFile(resolve(root, 'package.json'), '{"name":"fixture","private":true}\n');
  await writeFile(
    resolve(root, 'mapless.cjs'),
    `module.exports = {
  handed: [],
  process(source) {
    module.exports.handed.push(source);
    return { code: '"use strict";\\n' + source.replace(/^export /gm, '') };
  },
};
`,
  );
  return root;
}

function transformOptions(root: string): JestTransformRequest {
  return {
    config: { cacheDirectory: resolve(root, 'cache'), id: 'project', testMatch: [`${root}/test/*.case.js`], rootDir: root } as JestTransformRequest['config'],
    configString: '{}',
    instrument: false,
  };
}

describe('a Jest transformer that returns no map', () => {
  it('runs again on the probed module and says so once, naming the transformer and what a syntax-reading compiler needs', async () => {
    const root = await project();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const path = resolve(root, 'mapless.cjs');
    const transformer = await createTransformer({ root, transformer: path });

    const first = transformer.process!('export function a(on) {\n  return on ? 1 : 2;\n}\n', resolve(root, 'src/a.js'), transformOptions(root));
    transformer.process!('export function b(on) {\n  return on ? 3 : 4;\n}\n', resolve(root, 'src/b.js'), transformOptions(root));

    // The probes went in first, so the module still records.
    expect(first.code).toContain('globalThis.__VA__');
    // Each module was transformed twice: as written, then probed.
    const { handed } = createRequire(import.meta.url)(path) as { handed: string[] };
    expect(handed).toHaveLength(4);
    expect(handed[1]).toContain('__va(');
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toContain(`\`${path}\` returned no source map back to \`src/a.js\``);
    expect(message).toContain('transforms each such module twice');
    expect(message).toContain('A compiler that reads syntax');
    expect(message).toContain('return a source map');
  });
});

/** A transformer in `root` that runs esbuild with `options`, an object literal's text, and returns its map. */
async function esbuild(root: string, options: string): Promise<string> {
  const require = createRequire(import.meta.url);
  const path = resolve(root, 'esbuild.cjs');
  await writeFile(
    path,
    `const { transformSync } = require(${JSON.stringify(require.resolve('esbuild'))});
module.exports = {
  handed: [],
  process: (source, path) => {
    module.exports.handed.push(source);
    const done = transformSync(source, { loader: 'ts', format: 'cjs', sourcefile: path, ...${options} });
    return { code: done.code, map: done.map || null };
  },
};
`,
  );
  return path;
}

describe('a Jest transformer whose map leads back to another file', () => {
  it('runs again on the probed module, as one with no map does, and says so', async () => {
    const root = await project();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const path = await esbuild(root, "{ sourcemap: 'external', sourcefile: 'elsewhere.ts' }");
    const transformer = await createTransformer({ root, transformer: path });

    const done = transformer.process!('export function a(on: boolean) {\n  return on ? 1 : 2;\n}\n', resolve(root, 'src/a.ts'), transformOptions(root));

    expect(done.code).toContain('globalThis.__VA__');
    const { handed } = createRequire(import.meta.url)(path) as { handed: string[] };
    expect(handed).toHaveLength(2);
    expect(handed[1]).toContain('__va(');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('returned no source map back to `src/a.ts`');
  });
});

describe('a Jest transformer that returns its map and leaves it inline too', () => {
  it('hands Jest the map it returned, carried onto the probed text, and drops the inline one, which names the text before the probes', async () => {
    const root = await project();
    const file = resolve(root, 'src/boom.ts');
    const transformer = await createTransformer({ root, transformer: await esbuild(root, "{ sourcemap: 'both' }") });

    const done = transformer.process!("export function boom(n: number): number {\n  if (n > 1) {\n    throw new Error('boom');\n  }\n  return n;\n}\n", file, transformOptions(root));

    expect(done.code).toContain('__va(');
    expect(done.code).not.toContain('sourceMappingURL');
    const map = (typeof done.map === 'string' ? JSON.parse(done.map) : done.map) as TransformSourceMap;
    const offset = done.code.indexOf('throw');
    expect(sourceLines(done.code, map, file)(offset, offset)?.[0]).toBe(3);
  });
});

describe('a module whose probes header sits on a line of its own', () => {
  it('hands Jest the transformer\'s map carried onto the probed text, so a line still names the line written', async () => {
    const root = await project();
    const require = createRequire(import.meta.url);
    await writeFile(
      resolve(root, 'esbuild.cjs'),
      `const { transformSync } = require(${JSON.stringify(require.resolve('esbuild'))});
module.exports = {
  process: (source, path) => {
    const done = transformSync(source, { loader: 'ts', format: 'cjs', sourcemap: 'external', sourcefile: path });
    return { code: done.code, map: done.map };
  },
};
`,
    );
    // Only a hashbang in front of the code: the header goes on the line after it.
    const raw = "#!/usr/bin/env node\nexport function boom(n: number): number {\n  if (n > 1) {\n    throw new Error('boom');\n  }\n  return n;\n}\n";
    const file = resolve(root, 'src/boom.ts');
    const transformer = await createTransformer({ root, transformer: resolve(root, 'esbuild.cjs') });

    const done = transformer.process!(raw, file, transformOptions(root));

    expect(done.code.split('\n')[0]).toBe('#!/usr/bin/env node');
    expect(done.code.split('\n')[1]).toContain('globalThis.__VA__');
    expect(done.map).not.toBeNull();
    const map = (typeof done.map === 'string' ? JSON.parse(done.map) : done.map) as TransformSourceMap;
    const offset = done.code.indexOf('throw');
    expect(sourceLines(done.code, map, file)(offset, offset)?.[0]).toBe(4);
  });
});

describe('a Jest transformer over a built package, a file that names its own source map', () => {
  const BUILT = "export function pick(value) {\n  return value ? 'left' : 'right';\n}\n//# sourceMappingURL=pick.js.map\n";

  /**
   * A package built from `src/pick.ts`, and a transformer that prepends a line
   * and returns a map: back to the file it was handed, or, with `composes`,
   * composed onto the build's map, as a transformer that reads that map does.
   */
  async function built(composes: boolean): Promise<{ root: string; path: string; done: string; handed: string[] }> {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-jest-built-after-'));
    temporary.push(root);
    await mkdir(resolve(root, 'src'), { recursive: true });
    await mkdir(resolve(root, 'dist'), { recursive: true });
    await writeFile(resolve(root, 'package.json'), '{"name":"fixture","private":true}\n');
    await writeFile(resolve(root, 'src/pick.ts'), "export function pick(value: boolean): string {\n  return value ? 'left' : 'right';\n}\n");
    await writeFile(resolve(root, 'dist/pick.js'), BUILT);
    await writeFile(resolve(root, 'dist/pick.js.map'), JSON.stringify({ version: 3, sources: ['../src/pick.ts'], names: [], mappings: 'AAAA;AACA;AACA' }));
    const transformer = resolve(root, `prepend-${composes}.cjs`);
    await writeFile(
      transformer,
      `module.exports = {
  handed: [],
  process(source) {
    module.exports.handed.push(source);
    const lines = source.split('\\n').map((_, index) => (index === 0 ? 'AAAA' : 'AACA'));
    return {
      code: "'use strict';\\n" + source,
      map: { version: 3, sources: [${JSON.stringify(composes ? '../src/pick.ts' : 'pick.js')}], names: [], mappings: ';' + lines.join(';') },
    };
  },
};
`,
    );
    const path = resolve(root, 'dist/pick.js');
    const done = (await createTransformer({ root, transformer })).process!(BUILT, path, transformOptions(root)).code;
    return { root, path, done, handed: (createRequire(import.meta.url)(transformer) as { handed: string[] }).handed };
  }

  it('places the probes in what the transformer wrote where its map leads back to the file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { done, handed } = await built(false);

    // Transformed once, as the build wrote it: no probe for a compiler to read.
    expect(handed).toEqual([BUILT]);
    expect(done).toContain('globalThis.__VA__');
    expect(done).toContain('__va(');
    expect(warn).not.toHaveBeenCalled();
  });

  it('probes the file first, unwarned, where the transformer composed the build\'s map and answers in its sources', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { done, handed } = await built(true);

    expect(handed).toHaveLength(2);
    expect(handed[1]).toContain('__va(');
    expect(done).toContain('globalThis.__VA__');
    expect(warn).not.toHaveBeenCalled();
  });
});
