#!/usr/bin/env node
//
// A pull request's pictures go when it does, merged or not.
//
// The action pushes them to `<prefix>/<project>/images/<head branch>`, one ref
// per project, and keeps them for the comment to link while the pull request is
// open. This deletes every project's ref for the branch, found by listing the
// prefix rather than by naming each project, so a config added later cannot
// strand its pictures. `<project>` is one segment, as `variance carry` writes
// it, so what follows it must be the branch exactly: `feature` does not take
// `feature/x`'s images.
//
// Git lists and deletes, so a ref is spelled as git spells it and nothing is
// escaped for a URL. A fork's pull request is skipped: its run could not push,
// and its token could not delete. No SDK and no dependency, for the reason
// `post-comment.mjs` gives.
//
// Usage:
//   node images.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const note = (message) => console.log(`variance: ${message}`);

function fail(message) {
  console.log(`::error::variance: ${message}`);
  process.exit(2);
}

const { GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_SERVER_URL, GITHUB_TOKEN } = process.env;
const prefix = process.env.VARIANCE_IMAGE_REF_PREFIX ?? '';
if (!prefix.startsWith('refs/')) fail(`image-ref-prefix must name refs, such as refs/variance/project, not "${prefix}"`);

const event = JSON.parse(readFileSync(GITHUB_EVENT_PATH, 'utf8'));
const pull = event.pull_request;
if (pull === undefined) fail('runs on a pull_request event, and this one carries no pull request');
const branch = pull.head.ref;

// A job that also runs while the pull request is open would delete what the
// action has just pushed for its comment.
if (event.action !== 'closed') {
  note(`${branch}'s pull request is not closed (${event.action}), so its images stay.`);
  process.exit(0);
}

if (pull.head.repo?.full_name !== GITHUB_REPOSITORY) {
  note(`${branch} is a fork's branch: its run could push no images here, so there is nothing to delete.`);
  process.exit(0);
}

const remote = `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}.git`;
const auth = GITHUB_TOKEN ? Buffer.from(`x-access-token:${GITHUB_TOKEN}`).toString('base64') : '';
if (auth) console.log(`::add-mask::${auth}`);

// Git runs from an empty repository of its own: `push` needs one to push from,
// and a checkout's saved credentials never stand in for the token.
const scratch = mkdtempSync(join(tmpdir(), 'variance-images-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

/** Git against the pull request's repository, with the token. A failure fails the step, so a listing nobody read never reads as no images. */
function git(args) {
  const header = auth ? ['-c', `http.extraheader=AUTHORIZATION: basic ${auth}`] : [];
  try {
    return execFileSync('git', [...header, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, GIT_DIR: scratch },
    });
  } catch {
    fail(`git ${args[0]} on ${GITHUB_REPOSITORY} failed; the images are where they were.`);
  }
}

git(['init', '-q', '--bare', scratch]);

// The pattern is a glob matched against a ref's tail, so it only narrows the
// listing, and the exact match is read below.
const glob = `${prefix.replace(/[*?[\\]/g, '\\$&')}/*`;
const wanted = `/images/${branch}`;
const refs = git(['ls-remote', '--refs', remote, glob])
  .split('\n')
  .map((line) => line.split('\t')[1])
  .filter((ref) => {
    if (!ref?.startsWith(`${prefix}/`)) return false;
    const rest = ref.slice(prefix.length + 1);
    const project = rest.indexOf('/');
    return project > 0 && rest.slice(project) === wanted;
  });

if (refs.length === 0) {
  note(`no images under ${prefix} for ${branch}; nothing to delete.`);
  process.exit(0);
}

git(['push', '-q', remote, '--delete', ...refs]);
for (const ref of refs) note(`deleted ${ref}`);
