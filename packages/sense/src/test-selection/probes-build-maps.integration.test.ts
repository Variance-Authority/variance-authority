/**
 * `vite build` with no source map, its default. Vite's own `vite:define`
 * reprints a module that reads `import.meta.env` and hands its map on only
 * where the build writes maps, so the probes turn maps on for the transforms
 * and take back the `.map` files that wrote.
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { build, type BuildOptions, type Plugin } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveModules } from './captured-modules.js';
import { EXECUTION_GLOBAL, type ExecutionJournal, testSelectionProbes } from './probes.js';

// Comments ahead of the code, which `vite:define` drops, so every line under them moves.
const FLAG = [
  '// a comment',
  '/* a block',
  '   comment */',
  'export function flag(on) {',
  '  // inside',
  '  if (on) {',
  "    return import.meta.env.MODE + ' on';",
  '  }',
  "  return 'off';",
  '}',
  '',
].join('\n');

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function built(sourcemap: BuildOptions['sourcemap'], ahead: Plugin[] = []) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-build-maps-')));
  temporary.push(root);
  await mkdir(resolve(root, 'src'), { recursive: true });
  await writeFile(resolve(root, 'src/flag.js'), FLAG);
  await writeFile(resolve(root, 'src/main.js'), "import { flag } from './flag.js';\nconsole.log(flag(true));\n");
  const output = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [...ahead, testSelectionProbes({ root })],
    build: { write: false, minify: false, sourcemap, rollupOptions: { input: resolve(root, 'src/main.js') } },
  });
  const [bundle] = Array.isArray(output) ? output : [output];
  const files = 'output' in bundle! ? bundle.output : [];
  return { root, files, code: files.find((file) => file.type === 'chunk')?.code ?? '' };
}

/** Which regions of `src/flag.js` the built page entered. */
async function ran(root: string, code: string) {
  const page = createContext({ console: { log: () => undefined } });
  runInContext(code, page);
  const journal = JSON.parse(runInContext(`JSON.stringify(globalThis[${JSON.stringify(EXECUTION_GLOBAL)}].drain())`, page)) as ExecutionJournal;
  const id = /\.r\("(src\/flag\.js@[0-9a-f]{32})"/.exec(code)?.[1];
  const { blocks } = (await deriveModules(root, [id!], undefined)).get(id!)!;
  const hits = journal.modules.find((module) => module.id === id)!.hits;
  return blocks.map((block, ordinal) => [`${block.name}/${block.path}`, hits.includes(ordinal)]);
}

describe('`vite build` that writes no source map', () => {
  it('places the probes through the map `vite:define` writes once maps are on, so the branch it ran is entered', async () => {
    const { root, code } = await built(false);

    expect(await ran(root, code)).toEqual([
      ['/module', true],
      ['flag/entry', true],
      ['flag/if#0/then', true],
      ['flag/if#0/else', false],
      ['flag/if#0/after', false],
    ]);
  });

  it('writes no `.map` file and names none, as the build would without the probes', async () => {
    const { files, code } = await built(false);

    expect(files.map((file) => file.fileName).filter((name) => name.endsWith('.map'))).toEqual([]);
    expect(code).not.toMatch(/sourceMappingURL/);
  });

  it('keeps a `.map` file another plugin emits, taking out only the maps of what the build wrote', async () => {
    const emits: Plugin = {
      name: 'emits-a-map',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'other.map', source: '{}' });
      },
    };
    const { files } = await built(false, [emits]);

    expect(files.map((file) => file.fileName).filter((name) => name.endsWith('.map'))).toEqual(['other.map']);
  });

  it('keeps the maps a build writes itself', async () => {
    const { files, code } = await built(true);

    expect(files.map((file) => file.fileName).filter((name) => name.endsWith('.map'))).toHaveLength(1);
    expect(code).toMatch(/sourceMappingURL/);
  });
});
