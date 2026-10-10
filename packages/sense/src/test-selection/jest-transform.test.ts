import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { probeRecipe } from '../instrument/index.js';
import probeLists from '../instrument/probe-lists.cjs';
import probeLog from '../instrument/probe-log.cjs';
import { createTransformer, type JestTransformRequest, type JestTransformedSource } from './jest-transform.js';
import { deriveModules, moduleId } from './captured-modules.js';
import { sourceLines, type TransformSourceMap } from './source-lines.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function project(prefix: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  temporary.push(root);
  await mkdir(resolve(root, 'src'), { recursive: true });
  await mkdir(resolve(root, 'dist'), { recursive: true });
  await writeFile(resolve(root, 'package.json'), '{"name":"fixture","private":true}\n');
  return root;
}

function transformOptions(root: string): JestTransformRequest {
  return {
    // `rootDir` is not read here, and is what babel-jest resolves the project's Babel configuration from.
    config: { cacheDirectory: resolve(root, 'cache'), id: 'project', testMatch: [`${root}/test/*.case.js`], rootDir: root } as JestTransformRequest['config'],
    configString: '{}',
    instrument: false,
  };
}

const SOURCE = 'export function pick(value: boolean): string {\n  return value ? \'left\' : \'right\';\n}\n';
const BUILT = 'export function pick(value) {\n    return value ? \'left\' : \'right\';\n}\n//# sourceMappingURL=pick.js.map\n';
/** What `tsc` wrote beside {@link BUILT}: one source, the file it was built from. */
const MAP = { version: 3, sources: ['../src/pick.ts'], names: [], mappings: 'AAAA,MAAM,UAAU,IAAI,CAAC,KAAc;IACvC,OAAO,KAAK,CAAC,CAAC,CAAC,MAAM,CAAC,CAAC,CAAC,OAAO,CAAC;AACrC,CAAC' };

/**
 * A workspace library a test reaches through its manifest: Jest transforms
 * `dist/pick.js`, which names the map `tsc` wrote beside it. The wrapped
 * transformer hands back what it was given, so the test reads what reached it.
 */
async function built(sources: readonly string[] = MAP.sources): Promise<{ code: string; root: string }> {
  const root = await project('variance-jest-built-');
  await writeFile(resolve(root, 'src/pick.ts'), SOURCE);
  await writeFile(resolve(root, 'dist/pick.js'), BUILT);
  await writeFile(resolve(root, 'dist/pick.js.map'), JSON.stringify({ ...MAP, sources }));
  await writeFile(resolve(root, 'transformer.cjs'), 'module.exports = { process: (source) => ({ code: source }) };\n');
  const options = transformOptions(root);
  const transformer = await createTransformer({ root, transformer: resolve(root, 'transformer.cjs') });
  return { code: transformer.process!(BUILT, resolve(root, 'dist/pick.js'), options).code, root };
}

describe('the Jest transformer over a module loaded from its build', () => {
  it('places probes whose module reads under the source its map file names, which the default include accepts', async () => {
    const { code, root } = await built();

    const id = moduleId('dist/pick.js', BUILT);
    expect(code).toContain(JSON.stringify(id));
    const module = (await deriveModules(root, [id], undefined)).get(id);
    expect(module).toEqual(expect.objectContaining({ file: 'src/pick.ts', instrumented: true }));
  });

  it('leaves a bundle whose map names several sources as it arrived', async () => {
    const { code } = await built(['../src/pick.ts', '../src/other.ts']);

    expect(code).toBe(BUILT);
  });
});

/**
 * What a module does when Jest runs the text the wrapper returned: the order
 * `jest.mock` and `require` were called in, the line of the original the
 * thrown error's stack names once read back through the wrapped transformer's
 * map, and the regions the probes logged.
 */
function run(file: string, done: JestTransformedSource): { calls: string[]; line: number | undefined; entered: number } {
  const engine = probeLog.createEngine(false);
  const bucket = engine.open('');
  engine.use(bucket);
  const calls: string[] = [];
  const module = { exports: {} as { boom?: (n: number) => unknown } };
  const jest = { mock: (name: string) => calls.push(`mock ${name}`) };
  const context = createContext({
    __VA__: engine.root,
    jest,
    // babel-jest's hoisted getter reads the mock function from here.
    require: (name: string) => {
      if (name === '@jest/globals') return { jest };
      calls.push(`require ${name}`);
      return { add: (a: number, b: number) => a + b };
    },
    module,
    exports: module.exports,
  });
  runInContext(done.code, context, { filename: file });
  let stack = '';
  try {
    module.exports.boom!(2);
  } catch (error) {
    stack = String((error as Error).stack);
  }
  const [, row, column] = new RegExp(`${file.replaceAll('.', '\\.')}:(\\d+):(\\d+)`).exec(stack) ?? [];
  const map = (typeof done.map === 'string' ? JSON.parse(done.map) : done.map) as TransformSourceMap;
  const offset = done.code.split('\n').slice(0, Number(row) - 1).join('\n').length + Number(column);
  const entered = probeLists.lists(engine.read(bucket), true).flatMap((module) => module.hits).length;
  return { calls, line: sourceLines(done.code, map, file)(offset, offset)?.[0], entered };
}

describe('the project transformer after the probes', () => {
  const require = createRequire(import.meta.url);

  it('hoists a babel-jest mock above the probed module, and the stack still names the line the error was thrown on', async () => {
    const root = await project('variance-jest-babel-');
    const file = resolve(root, 'src/boom.js');
    const raw = [
      "const { add } = require('./add');",
      "jest.mock('./add');",
      '',
      'function boom(n) {',
      '  if (n > 1) {',
      "    throw new Error('boom');",
      '  }',
      '  return add(n, 1);',
      '}',
      'module.exports = { boom };',
      '',
    ].join('\n');
    const transformer = await createTransformer({
      root,
      transformer: [require.resolve('babel-jest'), { babelrc: false, configFile: false }],
    });

    const done = transformer.process!(raw, file, transformOptions(root));
    const { calls, line, entered } = run(file, done);

    expect(done.code).toContain('globalThis.__VA__');
    // babel-plugin-jest-hoist ran on the probed text and still lifted the mock above the import.
    expect(calls).toEqual(['mock ./add', 'require ./add']);
    expect(line).toBe(6);
    expect(entered).toBeGreaterThan(0);
  });

  it('runs under a transpile-only TypeScript transformer, ts-jest\'s isolated path, with the stack on the original line', async () => {
    const root = await project('variance-jest-ts-');
    const file = resolve(root, 'src/boom.ts');
    const raw = [
      "import type { Add } from './types';",
      "import { add } from './add';",
      'enum Limit { Low = 1 }',
      'export function boom(n: number): number {',
      '  if (n > Limit.Low) {',
      "    throw new Error('boom');",
      '  }',
      '  return (add as Add)(n, 1);',
      '}',
      '',
    ].join('\n');
    // `ts.transpileModule` is gone from TypeScript 7's JavaScript surface; esbuild
    // does the same file-at-a-time transpile ts-jest's isolated mode does.
    await writeFile(
      resolve(root, 'transformer.cjs'),
      `const { transformSync } = require(${JSON.stringify(require.resolve('esbuild'))});
module.exports = {
  process: (source, path) => {
    const done = transformSync(source, { loader: 'ts', format: 'cjs', sourcemap: 'external', sourcefile: path });
    return { code: done.code, map: done.map };
  },
};
`,
    );
    const transformer = await createTransformer({ root, transformer: resolve(root, 'transformer.cjs') });

    const done = transformer.process!(raw, file, transformOptions(root));
    const { calls, line, entered } = run(file, done);

    expect(done.code).toContain('globalThis.__VA__');
    expect(calls).toEqual(['require ./add']);
    expect(line).toBe(6);
    expect(entered).toBeGreaterThan(0);
  });
});

/**
 * A transformer that places sense's probes itself, as a Rust pipeline that
 * links the instrumenter crate does: it declares the recipe it was built with,
 * and is handed what to place instead of a text that already carries it.
 */
describe('a transformer that places the probes itself', () => {
  const RAW = 'export function pick(value) {\n  return value ? 1 : 2;\n}\n';

  /** A transformer that writes back what it was handed, under the recipe `recipes` gives each mode. */
  async function placing(recipes: string): Promise<string> {
    const root = await project('variance-jest-placing-');
    await writeFile(
      resolve(root, 'transformer.cjs'),
      `const recipes = ${recipes};
module.exports = {
  senseRecipe: (mode) => recipes[mode],
  process: (source, path, options) => ({ code: JSON.stringify({ source, probes: options.senseProbes ?? null }) }),
};
`,
    );
    return root;
  }
  const OURS = JSON.stringify({ presence: probeRecipe('presence'), entries: probeRecipe('entries') });

  it('is handed the module untouched, with the file to parse it as and the id its probes report', async () => {
    const root = await placing(OURS);
    const transformer = await createTransformer({ root, transformer: resolve(root, 'transformer.cjs'), mode: 'entries' });

    const done = transformer.process!(RAW, resolve(root, 'src/pick.js'), transformOptions(root));

    expect(JSON.parse(done.code)).toEqual({
      source: RAW,
      probes: { file: 'src/pick.js', module: moduleId('src/pick.js', RAW), mode: 'entries' },
    });
  });

  it('is handed the module untouched when Jest transforms asynchronously', async () => {
    const root = await placing(OURS);
    const transformer = await createTransformer({ root, transformer: resolve(root, 'transformer.cjs') });

    const done = await transformer.processAsync!(RAW, resolve(root, 'src/pick.js'), transformOptions(root));

    expect(JSON.parse(done.code)).toEqual({
      source: RAW,
      probes: { file: 'src/pick.js', module: moduleId('src/pick.js', RAW), mode: 'presence' },
    });
  });

  it('is given the probes in the text when it has no recipe for the mode', async () => {
    const root = await placing(JSON.stringify({ presence: probeRecipe('presence') }));
    const transformer = await createTransformer({ root, transformer: resolve(root, 'transformer.cjs'), mode: 'entries' });

    const done = transformer.process!(RAW, resolve(root, 'src/pick.js'), transformOptions(root));

    const handed = JSON.parse(done.code) as { source: string; probes: unknown };
    expect(handed.probes).toBeNull();
    expect(handed.source).toContain('.r("src/pick.js@');
  });

  it('is handed nothing to place in a test file', async () => {
    const root = await placing(OURS);
    const transformer = await createTransformer({ root, transformer: resolve(root, 'transformer.cjs') });

    const done = transformer.process!(RAW, resolve(root, 'test/pick.case.js'), transformOptions(root));

    expect(JSON.parse(done.code)).toEqual({ source: RAW, probes: null });
  });

  it('is refused when it was built against another instrumenter', async () => {
    const root = await placing(JSON.stringify({ presence: 'sense:instrument/presence-v4+v1:00' }));

    await expect(createTransformer({ root, transformer: resolve(root, 'transformer.cjs') })).rejects.toThrow(
      `places sense's probes as sense:instrument/presence-v4+v1:00, and this sense reads ${probeRecipe('presence')}`,
    );
  });
});

describe('a test file\'s statements', () => {
  const TEST = "it('adds', () => {\n  expect(1 + 1).toBe(2);\n});\n";

  it('are cut by default, and the cut text is cached under its own key', async () => {
    const root = await project('variance-jest-cadence-');
    const path = resolve(root, 'test/add.case.js');
    const cutting = await createTransformer({ root });
    const plain = await createTransformer({ root, cadence: false });

    expect(cutting.process!(TEST, path, transformOptions(root)).code).toContain('  __vaC(2);expect(1 + 1)');
    expect(plain.process!(TEST, path, transformOptions(root)).code).toBe(TEST);
    expect(cutting.getCacheKey!(TEST, path, transformOptions(root))).not.toBe(plain.getCacheKey!(TEST, path, transformOptions(root)));
  });

  it('reach a transformer that places the probes itself already cut', async () => {
    const root = await project('variance-jest-cadence-placing-');
    await writeFile(resolve(root, 'transformer.cjs'), `module.exports = {
  senseRecipe: (mode) => ${JSON.stringify(probeRecipe('presence'))},
  processAsync: async (source) => ({ code: source }),
};
`);
    const transformer = await createTransformer({ root, transformer: resolve(root, 'transformer.cjs') });

    const done = await transformer.processAsync!(TEST, resolve(root, 'test/add.case.js'), transformOptions(root));

    expect(done.code).toContain('  __vaC(2);expect(1 + 1)');
  });

  it('are not cut in a module that is not a test', async () => {
    const root = await project('variance-jest-cadence-module-');

    const done = (await createTransformer({ root })).process!(TEST, resolve(root, 'src/add.js'), transformOptions(root));

    expect(done.code).not.toContain('__vaC(');
  });
});
