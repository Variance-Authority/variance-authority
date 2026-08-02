import { readFile } from 'node:fs/promises';
import { parseStoryIndex, type StoryIndex } from './index-file.js';

/**
 * Reading the index off a disk — the one thing in this package that touches a host.
 *
 * Its own module and its own entrypoint, because everything else here is a pure
 * function over a value somebody already has: a project that fetches `index.json`
 * from a running dev server, or holds it in memory, or reads it out of a build
 * artifact store, wants {@link parseStoryIndex} and no filesystem at all.
 */

/**
 * Read and parse a story index from disk.
 *
 * Every failure names the path and says where the file is supposed to come
 * from. `ENOENT` on `index.json` is the single most likely first encounter with
 * this adapter, and "no such file or directory" alone does not tell anybody that
 * a Storybook has to be *built* before it has an index.
 */
export async function readStoryIndex(path: string): Promise<StoryIndex> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(
      `cannot read a Storybook story index at ${path}: ${messageOf(error)}. ` +
        `A built Storybook writes \`index.json\` next to \`iframe.html\` in its output directory ` +
        `(\`storybook build\`); a running dev server serves the same file at \`/index.json\`.`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${path} is not JSON: ${messageOf(error)}. ` +
        `Pointing this at \`iframe.html\` or at a dev server's HTML shell fails exactly here.`,
    );
  }

  return parseStoryIndex(value, path);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
