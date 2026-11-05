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

describe('a step ahead of the probes that changed the text a map carries for the file', () => {
  /** The function's regions sit on lines 2 to 7. Lines 1, 8 and 9 hold none. */
  const FILE = [
    'const a = 1;',
    'export function f(flag) {',
    '  if (flag) {',
    '    return a;',
    '  }',
    '  return 2;',
    '}',
    'const tail = 3;',
    'export { tail };',
    '',
  ].join('\n');
  const OFF_A_REGION = ['const a', 'const /* changed */ a'] as const;
  const BELOW_THE_REGIONS = ['const tail', 'const /* changed */ tail'] as const;
  const ON_A_REGION = ['return a', 'return /* changed */ a'] as const;

  const isFile = (id: string) => id.split('?')[0]!.endsWith('/src/a.js');

  /** A `transform` that keeps every line where it was and answers `map: null`. */
  const nulled = (from: string, to: string): Plugin => ({
    name: 'nulled',
    transform: (code, id) => (isFile(id) ? { code: code.replace(from, to), map: null } : null),
  });

  /** A `transform` that returns the map of what it wrote. */
  const mapped = (from: string, to: string): Plugin => ({
    name: 'mapped',
    transform(code, id) {
      if (!isFile(id)) return null;
      const written = new MagicString(code);
      written.replace(from, to);
      return { code: written.toString(), map: written.generateMap({ source: id, includeContent: true, hires: true }) };
    },
  });

  /** A `load` hook that answers `map: null` for the text it changed. */
  const loaded = (change: (text: string) => string): Plugin => ({
    name: 'loaded',
    enforce: 'pre',
    load: async (id) => (isFile(id) ? { code: change(await readFile(id.split('?')[0]!, 'utf8')), map: null } : null),
  });

  /** What Vite builds of `FILE` behind `plugins`, unminified, so a probe reads next to the statement it sits on. */
  async function built(...plugins: Plugin[]): Promise<string | undefined> {
    const root = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-carried-text-')));
    temporary.push(root);
    await mkdir(resolve(root, 'src'), { recursive: true });
    await writeFile(resolve(root, 'src/a.js'), FILE);
    await writeFile(resolve(root, 'src/main.js'), "import * as a from './a.js';\nconsole.log(a);\n");
    const output = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root }), ...plugins],
      build: { write: false, minify: false, rollupOptions: { input: resolve(root, 'src/main.js') } },
    });
    const [bundle] = Array.isArray(output) ? output : [output];
    return 'output' in bundle! ? bundle.output.find((file) => file.type === 'chunk')?.code : undefined;
  }

  it.each([
    ['with no step after it', [nulled(...OFF_A_REGION)]],
    ['with a second one after it', [nulled(...OFF_A_REGION), nulled(...BELOW_THE_REGIONS)]],
    ['with a step after it that wrote a map on a region', [nulled(...OFF_A_REGION), mapped('return 2', 'return 2 + 0')]],
    ['with a step after it that wrote a map off the regions', [nulled(...OFF_A_REGION), mapped(...BELOW_THE_REGIONS)]],
  ])('leaves the regions placed where `map: null` changed only lines none sits on, %s', async (_row, plugins) => {
    const code = await built(...plugins);

    expect(code).toMatch(/__va(?:\$\d+)?\(2\);\s*return a;/);
    expect(code).toMatch(/__va(?:\$\d+)?\(4\);\s*return 2/);
  });

  const CARRIES = /`src\/a\.js`: the map back to the file carries a text for it that is not the file on disk/;

  it.each([
    ['`map: null` changed a line one sits on', [nulled(...ON_A_REGION)]],
    ['`map: null` changed a line one sits on, ahead of a step that wrote a map', [nulled(...ON_A_REGION), mapped(...BELOW_THE_REGIONS)]],
    ['a `load` hook changed a line one sits on', [loaded((text) => text.replace(...ON_A_REGION))]],
    ['a `load` hook changed a line one sits on, ahead of a step that wrote a map', [loaded((text) => text.replace(...ON_A_REGION)), mapped(...BELOW_THE_REGIONS)]],
    ['a `load` hook moved lines onto them', [loaded((text) => `/* banner */\n${text}`)]],
    ['a `load` hook moved lines onto them, ahead of a step that wrote a map', [loaded((text) => `/* banner */\n${text}`), mapped(...BELOW_THE_REGIONS)]],
  ])('refuses the build where %s', async (_row, plugins) => {
    await expect(built(...plugins)).rejects.toThrow(CARRIES);
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
