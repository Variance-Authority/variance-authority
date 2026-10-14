import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import MagicString from 'magic-string';
import { build, createServer, type Plugin } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveModules } from './captured-modules.js';
import { testSelectionProbes } from './probes.js';

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
  'declare function css<T>(style: (props: T) => string): (props: T) => string;',
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
  await writeFile(resolve(root, 'src/main.js'), "import { label } from './tone.ts';\nconsole.log(label(true));\n");
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

  it('stops the build, naming each region, where what a transform wrote has no map back to the file', async () => {
    const root = await workspace();
    const blind: Plugin = {
      name: 'blind',
      transform: (code, id) => (id.endsWith('tone.ts') ? { code: `${code}\n`, map: { mappings: '' } } : null),
    };
    await expect(build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root }), extractor(), blind],
      build: { write: false, rollupOptions: { input: resolve(root, 'src/main.js') } },
    })).rejects.toThrow(/`src\/tone\.ts`: .* back to css\.arg0\/entry, label\/entry, /);
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
});
