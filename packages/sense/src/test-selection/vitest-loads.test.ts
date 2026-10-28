import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { instrumentationId } from '../instrument/index.js';
import { decodeTestCoverage } from './format.js';
import { withTestSelection } from './vitest.js';

describe('the Vitest seam under the loads recipe', () => {
  it('marks each module as loaded under the loads recipe, and places no probe in it', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-instrumentation-loads-'));
    const coverageFile = resolve(root, 'coverage.bin');
    const source = 'export function f(x) { if (x) { return 1; } return 2; }';
    try {
      const configured = withTestSelection({}, { root, coverageFile, include: () => true, mode: 'loads' });
      const { plugin, reporter } = seamOf(configured);
      await writeFile(resolve(root, 'f.ts'), source);

      const placed = plugin.transform.handler(source, resolve(root, 'f.ts'));
      await reporter.onFinished([]);

      // The text is the module's own up to its end, and one line follows it.
      expect(placed!.code.startsWith(`${source}\n;`)).toBe(true);
      expect(placed!.code.slice(source.length + 1)).not.toContain('\n');
      expect(placed!.code).not.toMatch(/__va\(\d+\)|__vaL\(/);
      const coverage = decodeTestCoverage(await readFile(coverageFile));
      expect(coverage.instrumentation).toBe(instrumentationId('loads'));
      expect(coverage.modules.map((module) => [module.instrumented, module.blocks])).toEqual([[false, []]]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('composes no source map for a module it marks, since the mark moves no column', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-instrumentation-loads-'));
    const source = 'export function f(x: number) { return x; }';
    const compiled = 'export function f(x) { return x; }';
    try {
      const configured = withTestSelection({}, { root, coverageFile: resolve(root, 'coverage.bin'), include: () => true, mode: 'loads' });
      const { plugin } = seamOf(configured);
      await writeFile(resolve(root, 'f.ts'), source);
      let composed = 0;
      const context = { getCombinedSourcemap: () => ((composed += 1), { version: 3, sources: ['f.ts'], names: [], mappings: 'AAAA' }) };

      const placed = plugin.transform.handler.call(context, compiled, resolve(root, 'f.ts'));

      expect(placed!.code.startsWith(`${compiled}\n;`)).toBe(true);
      expect(composed).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

/** The probes plugin and the recording reporter of a configuration the seam wrapped. */
function seamOf(configured: ReturnType<typeof withTestSelection>) {
  const plugins = configured.plugins as unknown as Array<{
    name: string;
    transform: { handler(code: string, id: string): { code: string } | null };
  }>;
  const reporters = configured.test!.reporters as unknown as Array<{ onFinished(files: readonly []): Promise<void> }>;
  return { plugin: plugins.find(({ name }) => name === 'variance-authority:test-selection-probes')!, reporter: reporters.at(-1)! };
}
