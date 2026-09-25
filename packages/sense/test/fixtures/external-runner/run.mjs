// A test runner of the smallest useful shape: one child process per test file,
// and a file passes when its child exits 0. Every line that concerns the
// recording is a call into `@variance-authority/sense/runner`.
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startRecording } from '@variance-authority/sense/runner';

const execute = promisify(execFile);
const here = fileURLToPath(new URL('.', import.meta.url));
const files = ['test/alpha.case.mjs', 'test/beta.case.mjs'].map((file) => resolve(here, file));

const recording = startRecording({
  coverageFile: process.env['VARIANCE_AUTHORITY_COVERAGE'],
  preconditions: [resolve(here, 'run.mjs'), resolve(here, 'worker.mjs')],
});

const finished = [];
for (const file of files) {
  const complete = await execute(process.execPath, [resolve(here, 'worker.mjs'), file, ...process.argv.slice(2)]).then(
    () => true,
    () => false,
  );
  finished.push({ file, complete });
}
await recording.finish(finished);
