import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');
const order = process.env['VARIANCE_AUTHORITY_ORDER']?.split(',');

// `VARIANCE_AUTHORITY_ORDER` names the files in the order they run, relative to
// this directory. Vitest's own order comes from its results cache, which the
// fixture's earlier runs write, so a case that reads the order names it.
class Ordered extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const place = (file: TestSpecification): number => {
      const at = order!.indexOf(relative(root, file.moduleId));
      if (at === -1) throw new Error(`VARIANCE_AUTHORITY_ORDER does not name ${file.moduleId}`);
      return at;
    };
    return [...files].sort((a, b) => place(a) - place(b));
  }
}

// `VARIANCE_AUTHORITY_FILES` picks `test/checkout.mocked.ts`, which fails when
// its cases run in the order they are written.
export default withTestSelection(
  defineConfig({
    root,
    test: {
      include: [process.env['VARIANCE_AUTHORITY_FILES'] ?? 'test/*.case.ts'],
      environment: 'node',
      ...(order === undefined ? {} : { sequence: { sequencer: Ordered } }),
    },
  }),
  {
    coverageFile,
    include: (file) => file.startsWith(source),
  },
);
