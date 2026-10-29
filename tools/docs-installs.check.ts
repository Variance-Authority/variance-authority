import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { MARKDOWN, PUBLIC_MARKDOWN, ROOT, flat, lineOf, prose } from './markdown.js';

/**
 * What we ship is installed, never copied.
 *
 * A package comes from npm and the GitHub action from its own repository, by
 * version, so an upgrade is a version bump and a fix reaches everyone who
 * named it. A file a reader copies out of this repository is a fork the day it
 * lands: it never hears about the next release, and nothing tells its owner it
 * fell behind. The workflow files here once called themselves recipes, "meant
 * to be copied", and the action was named by a path into this repository.
 *
 * Two rules. No page, workflow comment or README anywhere asks a reader to copy
 * or paste one of our files into theirs. And no published page links into
 * `.github/`, because what lives there is this repository's own build, and a
 * link is how a page hands a reader a file to copy.
 */

/** Records of what happened, which quote the old wording rather than ask anything of a reader. */
const HISTORY = /^(?:docs\/context\/|backlog\/)/;

const WORKFLOWS: readonly string[] = execFileSync('git', ['ls-files', '.github/**/*.yml', '.github/**/*.yaml'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean);

/** A workflow's comments, read the way `flat` reads a page: one line, as a person hears it. */
function comments(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8')
    .split('\n')
    .map((line) => /^\s*#\s?(.*)$/.exec(line)?.[1])
    .filter((line): line is string => line !== undefined)
    .join(' ')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ');
}

const ASKS_TO_COPY = [
  /\b(?:copy|copied|copying|paste|pasted|pasting)\b[^.]{0,80}?\b(?:into|to|in) your (?:own )?(?:repository|repo|project|workflows?|\.github)\b/i,
  /\b(?:meant|made|written) to be (?:copied|pasted)\b/i,
  /\bif you copy\b/i,
  /\byour copy\b/i,
];

function asks(text: string): string[] {
  return ASKS_TO_COPY.flatMap((rule) => [...text.matchAll(new RegExp(rule, 'gi'))].map((match) => match[0]));
}

describe('nothing asks a reader to copy our files', () => {
  it.each(MARKDOWN.filter((file) => !HISTORY.test(file)))('%s', (file) => {
    expect(asks(flat(file))).toEqual([]);
  });

  it.each(WORKFLOWS)('%s', (file) => {
    expect(asks(comments(file))).toEqual([]);
  });
});

// The action's own directory is the root of Variance-Authority/action, so a link
// that stays inside it is a link within that repository.
const ACTION = '.github/actions/variance';

const INTO_GITHUB =
  /^https?:\/\/(?:github\.com\/Variance-Authority\/variance-authority\/(?:blob|tree|raw)\/[^/]+\/\.github\/|raw\.githubusercontent\.com\/Variance-Authority\/variance-authority\/)/i;

describe('no published page links into this repository’s .github', () => {
  it.each(PUBLIC_MARKDOWN)('%s', (file) => {
    const text = prose(file);
    const links: string[] = [];
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1]!;
      if (target.startsWith('mailto:')) continue;
      if (/^https?:/.test(target)) {
        if (INTO_GITHUB.test(target)) links.push(`${file}:${lineOf(text, match.index)} → ${target}`);
        continue;
      }
      const [path] = target.split('#') as [string];
      if (path === '') continue;
      const inside = relative(ROOT, resolve(dirname(join(ROOT, file)), path));
      const withinAction = file.startsWith(`${ACTION}/`) && inside.startsWith(`${ACTION}/`);
      if (!withinAction && (inside === '.github' || inside.startsWith('.github/'))) {
        links.push(`${file}:${lineOf(text, match.index)} → ${target}`);
      }
    }
    expect(links).toEqual([]);
  });
});
