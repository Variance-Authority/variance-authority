import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build, createServer, type Plugin } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveModules } from './captured-modules.js';
import { testSelectionProbes } from './probes.js';

/**
 * A build-time compiler that reads syntax, the way a CSS-in-JS extractor
 * does: `css()` takes an arrow whose body it can evaluate, a condition between
 * two strings, and anything else cannot have its styles extracted. It renames
 * the call in place, so its own map is the identity, and Vite's TypeScript
 * transform in front of it writes the map the probes are placed through.
 */
function extractor(): Plugin {
  return {
    name: 'extractor',
    transform(code, id) {
      if (!id.endsWith('.ts')) return null;
      const calls = [...code.matchAll(/\bcss\(\(([a-z]+)\) => (.*?)\);/g)];
      for (const [, , body] of calls) {
        if (!/^[a-z.]+ \? "[a-z]+" : "[a-z]+"$/.test(body!)) {
          throw new Error(`extractor: \`${body}\` is unable to have its styles extracted`);
        }
      }
      return calls.length === 0 ? null : { code: code.replaceAll('css((', 'cls(('), map: null };
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
  await writeFile(resolve(root, 'src/cls.js'), 'export const cls = (style) => style;\n');
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
    expect(code).toMatch(/cls\(\(props\) => \(__va\(\d+\),/);

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
});
