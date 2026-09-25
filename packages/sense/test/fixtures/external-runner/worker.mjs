// Runs one test file: load it, run each case it declared, exit 1 on a failure.
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

let failed = false;
for (const { name, body } of cases) {
  try {
    await (observer ? observer.case(name, body) : body());
  } catch (error) {
    failed = true;
    console.error(name, error);
  }
}
observer?.finish();
process.exitCode = failed ? 1 : 0;
