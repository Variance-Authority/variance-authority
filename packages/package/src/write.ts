import type { Documented, Entry, Help, Opening } from './help.js';
import { undocumented } from './help.js';

/**
 * A reading, rendered for something that reads English.
 *
 * Three pages over one value, and none of them decides anything: every ordering
 * they print was already in {@link Help}, and every fact they print was already
 * read. If a page here looks wrong, the reading is wrong — which is the property
 * worth having, because a renderer that also ranked would be a second opinion
 * about the same repository, silently disagreeing with the first.
 *
 * ## Why `llms.txt` and not just the JSON
 *
 * The JSON is the better answer for anything that can call a tool, and an agent
 * that can reach the MCP server should never read these pages. But a link in a
 * README is retrieved by things that cannot: a chat window with a URL box, a
 * crawler, a person. `llms.txt` is the convention those already look for — an
 * H1, a summary, and sections of links — so meeting it costs a formatting rule
 * and buys the case where nothing is installed.
 *
 * ## The one thing these do not do
 *
 * They do not truncate. A page over a thousand names is long, and a page that
 * quietly kept the top twenty would read exactly like a workspace that has
 * twenty names. Callers that need less should slice the {@link Help} they pass
 * in, where the cut is visible in their own code.
 */

/** What a page calls itself, and where its links point. */
export interface Page {
  readonly title: string;
  /** The blockquote under the title. One sentence, in the convention's shape. */
  readonly summary?: string;
  /** Put in front of every file path — a repository URL, if the page will be read away from the checkout. */
  readonly base?: string;
}

function place(page: Page, entry: Pick<Entry, 'at' | 'line'>): string {
  return `${page.base ?? ''}${entry.at}#L${entry.line}`;
}

/** The first paragraph of a doc block: what the name is, before the reasons. */
export function opening(doc: string): string {
  const [first = ''] = doc.split('\n\n');
  return first.replace(/\n/g, ' ').trim();
}

function head(page: Page): string {
  const lines = [`# ${page.title}`];
  if (page.summary !== undefined) lines.push('', `> ${page.summary}`);
  return lines.join('\n');
}

function counted(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The short page: every door this workspace opens, and how busy each one is.
 *
 * Deliberately one line per entrypoint rather than per name. The convention's
 * point is that a link list fits in a prompt alongside the question that made
 * somebody fetch it; a page that spent that budget on the first package would be
 * worse than no page, because the reader cannot tell it stopped early.
 */
export function writeLlms(help: Help, page: Page): string {
  const sections = help.packages.map((published) => {
    const links = published.openings.map((held) => {
      const used = held.entries.filter((entry) => entry.usedBy.length > 0).length;
      const written = held.entries.filter((entry) => entry.doc !== undefined).length;
      const notes = [
        counted(held.entries.length, 'name'),
        `${used} used across a package boundary`,
        `${written} documented`,
      ].join(', ');
      return `- [${published.name}${held.subpath === '.' ? '' : held.subpath.slice(1)}](${page.base ?? ''}${held.source}): ${notes}`;
    });
    return [`## ${published.name}`, '', ...links].join('\n');
  });

  return [head(page), '', ...join(sections), ''].join('\n');
}

function join(sections: readonly string[]): readonly string[] {
  return sections.flatMap((section, index) => (index === 0 ? [section] : ['', section]));
}

function entryLines(page: Page, entry: Entry): readonly string[] {
  const used =
    entry.usedBy.length === 0
      ? 'used nowhere else'
      : `used by ${entry.usedBy.join(', ')} (${counted(entry.uses, 'import')})`;

  const lines = [`#### \`${entry.name}\``, '', `\`${entry.kind}\` — [${entry.at}:${entry.line}](${place(page, entry)}) — ${used}`];

  if (entry.signature !== undefined) lines.push('', '```ts', entry.signature, '```');
  if (entry.doc !== undefined) lines.push('', entry.doc);
  else lines.push('', '_Nothing is written above this declaration._');

  return lines;
}

function openingLines(page: Page, published: Documented, held: Opening): readonly string[] {
  const title = `### \`${published.name}${held.subpath === '.' ? '' : held.subpath.slice(1)}\``;
  const opened = `Opened by [${held.source}](${page.base ?? ''}${held.source}).`;
  const entries = held.entries.flatMap((entry) => ['', ...entryLines(page, entry)]);
  return held.entries.length === 0
    ? [title, '', opened, '', '_This entrypoint reaches no names._']
    : [title, '', opened, ...entries];
}

/**
 * The long page: every name, what it says, and who reaches for it.
 *
 * Names come in the order {@link Help} put them in — most reached for first —
 * so a reader who stops halfway has read the half that gets used.
 */
export function writeIndex(help: Help, page: Page): string {
  const sections = help.packages.map((published) =>
    [`## ${published.name}`, ...published.openings.flatMap((held) => ['', ...openingLines(page, published, held)])].join('\n'),
  );

  return [head(page), '', ...join(sections), ''].join('\n');
}

/**
 * The page nobody wants and everybody needs: names other packages import that
 * say nothing about themselves.
 *
 * Ordered by how many packages import them, because that is the order in which
 * writing one paragraph pays for itself.
 */
export function writeGaps(help: Help, page: Page): string {
  const gaps = undocumented(help);
  if (gaps.length === 0) {
    return [head(page), '', 'Every name imported across a package boundary carries a doc block.', ''].join('\n');
  }

  const lines = gaps.map(
    (entry) =>
      `- \`${entry.name}\` (\`${entry.kind}\`) — [${entry.at}:${entry.line}](${place(page, entry)}) — used by ${entry.usedBy.join(', ')}`,
  );

  return [
    head(page),
    '',
    `${counted(gaps.length, 'name')} ${gaps.length === 1 ? 'crosses' : 'cross'} a package boundary with ` +
      'nothing written above the declaration.',
    '',
    ...lines,
    '',
  ].join('\n');
}
