import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tools from '@variance-authority/mcp/tools';
import * as sense from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages.fixture.js';

/**
 * `variance ask grep` with a start point answers from the tree `variance index`
 * published, not from a graph of the checkout drawn at question time. Drawing
 * that graph read every tsconfig and manifest and resolved every specifier in
 * the repository to search a few hundred files; the published tree holds the
 * same edges, the modules a test loads for real beside its mocks among them,
 * resolved once when they were indexed.
 */

vi.mock('@variance-authority/mcp/tools', async (original) => {
  const actual = await original<typeof import('@variance-authority/mcp/tools')>();
  return { ...actual, readTree: vi.fn(actual.readTree) };
});

vi.mock('@variance-authority/sense', async (original) => {
  const actual = await original<typeof import('@variance-authority/sense')>();
  return { ...actual, openSourceIndex: vi.fn(actual.openSourceIndex), scanRelations: vi.fn(actual.scanRelations), runGraphOf: vi.fn(actual.runGraphOf) };
});

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-grep-stored-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

const MOCKING = {
  'packages/lib/src/api.ts': 'export const other = () => 1;\n',
  'packages/lib/src/real.ts': 'export const fetchThing = () => 1;\n',
  'packages/lib/src/api.test.ts': "import { vi } from 'vitest';\nvi.mock('./api');\nexport const real = await vi.importActual('./real');\n",
  'packages/lib/src/far.ts': 'export const fetchThing = 2;\n',
};

describe('variance ask grep from a start point', () => {
  it('searches the module a test loads for real from the published tree, drawing no graph of the checkout', async () => {
    checkout(MOCKING);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    vi.mocked(tools.readTree).mockClear();
    vi.mocked(sense.openSourceIndex).mockClear();
    vi.mocked(sense.scanRelations).mockClear();
    vi.mocked(sense.runGraphOf).mockClear();

    const { code, out } = await run(['ask', 'grep', '--query', 'fetchThing', '--from', 'packages/lib/src/api.test.ts']);

    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^packages\/lib\/src\/real\.ts:1/m);
    expect(out).not.toContain('packages/lib/src/far.ts');
    expect(tools.readTree).not.toHaveBeenCalled();
    // The whole index decoded, the checkout scanned, every mock resolved: none of it.
    expect(sense.openSourceIndex).not.toHaveBeenCalled();
    expect(sense.scanRelations).not.toHaveBeenCalled();
    expect(sense.runGraphOf).not.toHaveBeenCalled();
  });
});
