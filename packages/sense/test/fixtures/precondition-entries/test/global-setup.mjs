import { writeFileSync } from 'node:fs';

/** Writes the file the run names, as a build step in a global setup would. */
export default function setup() {
  if (process.env['FIXTURE_SETUP_WRITES'] !== undefined) writeFileSync(process.env['FIXTURE_SETUP_WRITES'], '{}\n');
}
