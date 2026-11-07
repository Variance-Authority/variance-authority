import { writeFileSync } from 'node:fs';
import { value } from '../src/value';

// The mark says a test ran. The second file is one a test writes for itself.
it('runs', () => {
  writeFileSync(process.env['FIXTURE_TEST_RAN']!, value);
  if (process.env['FIXTURE_TEST_WRITES'] !== undefined) writeFileSync(process.env['FIXTURE_TEST_WRITES'], '{}\n');
});
