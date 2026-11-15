import { describe, expect, it } from 'vitest';
import { warmRecorded } from './jest-prewarm.js';

const COMMONJS = { config: {} };

/** Whether `warmRecorded` read the record for `tests` under `globalConfig`: reading it is where a warm-up starts. */
async function reads(tests: readonly { path: string; context: { config: object } }[], globalConfig: object): Promise<boolean> {
  let read = false;
  await warmRecorded(tests, globalConfig, {
    root: '/repo',
    rootDir: '/repo',
    record: async () => {
      read = true;
      return { notes: [] } as never;
    },
    say: () => {},
  });
  return read;
}

describe('a selected Jest run', () => {
  it('reads the record to warm the tests of a CommonJS project', async () => {
    expect(await reads([{ path: '/repo/a.test.ts', context: COMMONJS }], {})).toBe(true);
  });

  it('warms nothing of a project that treats files as ES modules', async () => {
    const esm = { config: { extensionsToTreatAsEsm: ['.ts'] } };

    expect(await reads([{ path: '/repo/a.test.ts', context: esm }], {})).toBe(false);
  });

  it('warms nothing of a test file that is an ES module', async () => {
    expect(await reads([{ path: '/repo/a.test.mjs', context: COMMONJS }], {})).toBe(false);
  });

  it('warms nothing when coverage is collected over only the changed files', async () => {
    const tests = [{ path: '/repo/a.test.ts', context: COMMONJS }];

    expect(await reads(tests, { collectCoverage: true, onlyChanged: true })).toBe(false);
    expect(await reads(tests, { collectCoverage: false, onlyChanged: true })).toBe(true);
  });
});
