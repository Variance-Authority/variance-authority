import { drawToldRoute, toldModules, type Region, type Route, type Step, type Stop } from '@variance-authority/sense/story';
import type { HeadRan } from '@variance-authority/vantage';
import { cappedRows } from './capped.js';
import type { CutModules } from './tool.js';

// compass: variance-authority.report.agent-surface

/**
 * What an execution's functions were handed, read from the stories its head
 * told: a head started with `VARIANCE_AUTHORITY_STORY=1` tapes each execution
 * the way a test story tapes a case, and says what each function was handed.
 *
 * The route is drawn by the same reading a test story is, with the regions the
 * host cut from the checkout, so a step reads as the listing's regions do and
 * what was handed reads as it does in a test story, `» handed name=value`.
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
  return cappedRows(rows, (row) => `    ${row}`, TOLD);
}

function routeRows(route: Route): string[] {
  const said = (lines: readonly string[] | undefined, indent: string): string[] => (lines ?? []).map((line) => `${indent}  » ${line}`);
  const walk = (steps: readonly Step<Stop>[], indent: string): string[] =>
    steps.flatMap((step) => {
      if ('repeat' in step) return [`${indent}${step.times} times:`, ...walk(step.repeat, `${indent}  `)];
      const stop = step.token;
      if ('loaded' in stop) return [`${indent}loaded ${stop.loaded.join(', ')}`, ...said(stop.said, indent)];
      const { file, name, startLine } = stop.place;
      const at = startLine === undefined ? file : `${file}:${startLine}`;
      return [
        `${indent}${at} ${name === '' ? '(top level)' : name}`,
        ...stop.arms.map((arm) => `${indent}  ${arm.path}${arm.times === 1 ? '' : ` ${arm.times} times`}`),
        ...said(stop.said, indent),
      ];
    });
  return [
    ...said(route.opening?.route, ''),
    ...walk(route.route, ''),
    ...(route.untaped === 0 ? [] : [`${route.untaped} step(s) past the tape's end were not kept`]),
  ];
}
