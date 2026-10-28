import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';

// A project that runs Vitest 5 the way a fast suite does: one module graph
// shared across files in a worker, and every case in a file in flight at once.
// The test that runs it hands the selection in, as the files to skip in JSON;
// absent, every file runs. It also names where Vitest keeps its module cache,
// so a run is cold or warm by the test's choice, not by the runs before it.
// `inlined` is a dependency the test writes under `node_modules`: Vitest
// transforms it because it is inlined, and the seam probes it because `include`
// names it.
const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');
const skip = process.env['FIXTURE_SKIP'];
const moduleCache = process.env['FIXTURE_MODULE_CACHE'];
if (moduleCache === undefined) throw new Error('FIXTURE_MODULE_CACHE is required');

export default withTestSelection(
  {
    root,
    test: {
      include: ['*.case.ts'],
      server: { deps: { inline: [/node_modules\/inlined\//] } },
      fsModuleCachePath: moduleCache, isolate: false, pool: 'forks', sequence: { concurrent: true },
    },
  },
  {
    coverageFile,
    continuations: true,
    include: (file) => file === resolve(root, 'add.ts') || file === resolve(root, 'node_modules/inlined/index.js'),
    ...(skip === undefined
      ? {}
      : { selection: async () => ({ whole: new Set<string>(JSON.parse(skip)), skip: new Set<string>(JSON.parse(skip)), notes: [] }) }),
  },
);
