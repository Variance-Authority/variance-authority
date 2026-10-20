/** Read the current Actions attempt and append its observed timings to the gate. */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { timingSummary } from './ci-timing.mjs';

async function main() {
  const { GITHUB_API_URL = 'https://api.github.com', GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_TOKEN, GITHUB_STEP_SUMMARY } = process.env;
  if (!GITHUB_REPOSITORY || !GITHUB_RUN_ID || !GITHUB_RUN_ATTEMPT || !GITHUB_TOKEN || !GITHUB_STEP_SUMMARY) throw new Error('CI timing requires the Actions run, attempt, token and summary path');
  const root = `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
  const read = async (url) => {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`Actions timing API returned ${response.status}`);
    return response.json();
  };
  const run = await read(`${root}/attempts/${GITHUB_RUN_ATTEMPT}`);
  const jobs = [];
  for (let page = 1; ; page += 1) {
    const result = await read(`${root}/attempts/${GITHUB_RUN_ATTEMPT}/jobs?per_page=100&page=${page}`);
    jobs.push(...result.jobs);
    if (result.jobs.length < 100) break;
  }
  const start = Number(GITHUB_RUN_ATTEMPT) > 1 ? run.run_started_at : run.created_at;
  appendFileSync(GITHUB_STEP_SUMMARY, timingSummary(jobs, start == null ? undefined : Date.parse(start), Date.now()));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
