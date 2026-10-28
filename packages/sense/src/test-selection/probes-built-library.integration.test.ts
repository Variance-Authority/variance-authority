import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build, createServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveModules } from './captured-modules.js';
import { testSelectionProbes } from './probes.js';

/**
 * A workspace library an application imports through its build: `ui/dist/Button.js`,
 * which `tsc` wrote beside `Button.js.map`, leading to `ui/src/Button.ts`. The
 * texts are `tsc` 5's, verbatim. A dev server reads the map itself and hands
 * the plugin the file with its `sourceMappingURL` comment blanked; `vite build`
 * hands it the file as written. Both are recorded under the source, alike.
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

/** The module the probes in `code` name, cut again from the checkout to what a reading decides. */
async function derived(root: string, code: string | undefined) {
  const id = /\.r\("(ui\/dist\/Button\.js@[0-9a-f]{32})"/.exec(code ?? '')?.[1];
  expect(id).toBeDefined();
  const module = (await deriveModules(root, [id!], undefined)).get(id!);
  return module && {
    file: module.file,
    instrumented: module.instrumented,
    blocks: module.blocks.map((block) => [block.path, block.startLine, block.endLine]),
  };
}

describe('a library an application loads from its tsc build', () => {
  it('is recorded under its source, on the source\'s lines, by a Vite dev server and by `vite build` alike', async () => {
    const root = await workspace();
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root })],
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    let served;
    try {
      // The probes name the file the build handed them, by the text they were placed on.
      served = await derived(root, (await server.transformRequest('/ui/dist/Button.js'))?.code);
    } finally {
      await server.close();
    }

    const output = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root })],
      build: { write: false, rollupOptions: { input: resolve(root, 'app/main.js') } },
    });
    const [bundle] = Array.isArray(output) ? output : [output];
    const chunk = 'output' in bundle! ? bundle.output.find((file) => file.type === 'chunk') : undefined;

    expect(served).toMatchObject({ file: 'ui/src/Button.ts', instrumented: true });
    // `return 'off'` is line 5 of `Button.ts`, as it is of the build.
    expect(served?.blocks).toContainEqual(['if#0/after', 5, 5]);
    expect(await derived(root, chunk?.code)).toEqual(served);
  });
});
