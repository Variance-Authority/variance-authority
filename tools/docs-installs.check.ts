import { describe, expect, it } from 'vitest';
import { SOURCE, commentsOf } from './comments.js';
import { MARKDOWN, PUBLIC_MARKDOWN, fencesIn, lineOf, linksIn, prose } from './markdown.js';

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
 * Three rules. No page and no comment asks a reader to copy or paste one of our
 * files. No example installs the action by anything but its name. And no
 * published page points into `.github/`, because what lives there is this
 * repository's own build, and a link is how a page hands a reader a file to
 * copy.
 */

/** Records of what happened, which quote the old wording rather than ask anything of a reader. */
const HISTORY = /^(?:docs\/context\/|backlog\/)/;

/** The action's own directory: the root of `Variance-Authority/action`, which a release publishes. */
const ACTION = '.github/actions/variance';

/** One of our files, as a sentence names it: this repository, or a path under `.github/`. */
const OURS = String.raw`(?:Variance-Authority\/variance-authority|\.github\/|actions\/variance|variance(?:-[\w-]+)?\.ya?ml)`;

const COPY = String.raw`\b(?:copy|copied|copying|paste|pasted|pasting|vendor|vendored)\b`;

/**
 * A request to copy one of our files: the verb, then the file, in one clause, which
 * a path's own dots and slashes do not end.
 * Keyed on the file rather than the verb, because copying an exported constant
 * into your own options is how a library is used, and bounded by the clause, so
 * a sentence that states this rule is not read as breaking it.
 */
const ASKS_TO_COPY = [
  new RegExp(String.raw`${COPY}(?:[^.,;:]|[.,;:](?!\s)){0,80}?${OURS}`, 'gi'),
  /\b(?:meant|made|written) to be (?:copied|pasted)\b/gi,
];

/** Markup and comment openers become spaces, so a phrase reads across them and a match keeps its line. */
function plain(text: string): string {
  return text.replace(/[`*_#\\]|\/\/|\/\*|\*\//g, (found) => ' '.repeat(found.length));
}

function asks(file: string, text: string): string[] {
  const read = plain(text);
  return ASKS_TO_COPY.flatMap((rule) =>
    [...read.matchAll(rule)].map((match) => `${file}:${lineOf(read, match.index)} → ${match[0].replace(/\s+/g, ' ')}`),
  );
}

const READ = MARKDOWN.filter((file) => !HISTORY.test(file));

describe('nothing asks a reader to copy our files', () => {
  it.each(READ)('%s', (file) => {
    expect(asks(file, prose(file))).toEqual([]);
  });

  it.each(SOURCE)('%s', (file) => {
    expect(asks(file, commentsOf(file))).toEqual([]);
  });
});

/** Our raw files and our `.github` on GitHub: a URL a reader fetches or copies from. */
const INTO_GITHUB =
  /https?:\/\/(?:github\.com\/Variance-Authority\/variance-authority\/(?:blob|tree|raw)\/[^/\s]+\/\.github\/|raw\.githubusercontent\.com\/Variance-Authority\/variance-authority\/)[^\s)>`'"]*/gi;

describe('every example installs the action by its name', () => {
  it.each(READ)('%s', (file) => {
    const wrong: string[] = [];
    for (const fence of fencesIn(file)) {
      fence.code.split('\n').forEach((text, at) => {
        const line = fence.line + 1 + at;
        const uses = /^\s*-?\s*uses:\s*['"]?([^\s'"]+)/.exec(text)?.[1];
        const ours = uses !== undefined && /^(?:\.\/|Variance-Authority\/)|actions\/variance/i.test(uses);
        if (ours && !uses.startsWith('Variance-Authority/action@')) wrong.push(`${file}:${line} → ${uses}`);
        for (const match of text.matchAll(INTO_GITHUB)) wrong.push(`${file}:${line} → ${match[0]}`);
      });
    }
    expect(wrong).toEqual([]);
  });
});

describe('no published page points into this repository’s .github', () => {
  it.each(PUBLIC_MARKDOWN)('%s', (file) => {
    const text = prose(file);
    const into = [...text.matchAll(INTO_GITHUB)].map((match) => `${file}:${lineOf(text, match.index)} → ${match[0]}`);
    for (const { target, line, inside } of linksIn(file)) {
      if (inside === undefined) continue;
      const withinAction = file.startsWith(`${ACTION}/`) && inside.startsWith(`${ACTION}/`);
      if (!withinAction && (inside === '.github' || inside.startsWith('.github/'))) into.push(`${file}:${line} → ${target}`);
    }
    expect(into).toEqual([]);
  });
});
