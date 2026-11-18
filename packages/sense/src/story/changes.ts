// compass: variance-authority.reach.story
import type { Route } from './read.js';
import { numbered } from './view.js';

/** One change to the page a story wrote, as a search finds it. */
export interface PageChange {
  /** `appeared` for a node added, `disappeared` for one taken off, `changed` for an attribute or a text. */
  readonly kind: 'appeared' | 'disappeared' | 'changed';
  /** The step the case was at; absent for what changed before its first step. */
  readonly step?: number;
  /** The test line that made it, or the hook line when `hook` is set; absent before any line was cut. */
  readonly line?: number;
  readonly hook?: true;
  /** The React commit that wrote it, counted from the case's first; absent for a write outside React. */
  readonly commit?: number;
  /** The change line as the story wrote it, without its `dom` and its commit. */
  readonly change: string;
}

/** What a search of a story's page changes found, and how many changes it looked through. */
export interface PageSearch {
  readonly searched: number;
  readonly found: readonly PageChange[];
}

const COMMIT = / at commit (\d+)$/;
const CUT = /^(test|hook) line (\d+)$/;

/**
 * The changes to the page a route says, each whose line holds `pattern` as
 * written, in the order the case made them. A story writes each change once,
 * as one line, so this finds what `rg` over the story file finds, and places it.
 */
export function pageChanges(route: Route, pattern: string): PageSearch {
  const found: PageChange[] = [];
  let searched = 0;
  let line: number | undefined;
  let hook = false;
  const read = (said: readonly string[] | undefined, step: number | undefined) => {
    for (const text of said ?? []) {
      const cut = CUT.exec(text);
      if (cut !== null) {
        line = Number(cut[2]);
        hook = cut[1] === 'hook';
        continue;
      }
      if (!text.startsWith('dom ')) continue;
      searched += 1;
      const written = text.slice('dom '.length);
      if (!written.includes(pattern)) continue;
      const commit = COMMIT.exec(written);
      const change = commit === null ? written : written.slice(0, commit.index);
      found.push({
        kind: change.startsWith('+ ') ? 'appeared' : change.startsWith('− ') ? 'disappeared' : 'changed',
        ...(step === undefined ? {} : { step }),
        ...(line === undefined ? {} : { line }),
        ...(hook ? { hook: true as const } : {}),
        ...(commit === null ? {} : { commit: Number(commit[1]) }),
        change,
      });
    }
  };
  read(route.opening?.before, undefined);
  let opened = false;
  for (const each of numbered(route)) {
    if (!each.before && !opened) {
      opened = true;
      read(route.opening?.route, undefined);
    }
    if (each.stop !== undefined) read(each.stop.said, each.step);
  }
  if (!opened) read(route.opening?.route, undefined);
  return { searched, found };
}
