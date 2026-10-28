import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import MagicString from 'magic-string';
import { build, createServer, type Plugin } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveModules } from './captured-modules.js';
import { EXECUTION_GLOBAL, type ExecutionJournal, testSelectionProbes } from './probes.js';

/**
 * A build-time compiler that reads syntax, the way a CSS-in-JS extractor
 * does: `css()` takes an arrow whose body it can evaluate, a condition between
 * two strings, and anything else cannot have its styles extracted. It
 * replaces the call with one that names the class it extracted, so every
 * column after it moves, and returns its map, which Vite composes onto the
 * map of the TypeScript transform in front of it.
 */
function extractor(): Plugin {
  return {
    name: 'extractor',
    transform(code, id) {
      if (!id.endsWith('.ts')) return null;
      const calls = [...code.matchAll(/\bcss\(\(([a-z]+)\) => (.*?)\);/g)];
      if (calls.length === 0) return null;
      const written = new MagicString(code);
      for (const call of calls) {
        if (!/^[a-z.]+ \? "[a-z]+" : "[a-z]+"$/.test(call[2]!)) {
          throw new Error(`extractor: \`${call[2]}\` is unable to have its styles extracted`);
        }
        written.overwrite(call.index, call.index + 'css('.length, "cls('tone', ");
      }
      return { code: written.toString(), map: written.generateMap({ hires: true, source: id }) };
    },
  };
}

const SOURCE = [
  "import { cls } from './cls.js';",
  'export const tone = css((props: { on: boolean }) => props.on ? \'red\' : \'blue\');',
  'export function label(pressed: boolean): string {',
  '  if (pressed) return tone({ on: true });',
  '  return tone({ on: false });',
  '}',
  'export function shade(dark: boolean): string {',
  '  if (dark) return tone({ on: true });',
  '  return tone({ on: false });',
  '}',
  'declare function css<T>(style: (props: T) => string): (props: T) => string;',
  // TypeScript drops an import no value reads, and `cls` is read only once the extractor runs.
  'void cls;',
  '',
].join('\n');

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  // Real, because Vite names a module by the path it resolved to.
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-after-compilers-')));
  temporary.push(root);
  await mkdir(resolve(root, 'src'), { recursive: true });
  await writeFile(resolve(root, 'src/tone.ts'), SOURCE);
  await writeFile(resolve(root, 'src/cls.js'), 'export const cls = (_name, style) => style;\n');
  await writeFile(resolve(root, 'src/main.js'), "import { label, shade } from './tone.ts';\nconsole.log(label(true), shade(false));\n");
  return root;
}

/** The module the probes in `code` name, cut again from the checkout. */
async function derived(root: string, code: string | undefined) {
  const id = /\.r\("(src\/tone\.ts@[0-9a-f]{32})"/.exec(code ?? '')?.[1];
  expect(id).toBeDefined();
  const module = (await deriveModules(root, [id!], undefined)).get(id!);
  return module && {
    file: module.file,
    instrumented: module.instrumented,
    blocks: module.blocks.map((block) => [block.name, block.path, block.startLine, block.endLine]),
  };
}

describe('a compiler that reads the syntax it compiles', () => {
  it('compiles the file as it would unprobed, and its regions are the file\'s own, in a dev server and in `vite build`', async () => {
    const root = await workspace();
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root }), extractor()],
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    let code;
    try {
      code = (await server.transformRequest('/src/tone.ts'))?.code;
    } finally {
      await server.close();
    }
    const served = await derived(root, code);
    expect(served).toMatchObject({ file: 'src/tone.ts', instrumented: true });
    // The arrow `css()` takes is a region of its own, on line 2 of the file.
    expect(served?.blocks).toContainEqual(['css.arg0', 'entry', 2, 2]);
    // Its probe went in after the extractor read it, inside the arrow it kept.
    expect(code).toMatch(/cls\('tone', \(props\) => \(__va\(\d+\),/);

    const output = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root }), extractor()],
      build: { write: false, minify: false, rollupOptions: { input: resolve(root, 'src/main.js') } },
    });
    const [bundle] = Array.isArray(output) ? output : [output];
    const chunk = 'output' in bundle! ? bundle.output.find((file) => file.type === 'chunk') : undefined;
    expect(await derived(root, chunk?.code)).toEqual(served);
  });

  it('runs the regions the built code ran, and not the branch it skipped', async () => {
    const root = await workspace();
    const output = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root }), extractor()],
      build: { write: false, minify: false, rollupOptions: { input: resolve(root, 'src/main.js') } },
    });
    const [bundle] = Array.isArray(output) ? output : [output];
    const code = 'output' in bundle! ? bundle.output.find((file) => file.type === 'chunk')?.code : undefined;
    // `main.js` exports nothing, so its chunk is a script.
    const page = createContext({ console: { log: () => undefined } });
    runInContext(code!, page);
    const journal = JSON.parse(runInContext(`JSON.stringify(globalThis[${JSON.stringify(EXECUTION_GLOBAL)}].drain())`, page)) as ExecutionJournal;
    const id = /\.r\("(src\/tone\.ts@[0-9a-f]{32})"/.exec(code!)?.[1];
    const { blocks } = (await deriveModules(root, [id!], undefined)).get(id!)!;
    const hits = journal.modules.find((module) => module.id === id)!.hits;
    const ran = blocks.map((block, ordinal) => [`${block.name}/${block.path}`, hits.includes(ordinal)]);

    expect(ran).toEqual([
      ['/module', true],
      ['css.arg0/entry', true],
      ['label/entry', true],
      ['label/if#0/then', true],
      ['label/if#0/else', false],
      ['label/if#0/after', false],
      ['shade/entry', true],
      ['shade/if#0/then', false],
      ['shade/if#0/else', true],
      ['shade/if#0/after', true],
    ]);
  });

  it('runs after a plain `transform` at `enforce: \'post\'` listed after the probes, so the extractor reads no probe', async () => {
    const root = await workspace();
    const output = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root }), { ...extractor(), enforce: 'post' }],
      build: { write: false, minify: false, rollupOptions: { input: resolve(root, 'src/main.js') } },
    });
    const [bundle] = Array.isArray(output) ? output : [output];
    const code = 'output' in bundle! ? bundle.output.find((file) => file.type === 'chunk')?.code : undefined;
    expect(code).toMatch(/cls\(["']tone["'], \(props\) => \(__va\(\d+\),/);
  });

  it('places the probes in the file as read with `placement: \'before-transforms\'`, where the extractor reads them', async () => {
    const root = await workspace();
    await expect(build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root, placement: 'before-transforms' }), extractor()],
      build: { write: false, rollupOptions: { input: resolve(root, 'src/main.js') } },
    })).rejects.toThrow(/extractor: `[^`]*__va\([^`]*` is unable to have its styles extracted/);
  });

  it('stops the build, naming the plugin, where a transform rewrote the file and returned no map at all', async () => {
    const root = await workspace();
    // Every line moves down one, and the result carries no `map`.
    const banner: Plugin = {
      name: 'banner',
      transform: (code, id) => (id.endsWith('tone.ts') ? { code: `/* banner */\n${code}` } : null),
    };
    await expect(build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root }), extractor(), banner],
      build: { write: false, rollupOptions: { input: resolve(root, 'src/main.js') } },
    })).rejects.toThrow(/`src\/tone\.ts`: the plugin `banner` ahead of the probes rewrote the file and returned no source map/);
  });

  it('stops the build, naming the plugin, where a transform returned `map: null` and moved the file\'s lines', async () => {
    const root = await workspace();
    // `map: null` says nothing moved, and every line moves down one.
    const banner: Plugin = {
      name: 'banner',
      transform: (code, id) => (id.endsWith('tone.ts') ? { code: `/* banner */\n${code}`, map: null } : null),
    };
    await expect(build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root }), extractor(), banner],
      build: { write: false, rollupOptions: { input: resolve(root, 'src/main.js') } },
    })).rejects.toThrow(/`src\/tone\.ts`: the plugin `banner` ahead of the probes returned `map: null`, which says it moved nothing, and moved the file's lines/);
  });

  it('refuses a dev-server module a plugin rewrote without a map, naming the plugin, where Vite would read it as moving nothing', async () => {
    const root = await workspace();
    // Every line moves down one, and Vite composes the missing map as identity.
    const banner: Plugin = {
      name: 'banner',
      transform: (code, id) => (id.endsWith('tone.ts') ? { code: `/* banner */\n${code}` } : null),
    };
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root }), extractor(), banner],
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    try {
      await expect(server.transformRequest('/src/tone.ts')).rejects.toThrow(
        /`src\/tone\.ts`: the plugin `banner` ahead of the probes rewrote the file and returned no source map/,
      );
    } finally {
      await server.close();
    }
  });

  /** A `load` hook that reads the file and moves every line down one, and returns no map. */
  const loader: Plugin = {
    name: 'loader',
    enforce: 'pre',
    load: async (id) => (id.endsWith('tone.ts') ? `/* banner */\n${await readFile(id, 'utf8')}` : null),
  };

  it('stops the build, naming the plugin, where a `load` hook rewrote the file and returned no map', async () => {
    const root = await workspace();
    await expect(build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root }), extractor(), loader],
      build: { write: false, rollupOptions: { input: resolve(root, 'src/main.js') } },
    })).rejects.toThrow(/`src\/tone\.ts`: the plugin `loader` ahead of the probes rewrote the file and returned no source map/);
  });

  it('refuses a dev-server module a `load` hook rewrote without a map, naming the plugin', async () => {
    const root = await workspace();
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root }), extractor(), loader],
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    try {
      await expect(server.transformRequest('/src/tone.ts')).rejects.toThrow(
        /`src\/tone\.ts`: the plugin `loader` ahead of the probes rewrote the file and returned no source map/,
      );
    } finally {
      await server.close();
    }
  });
});

describe('a built package, a file that names its own source map', () => {
  /** A plugin that rewrites the build and returns its map, so the probes cannot simply go into the file as it is. */
  const prepend: Plugin = {
    name: 'prepend',
    transform(code, id) {
      if (!id.endsWith('lib/price.js')) return null;
      const written = new MagicString(code).prepend('const seen = 1;\n');
      return { code: written.toString(), map: written.generateMap({ hires: true, source: id }) };
    },
  };

  it('is recorded under the source its map names, in a dev server and in `vite build`', async () => {
    const root = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-after-compilers-')));
    temporary.push(root);
    await mkdir(resolve(root, 'lib'));
    await mkdir(resolve(root, 'src'));
    await writeFile(resolve(root, 'src/price.ts'), 'export function price(amount: number) {\n  return amount > 10 ? 1 : 2;\n}\n');
    await writeFile(resolve(root, 'lib/price.js'), 'export function price(amount) {\n  return amount > 10 ? 1 : 2;\n}\n//# sourceMappingURL=price.js.map\n');
    await writeFile(resolve(root, 'lib/price.js.map'), JSON.stringify({ version: 3, sources: ['../src/price.ts'], names: [], mappings: 'AAAA;AACA;AACA' }));
    await writeFile(resolve(root, 'main.js'), "import { price } from './lib/price.js';\nconsole.log(price(3));\n");
    const recorded = async (code: string | undefined) => {
      const id = /\.r\("(lib\/price\.js@[0-9a-f]{32})"/.exec(code ?? '')![1]!;
      const module = (await deriveModules(root, [id], undefined)).get(id);
      return [module?.file, module?.instrumented, module?.blocks.map((block) => [block.name, block.path, block.startLine, block.endLine])];
    };
    const expected = ['src/price.ts', true, [['', 'module', 1, 3], ['price', 'entry', 1, 3]]];

    // A dev server composes every map after the file's onto the file's own,
    // which names the source and never the file: it loads the file probed.
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root }), prepend],
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    let served;
    try {
      served = await server.transformRequest('/lib/price.js');
    } finally {
      await server.close();
    }
    expect(await recorded(served?.code)).toEqual(expected);
    // The browser's devtools still open the source.
    expect(served?.map).toMatchObject({ sources: [expect.stringMatching(/src\/price\.ts$/)] });

    // A build composes from the file's text, so its probes go in after the transforms.
    const output = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root }), prepend],
      build: { write: false, minify: false, rollupOptions: { input: resolve(root, 'main.js') } },
    });
    const [bundle] = Array.isArray(output) ? output : [output];
    const chunk = 'output' in bundle! ? bundle.output.find((file) => file.type === 'chunk') : undefined;
    expect(await recorded(chunk?.code)).toEqual(expected);
  });
});
