/**
 * The verification gate on an agent's push. `stamp` ends each verify wave,
 * `pre-push` is the git hook, and `install` registers it after `yarn install`.
 * A stamp is a record the wave scripts write, not proof: CI is the proof.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WAVES = ['near', 'rules'];
const ABSENT = /^0+$/;
// A branch cut before the gate has no `tools/gate.mjs`, and is not asked.
const COMMAND = 'test ! -f tools/gate.mjs || node tools/gate.mjs pre-push';

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const stamps = () => {
  const path = resolve(git('rev-parse', '--git-path', 'variance-gate'));
  mkdirSync(path, { recursive: true });
  return path;
};

const wavesOn = (tree) => {
  const file = join(stamps(), tree);
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
};

// Records that a wave passed on the tree `HEAD` holds, in the checkout's own git
// directory, so nothing tracked moves. A dirty tree is not stamped.
const stamp = (wave) => {
  if (git('status', '--porcelain') !== '') {
    console.log(`gate: ${wave} is not stamped; the tree has uncommitted changes. Commit, then run the wave again.`);
    return;
  }
  appendFileSync(join(stamps(), git('rev-parse', 'HEAD^{tree}')), `${wave}\n`);
  console.log(`gate: ${wave} stamped on ${git('rev-parse', '--short', 'HEAD')}`);
};

/**
 * The pushed commits that lack a wave, from git's `pre-push` input: one line
 * per ref, `<local ref> <local sha> <remote ref> <remote sha>`.
 */
export const unverified = (input, treeOf, wavesOn) =>
  input
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([ref, sha, remote]) => sha && !ABSENT.test(sha) && !`${ref} ${remote}`.includes('refs/tags/'))
    .map(([ref, sha]) => ({ ref, sha, missing: WAVES.filter((wave) => !wavesOn(treeOf(sha)).includes(wave)) }))
    .filter(({ missing }) => missing.length > 0);

// Registers the gate as a configured hook, which git runs beside the script in
// `.git/hooks`, so Git LFS keeps its own hooks and `git lfs install` its say.
// Git appends the remote to the command, which the gate does not read.
const install = () => {
  if (git('config', '--default', '', 'hook.variance-gate.command') === COMMAND) return;
  execFileSync('git', ['config', 'hook.variance-gate.event', 'pre-push']);
  execFileSync('git', ['config', 'hook.variance-gate.command', COMMAND]);
  console.log('gate: git runs the gate before an agent\'s push');
};

// Refuses, with exit 1, every commit an agent pushes whose tree lacks a wave.
// A person's push is not asked.
const prePush = () => {
  if (!process.env.CLAUDECODE) return;
  const refused = unverified(readFileSync(0, 'utf8'), (sha) => git('rev-parse', `${sha}^{tree}`), wavesOn);
  for (const { ref, sha, missing } of refused)
    process.stderr.write(
      `gate: ${ref} at ${sha.slice(0, 9)} has no green ${missing.join(' or ')} wave. Check it out, commit, then ` +
        `run ${missing.map((wave) => `\`yarn verify:${wave}\``).join(' and ')} (AGENTS.md, Pre-verify).\n`,
    );
  if (refused.length > 0) process.exit(1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, wave] = process.argv.slice(2);
  if (command === 'stamp' && WAVES.includes(wave)) stamp(wave);
  else if (command === 'pre-push') prePush();
  else if (command === 'install') install();
  else {
    console.error(`usage: node tools/gate.mjs stamp <${WAVES.join('|')}> | pre-push | install`);
    process.exit(1);
  }
}
