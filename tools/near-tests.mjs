/** Local near schedules canonical selections; a whole slice belongs to CI. */
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { selectSuite } from '@variance-authority/cli';
import { MARKERS } from './slices.mjs';
import { localNearFiles } from './near-plan.mjs';

const root = resolve(import.meta.dirname, '..');
const since = process.env.VARIANCE_AUTHORITY_SINCE ?? '';
const policy = { local: true, atDistance: { from: 0, to: 2, by: 'environment' }, budget: 20 };
const env = {
  ...process.env,
  VARIANCE_AUTHORITY_SINCE: since,
  VARIANCE_AUTHORITY_LOCAL: '1',
  VARIANCE_AUTHORITY_GRAIN: 'file',
  VARIANCE_AUTHORITY_AT_DISTANCE: `${policy.atDistance.from}-${policy.atDistance.to}`,
  VARIANCE_AUTHORITY_BUDGET: String(policy.budget),
};
const listing = { ...env };
for (const key of ['SINCE', 'LOCAL', 'GRAIN', 'AT_DISTANCE', 'BUDGET', 'RAN_AT', 'PLACE_AT_DISTANCE']) delete listing[`VARIANCE_AUTHORITY_${key}`];
const output = (command, args, environment = env) => execFileSync(command, args, { cwd: root, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const edited = output('git', ['diff', '--name-only', '--diff-filter=AM', '--no-renames', since || 'origin/main', '--']).trim().split('\n');

for (const suite of Object.keys(MARKERS)) {
  const config = suite === 'unit' ? 'vitest.config.mts' : `vitest.${suite}.config.mts`;
  const collected = output('yarn', ['vitest', 'list', '--filesOnly', '--config', config], listing).split('\n').filter(Boolean);
  const selection = await selectSuite({ root, suite, ...policy, ...(since === '' ? {} : { since }) });
  const files = localNearFiles(selection, collected, edited, !process.env.CI);
  if (files !== undefined) {
    console.log(`near: ${suite} selects every collected file; the complete ${collected.length}-file slice is left to CI. ${files.length} directly edited test files run locally.`);
    if (selection.declined !== undefined) console.log(`near: ${selection.declined}`);
    if (files.length === 0) continue;
  }
  const run = spawnSync('yarn', ['vitest', 'run', '--config', config, ...files ?? []], { cwd: root, env, stdio: 'inherit' });
  if (run.error) throw run.error;
  if (run.status !== 0) process.exit(run.status ?? 1);
}
