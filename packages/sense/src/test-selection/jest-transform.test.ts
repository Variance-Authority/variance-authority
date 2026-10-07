import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
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
  const entered = engine.lists(engine.read(bucket), true).flatMap((module) => module.hits).length;
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
