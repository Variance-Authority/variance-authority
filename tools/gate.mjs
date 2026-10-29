/**
 * The verification gate an agent's push passes: `node tools/gate.mjs stamp
 * <wave>` after a green wave, and `node tools/gate.mjs hook` as the Claude Code
 * `PreToolUse` hook on Bash.
 *
 * `stamp` records that a wave passed on the commit `HEAD` names, in the
 * checkout's own git directory, so nothing tracked moves and each worktree
 * keeps its own. A tree with uncommitted changes is not stamped: the wave ran
 * on something no commit holds, and it says so.
 *
 * `hook` reads the tool call from stdin. A `git push` of a branch other than
 * `main`, or a `gh pr create`, from a checkout of this repository is refused
 * with exit 2 until `near` and `rules` are stamped on its `HEAD`. Whether the
 * change should exist at all is CI's `idea` step, which reads the issue the
 * pull request closes; this gate only says the waves ran.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WAVES = ['near', 'rules'];

const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const stampFile = (dir) => {
  const path = resolve(dir, git(dir, 'rev-parse', '--git-path', 'variance-gate'));
  mkdirSync(path, { recursive: true });
  return join(path, git(dir, 'rev-parse', 'HEAD'));
};

const stamped = (dir) => {
  const file = stampFile(dir);
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
};

const stamp = (wave) => {
  const dir = process.cwd();
  if (git(dir, 'status', '--porcelain') !== '') {
    console.log(`gate: ${wave} is not stamped; the tree has uncommitted changes. Commit, then run the wave again.`);
    return;
  }
  appendFileSync(stampFile(dir), `${wave}\n`);
  console.log(`gate: ${wave} stamped on ${git(dir, 'rev-parse', '--short', 'HEAD')}`);
};

// The directory a command acts in: `git -C <dir>`, else a leading `cd <dir>`,
// else the session's working directory.
const targetOf = (command, cwd) => {
  const flag = command.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/);
  const cd = command.match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(&&|;)/);
  const dir = (flag ?? cd)?.[1].replace(/^["']|["']$/g, '');
  return dir ? resolve(cwd, dir) : cwd;
};

const hook = () => {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const command = input.tool_input?.command ?? '';
  const push = /\bgit\b[^|;&]*\bpush\b/.test(command) && !/--delete|\s-d\s|--tags/.test(command);
  const create = /\bgh\s+pr\s+create\b/.test(command);
  if (!push && !create) return;

  const dir = targetOf(command, input.cwd ?? process.cwd());
  let branch;
  try {
    if (!existsSync(join(git(dir, 'rev-parse', '--show-toplevel'), 'tools', 'gate.mjs'))) return;
    branch = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
  } catch {
    return;
  }
  if (branch === 'main') return;

  const missing = WAVES.filter((wave) => !stamped(dir).includes(wave));
  if (missing.length === 0) return;
  process.stderr.write(
    `gate: ${branch} at ${git(dir, 'rev-parse', '--short', 'HEAD')} has no green ${missing.join(' or ')} wave. ` +
      `Commit, then run ${missing.map((wave) => `\`yarn verify:${wave}\``).join(' and ')} before pushing ` +
      '(AGENTS.md, Pre-verify).\n',
  );
  process.exit(2);
};

const [command, wave] = process.argv.slice(2);
if (command === 'stamp' && WAVES.includes(wave)) stamp(wave);
else if (command === 'hook') hook();
else {
  console.error(`usage: node tools/gate.mjs stamp <${WAVES.join('|')}> | hook`);
  process.exit(1);
}
