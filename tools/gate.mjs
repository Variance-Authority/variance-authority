/**
 * The verification gate an agent's push passes: `node tools/gate.mjs stamp
 * <wave>` after a green wave, and `node tools/gate.mjs hook` as the Claude Code
 * `PreToolUse` hook on Bash.
 *
 * `stamp` records that a wave passed on the tree `HEAD` holds, in the
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
import { fileURLToPath } from 'node:url';

const WAVES = ['near', 'rules'];

const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const stampFile = (dir) => {
  const path = resolve(dir, git(dir, 'rev-parse', '--git-path', 'variance-gate'));
  mkdirSync(path, { recursive: true });
  return join(path, git(dir, 'rev-parse', 'HEAD^{tree}'));
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

const unquote = (word) => word.replace(/^["']|["']$/g, '');

// The gated calls in a command line, each with the directory it acts in: the
// line is cut at `&&`, `||`, `;`, `|` and parentheses, a `cd <dir>` moves the
// directory for the parts after it, and a part counts only when its own first
// word is `git` with `push` as the subcommand, or `gh pr create`. A commit
// message or an `echo` that spells "git push" is not a push.
export const gatedCalls = (command, cwd) => {
  const calls = [];
  let dir = cwd;
  for (const part of command.split(/&&|\|\||[;|()\n]/)) {
    const words = part.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    if (words[0] === 'cd' && words[1]) dir = resolve(dir, unquote(words[1]));
    if (words[0] === 'gh' && words[1] === 'pr' && words[2] === 'create') calls.push(dir);
    if (words[0] !== 'git') continue;
    let at = dir;
    let i = 1;
    while (i < words.length && words[i].startsWith('-')) {
      if (words[i] === '-C') at = resolve(dir, unquote(words[++i] ?? ''));
      else if (words[i] === '-c') i++;
      i++;
    }
    const rest = words.slice(i + 1);
    if (words[i] === 'push' && !rest.some((word) => ['--delete', '-d', '--tags'].includes(word))) calls.push(at);
  }
  return calls;
};

const refuse = (dir) => {
  let branch;
  try {
    if (!existsSync(join(git(dir, 'rev-parse', '--show-toplevel'), 'tools', 'gate.mjs'))) return false;
    branch = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
  } catch {
    return false;
  }
  if (branch === 'main') return false;
  const missing = WAVES.filter((wave) => !stamped(dir).includes(wave));
  if (missing.length === 0) return false;
  process.stderr.write(
    `gate: ${branch} at ${git(dir, 'rev-parse', '--short', 'HEAD')} has no green ${missing.join(' or ')} wave. ` +
      `Commit, then run ${missing.map((wave) => `\`yarn verify:${wave}\``).join(' and ')} before pushing ` +
      '(AGENTS.md, Pre-verify).\n',
  );
  return true;
};

const hook = () => {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const calls = gatedCalls(input.tool_input?.command ?? '', input.cwd ?? process.cwd());
  if (calls.some(refuse)) process.exit(2);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, wave] = process.argv.slice(2);
  if (command === 'stamp' && WAVES.includes(wave)) stamp(wave);
  else if (command === 'hook') hook();
  else {
    console.error(`usage: node tools/gate.mjs stamp <${WAVES.join('|')}> | hook`);
    process.exit(1);
  }
}
