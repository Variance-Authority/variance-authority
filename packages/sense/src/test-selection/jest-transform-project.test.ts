import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTransformer, type JestTransformRequest } from './jest-transform.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function project(prefix: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  temporary.push(root);
  await writeFile(resolve(root, 'package.json'), '{"name":"fixture","private":true}\n');
  return root;
}

const transformOptions = (root: string): JestTransformRequest => ({
  config: { cacheDirectory: resolve(root, 'cache'), id: 'project', testMatch: [], rootDir: root } as JestTransformRequest['config'],
  configString: '{}',
  instrument: false,
});

describe('a class-based project transformer, as ts-jest is', () => {
  it('keeps its `this`, and is handed the options its own entry gave, never sense\'s', async () => {
    const root = await project('variance-jest-class-');
    await writeFile(
      resolve(root, 'transformer.cjs'),
      `class Transformer {
  constructor(options) { this.options = options; }
  said(options) { return JSON.stringify([this.options, options.transformerConfig]); }
  getCacheKey(source, path, options) { return this.said(options); }
  getCacheKeyAsync(source, path, options) { return Promise.resolve(this.said(options)); }
  process(source, path, options) { return { code: source + '\\n// ' + this.said(options) }; }
  processAsync(source, path, options) { return Promise.resolve(this.process(source, path, options)); }
}
module.exports = { createTransformer: (options) => new Transformer(options) };
`,
    );
    const transformer = await createTransformer({ root, transformer: [resolve(root, 'transformer.cjs'), { own: 1 }] });
    const options = { ...transformOptions(root), transformerConfig: { root } } as JestTransformRequest;
    const file = resolve(root, 'src/a.js');
    const said = '[{"own":1},{"own":1}]';
    expect(transformer.process!('export const a = 1;\n', file, options).code).toContain(`// ${said}`);
    expect((await transformer.processAsync!('export const a = 1;\n', file, options)).code).toContain(`// ${said}`);
    const [key, keyAsync] = [transformer.getCacheKey!('a', file, options), await transformer.getCacheKeyAsync!('a', file, options)];
    const [other] = [(await createTransformer({ root, transformer: [resolve(root, 'transformer.cjs'), { own: 2 }] })).getCacheKey!('a', file, options)];
    expect(new Set([key, other]).size).toBe(2);
    expect(keyAsync).toBe(key);
  });
});
