// The whole wiring for a project that runs `node:test`: name the test files and
// call `runNodeTest`. Recording, the case index and the selection are its.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNodeTest } from '@variance-authority/sense/node-test';

// `FIXTURE_SKIP` hands the run a selection that skips the files it names, so the test
// can tell what a run leaves out without a diff.
const skip = process.env['FIXTURE_SKIP'];
// `FIXTURE_FAILING` adds a file whose case fails, to see how a failed file is recorded.
const failing = process.env['FIXTURE_FAILING'] === undefined ? [] : ['test/failing.test.cjs'];
const here = fileURLToPath(new URL('.', import.meta.url));
const { passed } = await runNodeTest({
  files: ['test/alpha.test.mjs', 'test/beta.test.cjs', 'test/gamma.test.mjs', ...failing].map((file) => resolve(here, file)),
  coverageFile: process.env['VARIANCE_AUTHORITY_COVERAGE'],
  ...(skip === undefined ? {} : { selection: async () => ({ whole: false, skip: new Set(JSON.parse(skip)), notes: [] }) }),
});
process.exitCode = passed ? 0 : 1;
