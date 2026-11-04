/**
 * `yarn review:codex <n>`: a contextless review of an open pull request by
 * another model family (validate and correct, "Codex"). It prints the review
 * and posts nothing. A run counts only when it knew nothing but the pull
 * request, so a log that names a path of this machine fails it.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Caught everything on the first pull request it read; a miss is what justifies raising either. */
const MODEL = 'gpt-6.1-terra';
const EFFORT = 'medium';
/** Where the ChatGPT desktop app keeps the CLI, which it does not put on `PATH`. */
const APP = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
/** Not the caller's temporary directory, whose path can spell this checkout's. */
const NEUTRAL = '/tmp/review-';

/** The arguments of one run; the prompt is the pull request's URL and no more. */
export const invocation = (url, out) => [
  'exec',
  '--ignore-user-config',
  '--ignore-rules',
  '--ephemeral',
  '--skip-git-repo-check',
  '--disable',
  'plugins',
  '--disable',
  'apps',
  '-m',
  MODEL,
  '-c',
  `model_reasoning_effort=${EFFORT}`,
  '-s',
  'workspace-write',
  '-c',
  'sandbox_workspace_write.network_access=true',
  '--json',
  '-o',
  out,
  `review ${url}`,
];

/** The run's whole environment: built, not filtered, so nothing of the caller's reaches it. The login stays, in `CODEX_HOME`. */
export const sealed = (home, codexHome) => ({
  PATH,
  HOME: home,
  CODEX_HOME: codexHome,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
});

/** The places of this machine a run's log names. */
export const leaks = (log, places) => places.filter((place) => log.includes(place));

/** Every checkout of this repository, and the caller's temporary directory. */
const places = () => {
  const list = execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  const checkouts = list.split('\n').flatMap((line) => (line.startsWith('worktree ') ? [line.slice('worktree '.length)] : []));
  return process.env.TMPDIR ? [...checkouts, process.env.TMPDIR] : checkouts;
};

const binary = () => {
  const found = spawnSync('which', ['codex'], { encoding: 'utf8' }).stdout.trim();
  return found || (existsSync(APP) ? APP : undefined);
};

const fail = (reason) => {
  console.error(`review:codex: ${reason}`);
  process.exit(1);
};

const main = () => {
  const codex = binary();
  if (!codex) fail(`no review made: no codex on PATH or at ${APP}.`);
  const url = execFileSync('gh', ['pr', 'view', ...process.argv.slice(2), '--json', 'url', '--jq', '.url'], { encoding: 'utf8' }).trim();

  const root = mkdtempSync(NEUTRAL);
  const [work, home, out, logged] = ['work', 'home', 'review.md', 'run.jsonl'].map((name) => join(root, name));
  mkdirSync(work);
  mkdirSync(home);
  const log = openSync(logged, 'w');
  const run = spawnSync(codex, invocation(url, out), {
    cwd: work,
    env: sealed(home, join(homedir(), '.codex')),
    stdio: ['ignore', log, log],
  });
  closeSync(log);

  if (run.status !== 0) fail(`codex exited with ${run.error?.message ?? run.status ?? run.signal}; its log is ${logged}.`);
  const named = leaks(readFileSync(logged, 'utf8'), places());
  if (named.length > 0) fail(`the run does not count, its log names ${named.join(', ')}: ${logged}.`);
  if (!existsSync(out)) fail(`codex wrote no review; its log is ${logged}.`);
  console.log(readFileSync(out, 'utf8'));
  rmSync(root, { recursive: true });
};

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
