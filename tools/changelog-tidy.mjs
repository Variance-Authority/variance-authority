import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What `changeset version` leaves behind that a lockstep product cannot use.
 *
 * `.changeset/config.json` holds every `@variance-authority/*` package in one
 * `fixed` group, so all of them move to the same version at every release.
 * Changesets still writes each package the news that its siblings moved, in two
 * shapes: an `Updated dependencies [hash]` line with the sibling list indented
 * under it, and — where a package's release is *only* the bump — a bare
 * `- @variance-authority/png@0.1.1` bullet standing on its own. At 0.1.1 that
 * was the entire entry for most of them: the published `@variance-authority/cli`
 * changelog says its dependencies reached 0.1.1 and nothing else, and
 * `png-sharp` has never said anything else at any version. The lockstep
 * guarantee already said that, and a reader who opened the file to find out
 * whether to care learned nothing.
 *
 * So the dependency bookkeeping goes, and a version left with nothing under it
 * says so in one line rather than standing as a bare heading. Everything a
 * person wrote in a changeset survives byte for byte — this removes generated
 * lines and writes one.
 *
 * It runs from `release:version`, which is the only place it can run and not be
 * forgotten: the version pull request the release workflow opens is generated
 * there too. `changelog.check.ts` is what notices when something bypassed it.
 */
export const LOCKSTEP =
  'Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.';

/**
 * What the earliest version in a file says instead.
 *
 * Thirteen packages reached their first published version without a changeset
 * describing them, so the bump was the whole entry. "Nothing in this package
 * changed" is the one thing that cannot be said about a release where all of it
 * is new, and the README shipping beside it is where the rest of the answer is.
 */
export const FIRST = 'First release.';

const UPDATED = /^- Updated dependencies \[/;
/**
 * A name carries digits — `sense-darwin-arm64`, `linux-x64-gnu`, `win32-x64-msvc`
 * — so the class cannot be letters alone. One that excluded them stopped the
 * block at the first platform package and left every sibling under it standing.
 */
const SIBLING = /^ {2}- @variance-authority\/[a-z0-9-]+@\d/;
/**
 * A sibling standing at the left margin, which is a release that was only a bump.
 *
 * Unconditional, unlike the indented form: an authored body is indented under
 * its entry, so nothing a person wrote can reach column zero as a list item.
 */
const ONLY_A_BUMP = /^- @variance-authority\/[a-z0-9-]+@\d/;
const HEADING = /^#{2,3} /;

/** Every published package's changelog, whether or not it has been written yet. */
export function changelogs() {
  return readdirSync(join(ROOT, 'packages'))
    .sort()
    .map((name) => ({ name, at: join(ROOT, 'packages', name, 'CHANGELOG.md') }));
}

/**
 * Drop everything generated: the bookkeeping, and the lines this tool writes.
 *
 * Removing its own sentences is what makes `tidy` a normalizer rather than an
 * append: a version that said the wrong one — the lockstep sentence on a first
 * release — is re-decided on the next run, and `changelog.check.ts` sees the
 * difference. What a person wrote is never at column zero as a bare bullet or as
 * one of these sentences, so nothing authored is reachable from here.
 */
function withoutBookkeeping(lines) {
  const kept = [];
  let inBlock = false;
  for (const line of lines) {
    if (line === LOCKSTEP || line === FIRST) continue;
    if (UPDATED.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && SIBLING.test(line)) continue;
    inBlock = false;
    if (ONLY_A_BUMP.test(line)) continue;
    // A changeset body is indented two spaces, which turns its blank lines into
    // lines of whitespace. Nothing here ends in a markdown hard break.
    kept.push(line.trim() === '' ? '' : line);
  }
  return kept;
}

/**
 * Where each heading sits, and whether anything follows it.
 *
 * A section runs to the next heading that outranks it or matches it, so a
 * version holds its kinds of change and a kind of change holds only its entries.
 */
function sections(lines) {
  const heads = [];
  lines.forEach((line, at) => {
    if (HEADING.test(line)) heads.push({ at, level: line.startsWith('### ') ? 3 : 2 });
  });
  return heads.map((head, index) => {
    const next = heads.slice(index + 1).find((other) => other.level <= head.level);
    const end = next?.at ?? lines.length;
    const body = lines.slice(head.at + 1, end);
    return { ...head, end, empty: body.every((line) => line === '' || HEADING.test(line)) };
  });
}

/** The changelog this one should be. Idempotent: tidying a tidy file changes nothing. */
export function tidy(text) {
  let lines = withoutBookkeeping(text.split('\n'));

  // A kind of change with no changes left under it is a heading about nothing.
  const emptied = new Set(sections(lines).filter((one) => one.level === 3 && one.empty).map((one) => one.at));
  lines = lines.filter((_, at) => !emptied.has(at));

  // A version with nothing under it did release; say what it released. The
  // lowest heading in the file is the earliest version, which is the one release
  // the lockstep sentence would be false about.
  const versions = sections(lines).filter((one) => one.level === 2);
  const earliest = versions.at(-1);
  for (const version of [...versions].reverse()) {
    if (!version.empty) continue;
    const said = version === earliest ? FIRST : LOCKSTEP;
    lines.splice(version.at + 1, version.end - version.at - 1, '', said, '');
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const changed = [];
  for (const { name, at } of changelogs()) {
    let before;
    try {
      before = readFileSync(at, 'utf8');
    } catch {
      continue;
    }
    const after = tidy(before);
    if (after === before) continue;
    writeFileSync(at, after);
    changed.push(name);
  }

  process.stdout.write(
    changed.length === 0
      ? 'changelog-tidy: nothing to remove\n'
      : `changelog-tidy: ${changed.length} file(s) — ${changed.join(', ')}\n`,
  );
}
