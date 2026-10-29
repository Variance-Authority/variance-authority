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
  /https?:\/\/(?:github\.com\/Variance-Authority\/variance-authority\/(?:blob|tree|raw)|raw\.githubusercontent\.com\/Variance-Authority\/variance-authority)\/[^/\s]+\/\.github\/[^\s)>`'"]*/gi;

/** A `uses:` that means our action: its own repository, or a path to where its source lives here. */
const NAMES_OUR_ACTION = /^(?:Variance-Authority\/action(?:@|$)|Variance-Authority\/variance-authority\/|(?:\.\/)?\.github\/actions\/variance(?:\/|$))/i;

/** The way to name it: the major tag of its inputs, which a release moves only within one major, or a commit. */
const INSTALLS_OUR_ACTION = /^Variance-Authority\/action@(?:v\d+|[0-9a-f]{40})$/;

/**
 * What is wrong with one example line's `uses:`, or nothing when it does not
 * name our action or names it by its major or a commit. A branch moves under
 * an adopter with every push, and a path is a copy of our source.
 */
export function wrongUse(text: string): string | undefined {
  const uses = /^\s*-?\s*uses:\s*['"]?([^\s'"#]+)/.exec(text)?.[1];
  if (uses === undefined || !NAMES_OUR_ACTION.test(uses)) return undefined;
  return INSTALLS_OUR_ACTION.test(uses) ? undefined : uses;
}

/**
 * A workflow that declares `permissions` sets every one it leaves out to none,
 * so an example that installs our action and grants `pull-requests` must also
 * grant `contents`, or `actions/checkout` cannot read a private repository.
 */
export function withoutContents(code: string): boolean {
  const installs = code.split('\n').some((text) => /^\s*-?\s*uses:\s*['"]?Variance-Authority\/action@/.test(text));
  return installs && /^\s*permissions:\s*$/m.test(code) && !/^\s*contents:\s*(?:read|write)\b/m.test(code);
}

describe('what names our action', () => {
  it.each([
    'uses: Variance-Authority/action@v1',
    '  - uses: Variance-Authority/action@0123456789abcdef0123456789abcdef01234567',
    'uses: ./.github/actions/other',
    'uses: Variance-Authority/other-action@main',
    'uses: actions/checkout@v4',
  ])('accepts %s', (text) => {
    expect(wrongUse(text)).toBeUndefined();
  });

  it.each([
    ['uses: Variance-Authority/action@main', 'Variance-Authority/action@main'],
    ['uses: Variance-Authority/action@v0.21.0', 'Variance-Authority/action@v0.21.0'],
    ['uses: Variance-Authority/action@v<version>', 'Variance-Authority/action@v<version>'],
    ['uses: Variance-Authority/action@anything', 'Variance-Authority/action@anything'],
    ['uses: Variance-Authority/action', 'Variance-Authority/action'],
    ['uses: ./.github/actions/variance', './.github/actions/variance'],
    [
      'uses: Variance-Authority/variance-authority/.github/actions/variance@v0.19.0',
      'Variance-Authority/variance-authority/.github/actions/variance@v0.19.0',
    ],
  ])('refuses %s', (text, uses) => {
    expect(wrongUse(text)).toBe(uses);
  });

  const steps = '\nsteps:\n  - uses: actions/checkout@v4\n  - uses: Variance-Authority/action@v1\n';

  it('asks for contents beside pull-requests, since a declared block sets the rest to none', () => {
    expect(withoutContents(`permissions:\n  pull-requests: write\n${steps}`)).toBe(true);
    expect(withoutContents(`permissions:\n  contents: read\n  pull-requests: write\n${steps}`)).toBe(false);
    expect(withoutContents(steps)).toBe(false);
  });

  it('reads a GitHub URL as ours only under .github', () => {
    const urls = [
      'https://raw.githubusercontent.com/Variance-Authority/variance-authority/main/packages/cli/schema/variance.config.schema.json',
      'https://raw.githubusercontent.com/Variance-Authority/variance-authority/main/.github/actions/variance/action.yml',
      'https://github.com/Variance-Authority/variance-authority/blob/main/.github/workflows/variance.yml',
    ];
    expect(urls.map((url) => [...url.matchAll(INTO_GITHUB)].length)).toEqual([0, 1, 1]);
  });
});

describe('every example installs the action by its name', () => {
  it.each(READ)('%s', (file) => {
    const wrong: string[] = [];
    for (const fence of fencesIn(file)) {
      if (withoutContents(fence.code)) wrong.push(`${file}:${fence.line} → permissions without contents`);
      fence.code.split('\n').forEach((text, at) => {
        const line = fence.line + 1 + at;
        const uses = wrongUse(text);
        if (uses !== undefined) wrong.push(`${file}:${line} → ${uses}`);
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
