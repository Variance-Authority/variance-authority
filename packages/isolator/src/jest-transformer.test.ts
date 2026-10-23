import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { globMatcher, isTestFile, jestCacheKey, loadTransformer, slashed, type JestTransformOptions } from './jest-transformer.js';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/jest-transformer');
const given: JestTransformOptions = { config: {}, configString: '{}', instrument: false, transformerConfig: { wrapper: true } };

describe('loadTransformer', () => {
  it('builds the transformer with its own options, hands it them on every call, and keeps its `this`', async () => {
    const theirs = await loadTransformer<JestTransformOptions, { code: string }>(fixtures, [
      resolve(fixtures, 'class-transformer.cjs'),
      { own: 1 },
    ]);
    expect(theirs.process?.('a', '/x.ts', given).code).toBe('a/*{"own":1} {"own":1}*/');
    expect(theirs.cacheKey('a', '/x.ts', given)).toBe('key:a');
  });

  it('hands a transformer its entry gave no options `{}`, never the wrapper\'s', async () => {
    const theirs = await loadTransformer<JestTransformOptions, { code: string }>(fixtures, resolve(fixtures, 'class-transformer.cjs'));
    expect(theirs.process?.('a', '/x.ts', given).code).toBe('a/*{} {}*/');
  });

  it("awaits a CommonJS export, offers no `process` it lacks, and answers with Jest's key where it declares none", async () => {
    const theirs = await loadTransformer<JestTransformOptions, { code: string }>(fixtures, resolve(fixtures, 'bare-transformer.cjs'));
    expect(theirs.process).toBeUndefined();
    expect((await theirs.processAsync('a', '/x.ts', given)).code).toBe('A');
    expect(theirs.cacheKey('a', '/x.ts', given)).toBe(jestCacheKey('a', '/x.ts', given));
  });
});

describe('jestCacheKey', () => {
  it('changes with the source, the path, the configuration and coverage', () => {
    const key = jestCacheKey('a', '/x.ts', given);
    expect(new Set([
      key,
      jestCacheKey('b', '/x.ts', given),
      jestCacheKey('a', '/y.ts', given),
      jestCacheKey('a', '/x.ts', { ...given, configString: '{"a":1}' }),
      jestCacheKey('a', '/x.ts', { ...given, instrument: true }),
    ]).size).toBe(5);
  });
});

describe('which files are tests', () => {
  it('reads testMatch as Jest does: one positive glob, no negated one, dotfiles included', () => {
    const config = { testMatch: ['**/*.test.ts', '!**/fixtures/**'] };
    expect(isTestFile('/repo/.hidden/a.test.ts', config)).toBe(true);
    expect(isTestFile('/repo/fixtures/a.test.ts', config)).toBe(false);
    expect(isTestFile('/repo/a.ts', config)).toBe(false);
  });

  it('reads any testRegex against the path as the runner spells it', () => {
    expect(isTestFile('/repo/a.spec.js', { testRegex: ['\\.test\\.', '\\.spec\\.'] })).toBe(true);
    expect(isTestFile('/repo/a.js', { testRegex: '\\.spec\\.' })).toBe(false);
  });

  it('reads a Windows separator as `/`, unless it escapes a special character', () => {
    expect(slashed('C:\\repo\\a.test.ts')).toBe('C:/repo/a.test.ts');
    expect(slashed('a\\.b')).toBe('a\\.b');
    expect(globMatcher(['**/*.test.ts'])('C:\\repo\\a.test.ts')).toBe(true);
  });
});
