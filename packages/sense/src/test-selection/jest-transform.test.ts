import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTransformer, type JestTransformRequest } from './jest-transform.js';
import { jestStore } from './jest.js';
import { readRecord } from './instrumented-modules.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const SOURCE = 'export function pick(value: boolean): string {\n  return value ? \'left\' : \'right\';\n}\n';
const BUILT = 'export function pick(value) {\n    return value ? \'left\' : \'right\';\n}\n//# sourceMappingURL=pick.js.map\n';
/** What `tsc` wrote beside {@link BUILT}: one source, the file it was built from. */
const MAP = { version: 3, sources: ['../src/pick.ts'], names: [], mappings: 'AAAA,MAAM,UAAU,IAAI,CAAC,KAAc;IACvC,OAAO,KAAK,CAAC,CAAC,CAAC,MAAM,CAAC,CAAC,CAAC,OAAO,CAAC;AACrC,CAAC' };

/**
 * A workspace library a test reaches through its manifest: Jest transforms
 * `dist/pick.js`, and the wrapped transformer hands back the map that leads to
 * `src/pick.ts`, the way Babel does when it reads a build's own map.
 */
async function built(sources: readonly string[] = MAP.sources): Promise<{ root: string; code: string; options: JestTransformRequest }> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-jest-built-'));
  temporary.push(root);
  await mkdir(resolve(root, 'src'), { recursive: true });
  await mkdir(resolve(root, 'dist'), { recursive: true });
  await writeFile(resolve(root, 'package.json'), '{"name":"fixture","private":true}\n');
  await writeFile(resolve(root, 'src/pick.ts'), SOURCE);
  await writeFile(
    resolve(root, 'transformer.cjs'),
    `module.exports = { process: (source) => ({ code: source, map: ${JSON.stringify({ ...MAP, sources })} }) };\n`,
  );
  const options: JestTransformRequest = {
    config: { cacheDirectory: resolve(root, 'cache'), id: 'project', testMatch: [`${root}/test/*.case.js`] },
    configString: '{}',
    instrument: false,
  };
  const transformer = await createTransformer({ root, transformer: resolve(root, 'transformer.cjs') });
  return { root, code: transformer.process!(BUILT, resolve(root, 'dist/pick.js'), options).code, options };
}

describe('the Jest transformer over a module loaded from its build', () => {
  it('places probes and records them under the source its map leads to, which the default include accepts', async () => {
    const { code, options } = await built();

    // The probes report under the path Jest transformed, which is the path its
    // journal row names; the record says where their lines are.
    expect(code).toContain('globalThis.__VA__');
    const record = await readRecord(jestStore(options.config.cacheDirectory, options.config.id), 'src/pick.ts');
    expect(record).toEqual(expect.objectContaining({ file: 'src/pick.ts', instrumented: true }));
  });

  it('leaves a bundle whose map names several sources as it arrived', async () => {
    const { code } = await built(['../src/pick.ts', '../src/other.ts']);

    expect(code).toBe(BUILT);
  });
});
