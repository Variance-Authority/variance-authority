#!/usr/bin/env node
//
// Publishing what `changeset pack` packed, with `npm publish`.
//
// Yarn packs and npm publishes. `yarn pack` is what rewrites `workspace:^` to
// the version it names and runs each package's `prepack`, so the tarball is
// already what an install reads. Publishing is npm's because of what signs the
// provenance: Yarn's sigstore client gives the transparency log five seconds,
// then resends the same signed envelope and reads the log's "an equivalent
// entry already exists" as a failure. 0.17.1 and 0.18.0 lost names to it on
// every attempt. npm hands the same client its `fetch-timeout`, five minutes.
//
// `changeset publish` would do this itself, but it picks the publishing tool
// from the workspace, and the Yarn tool refuses a tarball. So changesets plans
// and packs, and this publishes its plan: each group in order, each name the
// registry does not hold yet, and nothing after a group a name failed in,
// because what depends on that name would be installable before it is.
// Skipping what the registry holds makes it the repair for its own partial
// run, so it is run again rather than resumed.
//
//   yarn changeset pack --out-dir <dir>
//   node tools/publish.mjs <dir>

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { onRegistry } from './released.mjs';

/** How many `npm publish` run at once. */
export const PARALLEL = 10;

/** The groups `changeset pack` planned, each holding only what it publishes. */
export function planOf(dir) {
  const { version, plan } = JSON.parse(readFileSync(resolve(dir, 'publish-plan.json'), 'utf8'));
  if (version !== 1 || !Array.isArray(plan)) {
    throw new Error(`${resolve(dir, 'publish-plan.json')} is not a version 1 publish plan`);
  }
  return plan.map((group) => group.filter((release) => release.kind === 'publish'));
}

/** The `npm` arguments that publish one packed release, signed. */
export function npmArguments(dir, release) {
  const tarball = resolve(dir, release.tarball.path);
  return ['publish', tarball, '--access', release.access, '--tag', release.tag, '--provenance'];
}

/** `npm` with these arguments, its output the job's, refused on a non-zero exit. */
function npm(args) {
  return new Promise((done, refuse) => {
    const child = spawn('npm', args, { stdio: 'inherit' });
    child.on('error', refuse);
    child.on('exit', (code) => (code === 0 ? done() : refuse(new Error(`npm ${args.join(' ')} exited ${code}`))));
  });
}

/**
 * Publishes the plan packed in `dir`, and answers the releases that failed.
 * The registry and the command are handed in by a test.
 */
export async function publish(dir, run = { registry: onRegistry, npm }) {
  const failed = [];
  for (const group of planOf(dir)) {
    // Ten at a time, as `changeset publish` sends them: a first group holds
    // most of the release, and every name in it signs against the same log.
    const queue = [...group];
    const next = async () => {
      for (let release = queue.shift(); release; release = queue.shift()) {
        const named = `${release.name}@${release.version}`;
        try {
          if (await run.registry(release.name, release.version)) continue;
          await run.npm(npmArguments(dir, release));
        } catch (error) {
          failed.push(named);
          console.error(`${named} did not publish: ${error.message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, group.length) }, next));
    if (failed.length > 0) break;
  }
  return failed;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: node tools/publish.mjs <the directory `changeset pack --out-dir` wrote>');
  const failed = await publish(dir);
  if (failed.length > 0) {
    console.error(`\n${failed.length} did not publish: ${failed.join(', ')}`);
    process.exit(1);
  }
}
