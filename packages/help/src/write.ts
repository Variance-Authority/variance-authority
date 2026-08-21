import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Help, type Page, readHelp, writeGaps, writeIndex, writeLlms } from '@variance-authority/package/help';

/**
 * The same answers, as files, for the readers that cannot call a tool.
 *
 * An agent with this server connected should never read these. A chat window
 * with a URL box, a crawler, and a person are the audience, and `llms.txt` is
 * the convention all three already look for — so meeting it costs a naming rule
 * and buys the case where nothing is installed.
 *
 * The title and the summary come from the workspace's own root manifest. Asking
 * for them as arguments would mean a repository could publish an index that
 * calls itself something other than what it is, and there is no version of that
 * which is anybody's intent.
 */

export interface Written {
  readonly at: string;
  readonly bytes: number;
}

/** What the root `package.json` calls this workspace. */
function titled(root: string): Page {
  const manifest = join(root, 'package.json');
  if (!existsSync(manifest)) return { title: 'API index' };

  const { name, description } = JSON.parse(readFileSync(manifest, 'utf8')) as {
    name?: unknown;
    description?: unknown;
  };

  return {
    title: typeof name === 'string' ? name : 'API index',
    ...(typeof description === 'string' ? { summary: description } : {}),
  };
}

function put(dir: string, name: string, text: string): Written {
  const at = join(dir, name);
  writeFileSync(at, text, 'utf8');
  return { at, bytes: Buffer.byteLength(text) };
}

export interface PagesOptions {
  /** Put in front of every path, for a page that will be read away from the checkout. */
  readonly base?: string;
  /** Overrides what the root manifest says this workspace is called. */
  readonly page?: Page;
}

/**
 * Write the four files, and say what was written.
 *
 * `help.json` is the reading itself. It is here because everything above it is a
 * rendering decision somebody will eventually disagree with, and disagreeing
 * should cost a `JSON.parse` rather than a fork.
 */
export function writePages(root: string, out: string, options: PagesOptions = {}): readonly Written[] {
  const where = resolve(root);
  const help: Help = readHelp(where);
  const dir = resolve(out);
  mkdirSync(dir, { recursive: true });

  const named = options.page ?? titled(where);
  const page: Page = { ...named, ...(options.base === undefined ? {} : { base: options.base }) };

  return [
    put(dir, 'llms.txt', writeLlms(help, page)),
    put(dir, 'help-index.md', writeIndex(help, page)),
    put(dir, 'help-gaps.md', writeGaps(help, { ...page, title: `${page.title} — undocumented` })),
    put(dir, 'help.json', `${JSON.stringify(help, null, 2)}\n`),
  ];
}
