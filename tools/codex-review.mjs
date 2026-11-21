/**
 * `yarn review:codex <n>`: a contextless review of an open pull request by
 * another model family (validate and correct, "Codex"). It prints the review
 * and posts nothing. A run counts only when it knew nothing but the pull
 * request and read it, so a log that names a checkout of this repository, or
 * no file of the pull request, fails it.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** The run's whole environment: built, not filtered, so nothing of the caller's reaches it. */
export const sealed = (home, codexHome, codex) => ({
  PATH: `${dirname(codex)}:${PATH}`,
  HOME: home,
  CODEX_HOME: codexHome,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
});

/** The places a run's log names. */
export const leaks = (log, places) => places.filter((place) => log.includes(place));

/** Whether a run got to the pull request: a review that did names a file of it, one that could not fetch it names none. */
export const reached = (log, files) => files.some(({ path }) => log.includes(path));

/** A checkout's path, and the same path as a directory name: an agent's session directory spells the checkout it runs in. */
export const places = (checkouts) => checkouts.flatMap((path) => [path, path.replaceAll('/', '-')]);

const checkouts = () =>
  execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' })
    .split('\n')
    .flatMap((line) => (line.startsWith('worktree ') ? [line.slice('worktree '.length)] : []));

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
  const { url, files } = JSON.parse(execFileSync('gh', ['pr', 'view', ...process.argv.slice(2), '--json', 'url,files'], { encoding: 'utf8' }));

  const root = mkdtempSync(NEUTRAL);
  const [work, home, codexHome, out, logged] = ['work', 'home', 'codex', 'review.md', 'run.jsonl'].map((name) => join(root, name));
  for (const directory of [work, home, codexHome]) mkdirSync(directory);
  // A link, not a copy: a refreshed login has to reach the file the owner's next run reads.
  symlinkSync(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'), join(codexHome, 'auth.json'));
  const log = openSync(logged, 'w');
  const run = spawnSync(codex, invocation(url, out), {
    cwd: work,
    env: sealed(home, codexHome, codex),
    stdio: ['ignore', log, log],
  });
  closeSync(log);

  if (run.status !== 0) fail(`codex exited with ${run.error?.message ?? run.status ?? run.signal}; its log is ${logged}.`);
  const text = readFileSync(logged, 'utf8');
  const named = leaks(text, places(checkouts()));
  if (named.length > 0) fail(`the run does not count, its log names ${named.join(', ')}: ${logged}.`);
  if (!reached(text, files)) fail(`no review made: the log names no file of the pull request: ${logged}.`);
  const review = existsSync(out) ? readFileSync(out, 'utf8').trim() : '';
  if (!review) fail(`codex wrote no review; its log is ${logged}.`);
  console.log(review);
  rmSync(root, { recursive: true });
};

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
