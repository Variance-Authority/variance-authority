import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withTestSelection, type TestSelectionOptions } from './vitest.js';

type Transform = { handler(code: string, id: string): { code: string } | null };

const TEST = "import { it } from 'vitest';\nit('adds', () => {\n  expect(1 + 1).toBe(2);\n});\n";

describe('a test file is cut at each statement of its tests, unless the run turns cuts off', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), 'variance-cadence-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function transform(test: { include?: string[]; dir?: string } = {}, options: Partial<TestSelectionOptions> = {}): Transform {
    const configured = withTestSelection({ test }, { root, coverageFile: resolve(root, 'coverage.bin'), ...options });
    return (configured.plugins as unknown as Array<{ transform: Transform }>)[0]!.transform;
  }

  it('cuts a file the project counts as a test by default', () => {
    expect(transform().handler(TEST, resolve(root, 'src/add.test.ts'))!.code).toContain('  __vaC(3);expect(1 + 1)');
  });

  it('leaves a test file as it is when `cadence` is off', () => {
    expect(transform({}, { cadence: false }).handler(TEST, resolve(root, 'src/add.test.ts'))).toBeNull();
  });

  it('counts what `test.include` names as a test, under `test.dir`, and nothing else', () => {
    const cuts = transform({ dir: 'spec', include: ['**/*.check.js'] });
    expect(cuts.handler(TEST, resolve(root, 'spec/add.check.js'))!.code).toContain('__vaC(3);');
    expect(cuts.handler(TEST, resolve(root, 'src/add.test.ts'))).toBeNull();
  });
});
