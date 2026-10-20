/**
 * Plan the check workflow from the same collected files and recorded prices the
 * runner uses. The CLI owns selection and shard counts; this shell chooses
 * between its serial selection and its sharded whole-suite prediction.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { SLICES } from '../vitest.config.mts';
import { suitePlan } from './ci-plan.mjs';

const near = process.env.EVENT === 'merge_group';
const pull = process.env.EVENT === 'pull_request';
const legs = near ? [{ part: 'rules' }] : [];
const run = (command, args, env = process.env) => execFileSync(command, args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const since = process.env.BASE || 'HEAD';
const summary = ['### Suite plan', '', '| Suite | Selected / collected | Mode | Jobs | Predicted wall |', '| --- | --- | --- | --- | --- |'];
run('yarn', ['variance', 'index']);
// Whole shards read only the frozen mainline, while a selected slice may read
// the PR's newer carried layer. Price each mode from the record it will use.
const fullEnv = process.env.BASELINE_READ === undefined ? process.env : {
  ...process.env, VARIANCE_AUTHORITY_CACHE: join(process.env.RUNNER_TEMP ?? tmpdir(), 'whole-plan'),
};
if (process.env.BASELINE_READ !== undefined) {
  run('node', ['tools/take-base.mjs', process.env.BASELINE_READ, process.env.BASELINE_HANDED ?? 'false'], fullEnv);
}
for (const [suite, config, unrecorded] of [
  ['unit', 'vitest.config.mts', 2],
  ['integration', 'vitest.integration.config.mts', 1],
  ['chromium', 'vitest.chromium.config.mts', 3],
]) {
  const listed = join(process.env.RUNNER_TEMP ?? tmpdir(), `collected-${suite}.txt`);
  const collected = run('yarn', ['vitest', 'list', '--filesOnly', '--config', config]);
  writeFileSync(listed, collected);
  const total = collected.split('\n').filter((line) => line.trim() !== '').length;
  const workers = SLICES[suite].workers ?? Math.max(1, availableParallelism() - 1);
  const args = ['packages/cli/dist/bin.js', 'shards', '--suite', suite,
    '--setup', process.env.SETUP ?? '100', '--budget', process.env.BUDGET ?? '240',
    '--workers', String(workers), '--unrecorded', String(unrecorded), '--collected', listed, '--format', 'json'];
  const answer = (extra, env = process.env) => JSON.parse(run('node', [...args, ...extra], env));
  if (near) {
    const selected = answer(['--since', since, '--at-distance', '0-2']);
    // The rules leg keeps the queue gate running even when no test is selected.
    legs.push(...(selected.shards === 1 ? [{ part: suite }] : selected.matrix.map((shard) => ({ part: suite, shard }))));
    summary.push(`| ${suite} | ${selected.files ?? 'unknown'} / ${total} | near | ${selected.shards} | ${selected.wall === undefined ? 'unrecorded' : `${Math.round(selected.wall / 1000)} s`} |`);
  } else {
    const full = answer([], fullEnv);
    const selected = pull ? answer(['--since', since, '--max', '1']) : undefined;
    const planned = suitePlan(suite, full, selected);
    legs.push(...planned);
    const chosen = planned[0].mode === 'selected' ? selected : full;
    summary.push(`| ${suite} | ${selected?.files ?? (pull ? 'unknown' : total)} / ${total} | ${planned[0].mode} | ${planned.length} | ${chosen.wall === undefined ? 'unrecorded' : `${Math.round(chosen.wall / 1000)} s`} |`);
    console.log(`${suite}: ${planned[0].mode}, ${planned.length} job(s); selected prediction ${selected?.wall ?? 'unknown'} ms, whole prediction ${full.wall ?? 'unknown'} ms`);
  }
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `legs=${JSON.stringify(legs)}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n\nPredictions use recorded test durations and the configured setup estimate. Actual stage times appear in the required check's summary.\n`);
