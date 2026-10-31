import { afterAll } from 'vitest';

/**
 * A test file ends with the process as it found it: the working directory and
 * every environment variable.
 *
 * With a process per file, a file that left either changed went unseen. A
 * worker that keeps its modules across files (`yarn test:shared`) runs the next
 * file in the same process, and that file starts in a directory the last one
 * removed, reading a cache nobody meant it to. So a file that leaves either
 * changed fails here, naming what it left, and the fix is in that file.
 *
 * This is the first setup file, so its `afterAll` runs after every other one,
 * once the file's own hooks have put back what they will.
 */

/**
 * What a library sets for itself as it loads, once a process, and needs kept:
 * sharp's libvips its home, Playwright its browserslist warning switched off.
 */
const LOADED = new Set(['BROWSERSLIST_IGNORE_OLD_DATA', 'VIPSHOME']);

const cwd = process.cwd();
const env = { ...process.env };

afterAll(() => {
  const left: string[] = [];
  if (process.cwd() !== cwd) left.push(`the working directory ${process.cwd()}`);
  for (const name of new Set([...Object.keys(env), ...Object.keys(process.env)])) {
    if (!LOADED.has(name) && process.env[name] !== env[name]) left.push(`\`${name}\` ${process.env[name] === undefined ? 'deleted' : 'changed'}`);
  }
  if (left.length > 0) throw new Error(`This file left ${left.join(', ')}. Put it back in the hook that changed it.`);
});
