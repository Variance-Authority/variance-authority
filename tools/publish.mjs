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
// because what depends on that name would be installable before it is. Skipping
// what the registry shows, and taking npm's "previously staged" refusal as a
// version it already holds, makes it the repair for its own partial run: it is
// run again rather than resumed, and a version it sends again because npm has
// not shown it yet is refused, read as held, and costs nothing.
//
//   yarn changeset pack --out-dir <dir>
//   node tools/publish.mjs <dir>
//
// A name npm has never held is the exception, because the workflow cannot
// create one: npm adds a trusted publisher only to a package that exists. A
// person creates it once, logged in to npm, and the release refuses until then:
//
//   node tools/publish.mjs --placeholders [name...]

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { onRegistry, publishable, unborn } from './released.mjs';

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

/**
 * `npm` with these arguments, its output the job's, refused on a non-zero exit
 * with what it printed to stderr, which is where npm says why.
 */
function npm(args, input = 'ignore') {
  return new Promise((done, refuse) => {
    const child = spawn('npm', args, { stdio: [input, 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', refuse);
    child.on('close', (code) =>
      code === 0 ? done() : refuse(Object.assign(new Error(`npm ${args.join(' ')} exited ${code}`), { stderr })),
    );
  });
}

/**
 * Whether npm refused a publish because it already holds the version.
 *
 * npm answers a publish once it has accepted the version, and shows it only
 * after scanning it: 0.19.0's `core` was accepted and not shown two minutes
 * later. Sending it again is refused with 409 "previously staged" for as long
 * as npm holds it, which is to say forever, so that refusal is the version
 * being npm's rather than a publish that failed. The registry check after the
 * publish waits for it to show.
 */
export function held(error) {
  return /previously staged version/i.test(String(error?.stderr ?? ''));
}

/**
 * Whether npm refused a publish from the workflow for want of a login, which is
 * what it answers for a name with no trusted publisher: one it never held, as
 * on 0.20.0, or one a placeholder run created and did not finish trusting.
 */
export function untrusted(error) {
  return /ENEEDAUTH/.test(String(error?.stderr ?? ''));
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
          if (held(error)) {
            console.log(`::warning::${named} is already npm's and not shown yet; the registry check waits for it`);
            continue;
          }
          failed.push(named);
          console.error(`${named} did not publish: ${error.message}`);
          if (untrusted(error)) {
            console.error(`npm asked for a login, which it does for a name with no trusted publisher for release.yml; if ${release.name} is new or half made, finish it by hand: ${placeholdersCommand([release.name])}`);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, group.length) }, next));
    if (failed.length > 0) break;
  }
  return failed;
}

/** The version a placeholder carries, which no release does. */
export const PLACEHOLDER = '0.0.0-placeholder.0';

/** The command that creates these names and trusts the workflow with them. */
export function placeholdersCommand(names) {
  return ['node tools/publish.mjs --placeholders', ...names].join(' ');
}

/**
 * The names a person asked to create, refused whole if one is not a package
 * this repository publishes: a published name cannot be taken back, so a typo
 * or a stray flag must never reach npm.
 */
export function askedFor(asked, packages) {
  const known = new Set(packages.map((entry) => entry.name));
  const unknown = asked.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `not a package this repository publishes: ${unknown.join(', ')}\nthe packages are:\n${[...known].map((name) => `  ${name}`).join('\n')}`,
    );
  }
  return asked;
}

/**
 * Creates each name, and trusts the release workflow with it.
 *
 * What is published is a manifest at `0.0.0-placeholder.0`, a version no
 * release carries, under the `placeholder` tag. The real version is the
 * workflow's to publish: signed, which npm does only from CI, and after the
 * siblings it depends on, which a hand publish of it would precede. A manifest
 * needs no build, so a platform package is created from any machine. Then the
 * trusted publisher, which names this repository, `release.yml` and the `npm`
 * environment, as ADR-0060 has it.
 *
 * Publishing and trusting are two calls, and either can fail with the name
 * half made: a second factor that timed out leaves it created and untrusted,
 * and the release check reads such a name as held. So the first failure stops
 * the rest and is refused with the names still unfinished, and running it again
 * on those names finishes them: a name the registry shows is not published
 * again, so a placeholder never lands on a package with real versions, and one
 * npm refuses as previously staged because it does not show it yet is read as
 * created. `npm` and the registry are handed in by a test.
 */
export async function placeholders(names, run = { npm: byHand, registry: onRegistry }) {
  const created = [];
  for (const [at, name] of names.entries()) {
    try {
      if (!(await run.registry(name))) {
        const dir = mkdtempSync(join(tmpdir(), 'placeholder-'));
        try {
          writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name, version: PLACEHOLDER }, null, 2)}\n`);
          await run.npm(['publish', dir, '--access', 'public', '--tag', 'placeholder']);
        } catch (error) {
          if (!held(error)) throw error;
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
      await run.npm([
        'trust',
        'github',
        name,
        '--file',
        'release.yml',
        '--repo',
        'Variance-Authority/variance-authority',
        '--env',
        'npm',
        '--allow-publish',
        '--yes',
      ]);
      created.push(name);
    } catch (error) {
      throw Object.assign(error, { unfinished: names.slice(at) });
    }
  }
  return created;
}

/**
 * `npm` at a person's terminal, which may ask for a second factor: npm asks
 * only when both its input and its output are the terminal.
 */
function byHand(args) {
  return npm(args, 'inherit');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href && process.argv[2] === '--placeholders') {
  const asked = process.argv.slice(3);
  let names;
  try {
    names = asked.length > 0 ? askedFor(asked, publishable()) : (await unborn(publishable())).map((entry) => entry.name);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (names.length === 0) console.log('npm holds every name; nothing to create.');
  try {
    for (const name of await placeholders(names)) console.log(`created ${name} and trusted release.yml with it`);
  } catch (error) {
    console.error(`\n${error.message}\n\nThese are not finished. Run this again once the cause is fixed:\n\n  ${placeholdersCommand(error.unfinished)}`);
    process.exit(1);
  }
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: node tools/publish.mjs <the directory `changeset pack --out-dir` wrote>');
  const failed = await publish(dir);
  if (failed.length > 0) {
    console.error(`\n${failed.length} did not publish: ${failed.join(', ')}`);
    process.exit(1);
  }
}
