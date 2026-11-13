import { drawToldRoute, routeText, toldModules, unnotedText, untapedText, type Region, type Route } from '@variance-authority/sense/story';
import type { HeadRan } from '@variance-authority/vantage';
import { cappedRows } from './capped.js';
import type { CutModules } from './tool.js';

// compass: variance-authority.report.agent-surface

/**
 * What an execution's functions were handed, read from the stories its head
 * told: a head started with `VARIANCE_AUTHORITY_STORY=1` tapes each execution
 * the way a test story tapes a case, and says what each function was handed.
 *
 * The route is read and drawn by the same code a test story is, with the
 * regions the host cut from the checkout, so a step, its arms and what was
 * handed there, `» handed name=value`, read as they do under `variance story`.
 */

/** Every module the stories a head told went through. */
export function toldIds(head: HeadRan): readonly string[] {
  return (head.stories ?? []).flatMap((story) => toldModules(Buffer.from(story, 'base64')));
}

/** How many lines of one head's stories are printed before the rest are counted. */
const TOLD = 80;

/** The stories a head told of one execution, a step a line, each with what was handed under it. */
export function toldRows(head: HeadRan, cut: CutModules | undefined): string[] {
  const modules = cut?.get(head.instrumentation);
  const regionsOf = (id: string, count: number): readonly Region[] | undefined => {
    const read = modules?.get(id);
    if (read === undefined || !read.instrumented) return undefined;
    const regions: Region[] = [];
    for (const block of read.blocks) {
      // A region whose kind the host did not say is not one this reading can place.
      if (block.kind === undefined) return undefined;
      regions[block.ordinal] = {
        kind: block.kind, name: block.name, path: block.path,
        ...(block.startLine === undefined ? {} : { startLine: block.startLine, endLine: block.endLine ?? block.startLine }),
      };
    }
    return regions.length === count && regions.every((region) => region !== undefined) ? regions : undefined;
  };
  const rows = (head.stories ?? []).flatMap((story, told) => [
    ...(told === 0 ? [] : ['told again, once more of it had run:']),
    ...routeRows(drawToldRoute(Buffer.from(story, 'base64'), regionsOf)),
  ]);
  const more = head.stories === undefined ? '' : ' more';
  const untold = head.untold === undefined ? [] : [`    told ${head.untold}${more} ${head.untold === 1 ? 'time' : 'times'}, which the watcher did not keep`];
  return [...cappedRows(rows, (row) => `    ${row}`, TOLD), ...untold];
}

/** A told route as `variance story` draws every step of one, after what the tape lost of it. */
function routeRows(route: Route): string[] {
  return [...untapedText(route), ...unnotedText(route), ...routeText(route).filter((row) => row !== '')];
}
