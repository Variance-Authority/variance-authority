// Runs one test file: load it, run each case it declared, exit 1 on a failure.
// It times each case the way a runner does and prints what it measured as its
// last line, for the parent to report.
import { performance } from 'node:perf_hooks';
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { observeTestFile, registerRecording } from '@variance-authority/sense/runner';

const [file, flag] = process.argv.slice(2);
// Two ways a process can miss the recording, for the tests that check the run
// says so: `--no-hooks` never instruments, and `--records-elsewhere` instruments
// but writes what its probes mean where the run does not read.
if (flag === '--records-elsewhere') {
  const recording = JSON.parse(process.env['VARIANCE_AUTHORITY_RECORDING']);
  process.env['VARIANCE_AUTHORITY_RECORDING'] = JSON.stringify({ ...recording, store: `${recording.store}-elsewhere` });
}
if (flag !== '--no-hooks') registerRecording();

const observer = observeTestFile(file);
const cases = [];
globalThis.test = (name, body) => cases.push({ name, body });
await import(file);
// `--says-a-wrong-value` adds a case that says a value no row can hold, for the
// test that reads the warning the run prints about it.
if (flag === '--says-a-wrong-value') {
  cases.push({ name: ['says a wrong value'], body: () => variancePrecondition('when', new Date()) });
}

let failed = false;
const timed = [];
for (const { name, body } of cases) {
  const started = performance.now();
  try {
    await (observer ? observer.case(name, body) : body());
  } catch (error) {
    failed = true;
    console.error(name, error);
  }
  timed.push({ name, duration: performance.now() - started });
}
observer?.finish();
console.log(JSON.stringify(timed));
process.exitCode = failed ? 1 : 0;
