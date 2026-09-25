import { isAbsolute, relative } from 'node:path';

/**
 * A path said the way the reader would type it from where they are standing.
 *
 * Every path this tool holds is absolute, and for good reason: a path resolved
 * once at the edge cannot mean two different files later, and nothing downstream
 * has to know which directory the process happened to start in. What is right
 * for holding a path is wrong for saying one. `/Users/someone/dev/app/…` names
 * the machine it was typed on as much as the file, and the reader — usually an
 * agent, working in the directory it ran the command from — has to strip the
 * part about somebody's home directory to get back the path it already knew.
 *
 * So a path leaves as it arrived: `variance.config.json`, or
 * `node_modules/@variance-authority/cli/skills/variance-authority/SKILL.md`. That spelling opens
 * from where the command ran, survives being copied into a note or a log, and
 * says nothing about whose checkout it was.
 *
 * Absolute is kept for anything not under the working directory — a cache in a
 * home directory, a report in a temporary directory, a globally installed
 * package. A climb through `..` is not something a reader can act on, and a path
 * that leaves the working directory is genuinely elsewhere: saying so is the
 * information.
 */
export function said(path: string): string {
  const near = relative(process.cwd(), path);
  return near === '' || near.startsWith('..') || isAbsolute(near) ? path : near;
}
