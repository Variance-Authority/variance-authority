import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { instrumentationId, type SourceConsumed } from '../instrument/index.js';
import { executionCollectorSource, recordExecution, testSelectionProbes, type ExecutionJournal } from './journal.js';
import { readTestCoverage } from './index.js';
import { inRoot } from './__fixtures__/browser-page.js';

const sourceConsumed: readonly SourceConsumed[] = [{ module: 'compiler-kit', imported: 'declare', syntax: 'arguments' }];
const SOURCE = "import { declare } from 'compiler-kit'; declare(props => props.color); const runtime = value => value + 1; globalThis.run = runtime;";

describe('configured build and recording driver', () => {
  it.each(['presence', 'entries'] as const)('recuts the configured regions under %s', async mode => {
    await inRoot(async root => {
      const file = resolve(root, 'consumer.js');
      const coverageFile = resolve(root, 'coverage.bin');
      await writeFile(file, SOURCE);
      const plugin = testSelectionProbes({ root, mode, sourceConsumed });
      const collector = plugin.load(plugin.resolveId('variance-authority:execution-collector')!)!;
      const transformed = plugin.transform(SOURCE, file)!;
      const realm = createContext({ declare: () => {} });
      runInContext(collector, realm);
      runInContext(transformed.code.replace(/import [^;]+;/g, ''), realm);
      runInContext('run(1)', realm);
      const journal = runInContext('globalThis.__variance_authority_execution__.drain()', realm) as ExecutionJournal;
      expect(journal.instrumentation).toBe(instrumentationId(mode, sourceConsumed));
      expect(journal.modules[0]!.hits).toContain(1);
      const missing = await recordExecution({ root, coverageFile, mode, subjects: [{ owner: 'test', journal }] });
      expect(missing).toMatchObject({ recorded: false });
      const recorded = await recordExecution({ root, coverageFile, mode, sourceConsumed, subjects: [{ owner: 'test', journal }] });
      expect(recorded).toMatchObject({ recorded: true });
      const coverage = await readTestCoverage(coverageFile);
      expect(coverage.instrumentation).toBe(journal.instrumentation);
      expect(coverage.modules[0]!.blocks.map(block => block.name)).toEqual(['', 'runtime']);
      expect(executionCollectorSource(mode, sourceConsumed)).toContain(journal.instrumentation);
    });
  });
});
