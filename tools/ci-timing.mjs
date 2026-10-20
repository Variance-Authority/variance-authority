/** Observed Actions timestamps, reported separately from the planner's estimates. */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function seconds(start, end) {
  if (start == null || end == null) return undefined;
  const from = Date.parse(start);
  const to = Date.parse(end);
  return Number.isFinite(from) && Number.isFinite(to) && to >= from ? (to - from) / 1000 : undefined;
}

function stage(name) {
  if (/build|native scanner|Cargo compilation|compiler|native unit tests/i.test(name)) return 'build';
  if (/plan suite jobs|count the shards|mainline|keep the base record|take the base|last push/i.test(name)) return 'selection';
  if (/^test$|near tests|carry contract|^measure$|^lint$|^check$|^restrictions$/i.test(name)) return 'execution';
  if (/fold|review|publish|hand the record|keep the record/i.test(name)) return 'reporting';
  return 'setup';
}

const display = (value) => value === undefined || !Number.isFinite(value) ? 'unknown' : `${Math.round(value)} s`;

/** Elapsed gate time and one row of measured stage times per job; missing stays unknown. */
export function timingSummary(jobs, created, now) {
  const lines = ['### Time to the required check', '',
    `Elapsed from workflow creation to this gate summary: **${display(created === undefined ? undefined : (now - created) / 1000)}** (includes queue time).`, '',
    '| Job | Setup / transfer | Build / native tests | Selection | Execution / rules | Reporting | Job elapsed |',
    '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const job of jobs) {
    if (job.conclusion === 'skipped') continue;
    const totals = Object.fromEntries(['setup', 'build', 'selection', 'execution', 'reporting'].map((key) => [key, job.steps === undefined ? undefined : 0]));
    for (const step of job.steps ?? []) {
      if (step.conclusion === 'skipped') continue;
      const key = stage(step.name);
      const duration = seconds(step.started_at, step.completed_at);
      totals[key] = duration === undefined || totals[key] === undefined ? undefined : totals[key] + duration;
    }
    const escaped = job.name.replaceAll('|', '\\|').replaceAll('\n', ' ');
    const name = ['cases', 'publish'].includes(job.name) ? `${escaped} (non-gating)` : escaped;
    lines.push(`| ${name} | ${Object.values(totals).map(display).join(' | ')} | ${display(seconds(job.started_at, job.completed_at))} |`);
  }
  lines.push('', 'Stage times come from Actions step timestamps. Parallel job times are not added to elapsed gate time. The gate is still running while this summary is written; its final duration is in Actions.', '');
  return lines.join('\n');
}

async function main() {
  const { GITHUB_API_URL = 'https://api.github.com', GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_TOKEN, GITHUB_STEP_SUMMARY } = process.env;
  if (!GITHUB_REPOSITORY || !GITHUB_RUN_ID || !GITHUB_RUN_ATTEMPT || !GITHUB_TOKEN || !GITHUB_STEP_SUMMARY) throw new Error('CI timing requires the Actions run, attempt, token and summary path');
  const root = `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
  const read = async (url) => {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`Actions timing API returned ${response.status}`);
    return response.json();
  };
  const run = await read(root);
  const jobs = [];
  for (let page = 1; ; page += 1) {
    const result = await read(`${root}/attempts/${GITHUB_RUN_ATTEMPT}/jobs?per_page=100&page=${page}`);
    jobs.push(...result.jobs);
    if (result.jobs.length < 100) break;
  }
  appendFileSync(GITHUB_STEP_SUMMARY, timingSummary(jobs, run.created_at == null ? undefined : Date.parse(run.created_at), Date.now()));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
