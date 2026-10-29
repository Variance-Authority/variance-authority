/**
 * The verification gate on an agent's push: `node tools/gate.mjs stamp <wave>`
 * ends `yarn verify:near` and `yarn verify:rules`, and `node tools/gate.mjs
 * pre-push` is the git `pre-push` hook in `tools/git-hooks`. `yarn install`
 * points `core.hooksPath` at the primary checkout's copy, so every worktree,
 * however old its branch, runs the hooks `main` holds, Git LFS's among them.
 *
 * `stamp` records that a wave passed on the tree `HEAD` holds, in the
 * checkout's own git directory, so nothing tracked moves and each worktree
 * keeps its own. A tree with uncommitted changes is not stamped: the wave ran
 * on something no commit holds. A stamp is a record the wave scripts write,
 * not proof: anyone can write the file, and the gate guards the workflow, not
 * against an author who means to skip it. CI is the proof.
 *
 * `install` runs after `yarn install`. Once the primary checkout holds
 * `tools/git-hooks`, it points `core.hooksPath` there; before that it leaves
 * git's hooks alone, so a checkout never loses the Git LFS hooks.
 *
 * `pre-push` reads the refs git is about to push and refuses, with exit 1,
 * every pushed commit whose tree lacks a `near` or `rules` stamp — the commit
 * pushed, whichever branch is checked out. A deletion and a tag are not asked.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WAVES = ['near', 'rules'];
const ABSENT = /^0+$/;

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

const install = () => {
  const hooks = resolve(git('rev-parse', '--path-format=absolute', '--git-common-dir'), '..', 'tools', 'git-hooks');
  if (!existsSync(join(hooks, 'pre-push'))) return;
  if (git('config', '--default', '', 'core.hooksPath') === hooks) return;
  execFileSync('git', ['config', 'core.hooksPath', hooks]);
  console.log(`gate: git runs the hooks in ${hooks}`);
};

const prePush = () => {
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
