/**
 * Plan the check workflow from the same collected files and the same record the
 * legs select from. The CLI owns selection and shard counts; `suitePlan` chooses
 * between the sharded selection and the sharded whole suite.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { SLICES } from '../vitest.config.mts';
import { suitePlan } from './ci-plan.mjs';

const near = process.env.EVENT === 'merge_group';
const pull = process.env.EVENT === 'pull_request';
const legs = near ? [{ part: 'rules' }] : [];
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const since = process.env.BASE || 'HEAD';
// A group of one is the queue's merge of the pull request onto `since`, and its
// second parent is the head whose checks passed: `--ran-at` lets the selection
// skip what that run already ran. A squash has no second parent and selects as before.
const ranAt = near ? spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD^2'], { encoding: 'utf8' }).stdout.trim() : '';
const summary = ['### Suite plan', '', '| Suite | Selected / collected | Mode | Jobs | Predicted wall |', '| --- | --- | --- | --- | --- |'];
run('yarn', ['variance', 'index']);
const budget = process.env.BUDGET ?? '240';
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
    '--setup', process.env.SETUP ?? '100', '--budget', budget,
    '--workers', String(workers), '--unrecorded', String(unrecorded), '--collected', listed, '--format', 'json'];
  const answer = (extra) => JSON.parse(run('node', [...args, ...extra]));
  if (near) {
    const selected = answer(['--since', since, ...(ranAt === '' ? [] : ['--ran-at', ranAt]), '--at-distance', '0-2']);
    // The rules leg keeps the queue gate running even when no test is selected.
    legs.push(...selected.matrix.map((shard) => ({ part: suite, shard })));
    summary.push(`| ${suite} | ${selected.files ?? 'unknown'} / ${total} | near | ${selected.shards} | ${selected.wall === undefined ? 'unrecorded' : `${Math.round(selected.wall / 1000)} s`} |`);
  } else {
    const full = answer([]);
    const selected = pull ? answer(['--since', since]) : undefined;
    const planned = suitePlan(suite, full, selected, Number(budget) * 1000);
    legs.push(...planned);
    const chosen = planned[0].mode === 'selected' ? selected : full;
    summary.push(`| ${suite} | ${selected?.files ?? (pull ? 'unknown' : total)} / ${total} | ${planned[0].mode} | ${planned.length} | ${chosen.wall === undefined ? 'unrecorded' : `${Math.round(chosen.wall / 1000)} s`} |`);
    console.log(`${suite}: ${planned[0].mode}, ${planned.length} job(s); selected prediction ${selected?.wall ?? 'unknown'} ms, whole prediction ${full.wall ?? 'unknown'} ms`);
  }
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `legs=${JSON.stringify(legs)}\nran-at=${ranAt}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n\nPredictions use recorded test durations and the configured setup estimate. Actual stage times appear in the required check's summary.\n`);
