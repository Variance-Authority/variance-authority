/**
 * The test files a suite's runner collects at this commit, as the runner lists
 * them: `node tools/list-collected.mjs <suite> <out>` writes what
 * `vitest list --filesOnly` prints under the suite's own slice config, which
 * `slicesOf` in `tools/test-since.mjs` names, to `<out>`.
 *
 * Only the runner can say a test file no longer counts: a record outlives the
 * configuration it was recorded under. `check.yml` asks it twice, once to let a
 * fold of shards drop the files the suite stopped collecting, once to count a
 * mainline publish's whole run against it.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { slicesOf } from './test-since.mjs';

const [suite, out] = process.argv.slice(2);
if (suite === undefined || out === undefined) {
  console.error('list-collected: name the suite and the file to write its collected test files to');
  process.exit(2);
}
const slice = slicesOf(process.cwd()).find((one) => one.suite === suite);
if (slice === undefined) {
  console.error(`list-collected: no slice is declared for ${suite}`);
  process.exit(1);
}
writeFileSync(
  out,
  execFileSync('yarn', ['vitest', 'list', '--filesOnly', '--config', slice.config], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  }),
);
