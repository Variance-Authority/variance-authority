import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import read from '@changesets/read';

/**
 * Whether the release that just ran is the release that was supposed to run.
 *
 * Twice now a release step has reported success while doing part of its job.
 * 0.5.6 reached five of the thirty-eight names — `core`, `ioc`, `package`,
 * `wire`, `sense-darwin-arm64`, which is `changeset publish`'s topological
 * order truncated — and the other thirty-three skipped from 0.5.5 to 0.5.8 with
 * nothing red anywhere. 0.5.8 published all thirty-eight and tagged none of
 * them: `changeset publish` said "Created git tags." and the push on the next
 * line said "Everything up-to-date".
 *
 * Both are the same failure and neither is detectable from the exit code of the
 * thing that failed. So the exit code is not what is asked. The registry is
 * asked whether it holds every name at the version the manifests carry, and the
 * remote is asked whether it holds every tag — because those two questions are
 * what "released" means, and a step that cannot answer them has not finished
 * regardless of what it printed.
 *
 * A partial publish is also *repairable* by the thing that caused it:
 * `tools/publish.mjs` skips versions the registry already has, so pressing the
 * button again completes a truncated release rather than doubling one. That is
 * why `release.yml` publishes once and asks here, giving npm the time it takes
 * to show what it accepted, rather than trusting the exit code. What must never happen is the third outcome — a partial release that
 * finishes green.
 *
 * Run it by hand at any time to see where the registry stands:
 *
 *     node tools/released.mjs            # is main's version fully out, and tagged?
 *     node tools/released.mjs --wait 120 # the same, tolerating registry lag
 *     node tools/released.mjs --registry # skip the tag half
 *     node tools/released.mjs --lockstep # before publishing: is there one version to publish, and nothing waiting?
 *     node tools/released.mjs --named    # before publishing: has npm held every name before?
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every package a release publishes, the version its manifest carries, and the
 * directory it is published from, relative to the root.
 *
 * Two directories, because the four `sense-<platform>` packages live under
 * `packages/sense/npm/` rather than beside their siblings — they are build
 * output with a manifest, and `sense` names them as optional dependencies. They
 * are published by the same publish as everything else and were
 * missed by the same truncation, so a check that reads only `packages/*` would
 * have called the split 0.5.6 complete.
 *
 * `private` is what excludes a workspace, matching the registry's own rule
 * rather than a list kept here that a new package would have to be added to.
 */
export function publishable() {
  const dirs = [
    ...readdirSync(join(ROOT, 'packages')).map((name) => join(ROOT, 'packages', name)),
    ...readdirSync(join(ROOT, 'packages', 'sense', 'npm')).map((name) =>
      join(ROOT, 'packages', 'sense', 'npm', name),
    ),
  ];

  const found = [];
  for (const dir of dirs) {
    const at = join(dir, 'package.json');
    if (!existsSync(at)) continue;
    const manifest = JSON.parse(readFileSync(at, 'utf8'));
    if (manifest.private === true || manifest.name === undefined) continue;
    found.push({ name: manifest.name, version: manifest.version, directory: relative(ROOT, dir) });
  }
  return found.sort((one, other) => one.name.localeCompare(other.name));
}

/**
 * The one version the whole product is at, or a refusal to guess.
 *
 * `.changeset/config.json` holds every `@variance-authority/*` package in one
 * `fixed` group, so disagreement here is not a thing to work around by picking
 * the most common answer — it means something wrote a version outside
 * `changeset version`, and publishing from that state is how a release goes out
 * naming siblings that will never exist.
 */
export function lockstep(packages) {
  const versions = [...new Set(packages.map((entry) => entry.version))];
  if (versions.length === 1) return versions[0];
  const listing = packages.map((entry) => `  ${entry.version.padEnd(10)} ${entry.name}`).join('\n');
  throw new Error(`the packages are not at one version:\n${listing}`);
}

/**
 * The changesets on this checkout that `changeset version` has not yet raised a
 * version for, by file name.
 *
 * Publishing past one would ship changes the version does not account for, so
 * the changelog would miss them and the number would understate what shipped.
 * A changeset that names no package — what `changeset --empty` writes —
 * releases nothing and is not waiting for anything. Changesets reads its own
 * files, so one it cannot parse refuses here as it would refuse `version`.
 */
export async function waiting(cwd = ROOT) {
  const changesets = await read(cwd);
  return changesets
    .filter((changeset) => changeset.releases.length > 0)
    .map((changeset) => `${changeset.id}.md`)
    .sort();
}

/**
 * Whether the registry holds one exact version.
 *
 * The version-specific document rather than the packument, deliberately. The
 * full packument is served from a CDN that stayed minutes behind on the 0.5.8
 * release — twenty names still reading 0.5.5 after a publish log that listed
 * all thirty-eight — while `/<name>/<version>` answered immediately. Asking the
 * cheaper question would make this check flap on exactly the release it exists
 * to watch.
 *
 * With no version, whether the registry holds the name at all, which only the
 * packument answers, abbreviated. It lags the same way, so a name created
 * minutes ago can still read as never held: the refusal it feeds is pressed
 * again, not worked around.
 */
export async function onRegistry(name, version) {
  const at = `https://registry.npmjs.org/${name.replace('/', '%2f')}${version === undefined ? '' : `/${version}`}`;
  const accept = version === undefined ? 'application/vnd.npm.install-v1+json' : 'application/json';
  const answer = await fetch(at, { headers: { accept } });
  if (answer.status === 200) return true;
  if (answer.status === 404) return false;
  throw new Error(`${at} answered ${answer.status}`);
}

/**
 * The packages the registry has never held.
 *
 * The workflow publishes through a trusted publisher, and npm adds one only to
 * a package that exists, so the workflow cannot create a name: 0.20.0
 * published the first ten names and stopped at the eleventh, a new one, with
 * ENEEDAUTH. A new name is published once by a person, and the release asks
 * this before its first publish so it refuses whole rather than in part. A
 * registry that does not answer refuses too: what it did not say is not that
 * the name is held. `ask` is handed in by a test.
 */
export async function unborn(packages, { ask = onRegistry } = {}) {
  const held = await Promise.all(packages.map((entry) => ask(entry.name)));
  return packages.filter((_, at) => !held[at]);
}

/** Every tag on the remote, by name. One call, because thirty-eight is not thirty-eight calls. */
function tagsOnRemote() {
  const printed = execFileSync('git', ['ls-remote', '--tags', 'origin'], { cwd: ROOT, encoding: 'utf8' });
  const found = new Set();
  for (const line of printed.split('\n')) {
    const ref = line.split('\t')[1];
    // `^{}` is the commit an annotated tag points at, listed as a second line
    // for the same tag. It is the same tag.
    if (ref?.startsWith('refs/tags/')) found.add(ref.slice('refs/tags/'.length).replace(/\^\{\}$/, ''));
  }
  return found;
}

/**
 * What is missing, after giving the registry the time named.
 *
 * Polling rather than one look, because a publish and the question "did it
 * publish" are seconds apart in CI and npm is entitled to a moment. The wait is
 * spent only while something is still missing: a complete release answers on
 * the first pass and the step costs one round trip per package.
 *
 * A registry that did not answer — a 5xx, a dropped connection — is asked
 * again on the next pass, because one bad answer in a twenty-minute wait
 * would end a release that the next pass would have counted. It is not counted as
 * missing: what the registry did not say is not that the name is absent. A
 * name still unanswered when the wait is spent refuses, naming why.
 * `ask` and `everyMs` are handed in by a test.
 */
export async function missing(packages, version, waitSeconds = 0, { ask = onRegistry, everyMs = 5000 } = {}) {
  const until = Date.now() + waitSeconds * 1000;
  let absent = packages;
  for (;;) {
    const answers = await Promise.allSettled(absent.map((entry) => ask(entry.name, version)));
    const unanswered = answers.flatMap((answer) => (answer.status === 'rejected' ? [answer.reason] : []));
    absent = absent.filter((_, at) => answers[at].status === 'rejected' || !answers[at].value);
    if (absent.length === 0) return absent;
    if (Date.now() >= until) {
      if (unanswered.length > 0) throw new Error(unanswered.map((reason) => reason.message).join('; '));
      return absent;
    }
    await new Promise((wake) => setTimeout(wake, everyMs));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const waitAt = argv.indexOf('--wait');
  const wait = waitAt === -1 ? 0 : Number(argv[waitAt + 1]);
  const skipTags = argv.includes('--registry');

  const packages = publishable();
  const version = lockstep(packages);

  console.log(`${packages.length} packages at ${version}`);

  // Before a release, the only answerable questions: the fixed group agrees on
  // one version, so there is a single thing to publish and a single thing to
  // check for afterwards, and nothing on `main` is waiting for a version.
  // Asking the registry here would fail by design.
  if (argv.includes('--lockstep')) {
    const unversioned = await waiting();
    if (unversioned.length > 0) {
      console.error('unversioned changesets on main:');
      for (const name of unversioned) console.error(`  .changeset/${name}`);
      console.error('merge the version pull request first — its diff is what this would publish');
      process.exit(1);
    }
    process.exit(0);
  }

  if (argv.includes('--named')) {
    const unpublished = await unborn(packages);
    if (unpublished.length > 0) {
      console.error(`npm has never held ${unpublished.length === 1 ? 'this package' : 'these packages'}, and the workflow cannot create one:`);
      for (const entry of unpublished) console.error(`  ${entry.name}`);
      console.error(`
Create ${unpublished.length === 1 ? 'it' : 'them'} once from your machine, logged in to npm, then run release again:

  node tools/publish.mjs --placeholders

CONTRIBUTING.md, under Releasing, says what that publishes and why.`);
      process.exit(1);
    }
    process.exit(0);
  }

  const absent = await missing(packages, version, wait);
  const tags = skipTags ? null : tagsOnRemote();
  const untagged = tags === null ? [] : packages.filter((entry) => !tags.has(`${entry.name}@${version}`));

  for (const entry of packages) {
    const published = !absent.includes(entry);
    const tagged = tags === null || !untagged.includes(entry);
    console.log(`${published ? 'npm' : ' — '} ${tagged ? 'tag' : ' — '}  ${entry.name}`);
  }

  if (absent.length > 0) {
    console.error(`\n${absent.length} of ${packages.length} packages are not on the registry at ${version}:`);
    for (const entry of absent) console.error(`  ${entry.name}`);
    console.error('`tools/publish.mjs` skips what is already there — running it again completes this.');
  }
  if (untagged.length > 0) {
    console.error(`\n${untagged.length} of ${packages.length} versions have no tag on origin:`);
    for (const entry of untagged) console.error(`  ${entry.name}@${version}`);
    console.error('`yarn changeset tag && git push origin --tags` creates and pushes them.');
  }
  if (absent.length > 0 || untagged.length > 0) process.exit(1);
  console.log(`\n${version} is fully published${tags === null ? '' : ' and fully tagged'}.`);
}
