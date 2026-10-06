import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build, createServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { readRecord, recordStore } from './instrumented-modules.js';
import { testSelectionProbes } from './probes.js';

/**
 * A workspace library an application imports through its build: `ui/dist/Button.js`,
 * which `tsc` wrote beside `Button.js.map`, leading to `ui/src/Button.ts`. The
 * texts are `tsc` 5's, verbatim. Vite is the host, and what it hands the
 * plugin's `getCombinedSourcemap` decides which file the module is named after.
 */
const SOURCE = "export function label(pressed: boolean): string {\n  if (pressed) {\n    return 'on';\n  }\n  return 'off';\n}\n";
const BUILT = "export function label(pressed) {\n    if (pressed) {\n        return 'on';\n    }\n    return 'off';\n}\n//# sourceMappingURL=Button.js.map";
const MAP = {
  version: 3,
  file: 'Button.js',
  sourceRoot: '',
  sources: ['../src/Button.ts'],
  names: [],
  mappings: 'AAAA,MAAM,UAAU,KAAK,CAAC,OAAgB;IACpC,IAAI,OAAO,EAAE,CAAC;QACZ,OAAO,IAAI,CAAC;IACd,CAAC;IACD,OAAO,KAAK,CAAC;AACf,CAAC',
};

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  // Real, because Vite names a module by the path it resolved to.
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-built-library-')));
  temporary.push(root);
  await mkdir(resolve(root, 'ui/src'), { recursive: true });
  await mkdir(resolve(root, 'ui/dist'), { recursive: true });
  await mkdir(resolve(root, 'app'), { recursive: true });
  await writeFile(resolve(root, 'ui/src/Button.ts'), SOURCE);
  await writeFile(resolve(root, 'ui/dist/Button.js'), BUILT);
  await writeFile(resolve(root, 'ui/dist/Button.js.map'), JSON.stringify(MAP));
  await writeFile(resolve(root, 'app/main.js'), "import { label } from '../ui/dist/Button.js';\nconsole.log(label(true));\n");
  return root;
}

describe('a library an application loads from its tsc build', () => {
  it('is instrumented under its source by a Vite dev server, which reads the build\'s own map', async () => {
    const root = await workspace();
    const cacheRoot = resolve(root, 'cache');
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root, cacheRoot })],
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    try {
      const done = await server.transformRequest('/ui/dist/Button.js');

      expect(done?.code).toContain('.r("ui/src/Button.ts",');
      expect(await readRecord(recordStore(root, 'build', cacheRoot), 'ui/src/Button.ts'))
        .toMatchObject({ file: 'ui/src/Button.ts', instrumented: true });
    } finally {
      await server.close();
    }
  });

  // What `vite build` 6.4 hands the plugin for the built file is an identity
  // map of the file itself: Rollup reads no `sourceMappingURL`, so nothing leads
  // back to the source, and the default include refuses the build by its name.
  it('is left out by `vite build`, which hands the plugin no map back to its source', async () => {
    const root = await workspace();
    const cacheRoot = resolve(root, 'cache');
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root, cacheRoot })],
      build: { write: false, rollupOptions: { input: resolve(root, 'app/main.js') } },
    });

    expect(await readRecord(recordStore(root, 'build', cacheRoot), 'ui/src/Button.ts')).toBeUndefined();
  });

  it.todo('is instrumented under its source by `vite build` — needs the build\'s own `.js.map` in the chain `getCombinedSourcemap` answers from, which Rollup never loads');
});
