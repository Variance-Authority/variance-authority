import { loadedUnprobed, modulePath } from '@variance-authority/sense';
import type { HeadRan, VantageState, WatchedExecution } from '@variance-authority/vantage';
import { STORY_VARIABLE } from '@variance-authority/sense/story';
import { cappedRows } from './capped.js';
import { toldIds, toldRows } from './ran-story.js';
import { limitOf } from './limit.js';
import { spellingOf } from './spelling.js';
import type { CutModules, Tool } from './tool.js';
import { VARIABLE } from './vantage-lines.js';

// compass: variance-authority.report.agent-surface

/**
 * What an application used by hand ran, one execution per request.
 *
 * A request no test drove has no test to be listed under, so it is listed as
 * itself: in the order it arrived, with the regions each of its heads entered.
 * Oldest first, as the suite's listing is, because a reader who just clicked
 * something is looking for the last one. What a process entered outside any
 * request, or while a module evaluated, is every request's and so is listed
 * once, apart, and never under whichever request arrived first.
 */
export const ran: Tool<VantageState> = {
  name: 'variance_ran',
  description:
    'What an application built with the probes on ran while somebody used it by hand: one execution per request no test drove, each with the regions it ran as `file:line name`.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          'Show only executions that ran a region of this name: a declaration, such as `toggle`, or one segment of `Cart/render`.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        description: 'How many of the most recent to list. Defaults to 20.',
      },
      story: {
        type: 'boolean',
        description: `Show each execution's story in place of its regions: the steps it took in order, with what each function was handed. Told by a head started with \`${STORY_VARIABLE}=1\`.`,
      },
    },
    additionalProperties: false,
  },
  cuts(state, input) {
    const asked = new Map<string, Set<string>>();
    for (const head of headsOf(state, input)) {
      let ids = asked.get(head.instrumentation);
      if (ids === undefined) asked.set(head.instrumentation, (ids = new Set()));
      for (const module of head.modules) ids.add(module.id);
      if (storyArg(input)) for (const id of toldIds(head)) ids.add(id);
    }
    return new Map([...asked].map(([instrumentation, ids]) => [instrumentation, [...ids]]));
  },
  run(state, input, invocation) {
    const { executions, common, forgotten, lost } = state.ran;
    if (executions.length === 0 && common.length === 0) return unreported(state);

    const cut = invocation?.modules;
    const name = nameArg(input);
    const matching = executions.filter(
      (execution) => name === undefined || execution.heads.some((head) => regionsOf(head, cut).some((region) => named(region, name))),
    );
    // What the process ran is narrowed as the executions are: asked about one name, a reader wants that name.
    const outside = common
      .map((head) => ({ head, regions: regionsOf(head, cut).filter((region) => name === undefined || named(region, name)) }))
      .filter((one) => one.regions.length > 0);
    if (matching.length === 0 && outside.length === 0 && name !== undefined) {
      // A name is matched against named regions only, so a miss is not proof where some were not.
      const unnamed = executions.filter((execution) =>
        execution.heads.some((head) => regionsOf(head, cut).some((region) => 'unnamed' in region))).length;
      return (
        `No execution here ran a region named ${name}. ${executions.length} execution(s) have reported.` +
        (unnamed === 0 ? '' : ` ${unnamed} of them ran regions that could not be named, so one of those may have.`)
      );
    }

    const spell = spellingOf(invocation);
    const shown = newest(matching, limitOf(input, SHOWN, spell));
    const story = storyArg(input);
    const untold = story && !shown.some((execution) => execution.heads.some((head) => head.stories !== undefined));
    const elided = matching.length - shown.length;
    const where = state.address === undefined ? '' : ` at ${state.address}`;
    const count = matching.length === executions.length ? `${executions.length}` : `${matching.length} of ${executions.length}`;

    return [
      `${count} execution(s)${where}.`,
      ...(untold
        ? ['', `No head here was started with ${STORY_VARIABLE}=1, so no execution has a story; what each ran is listed instead.`]
        : []),
      ...shown.flatMap((execution) => ['', ...listed(execution, cut, story)]),
      ...(elided === 0 ? [] : ['', `… ${elided} earlier execution(s) not listed; a higher \`${spell.input('limit')}\` lists them.`]),
      ...(forgotten === 0 ? [] : ['', `${forgotten} earlier execution(s) were dropped to keep this watcher bounded.`]),
      ...(lost === 0
        ? []
        : ['', `${lost} report(s) never arrived at this watcher, so an execution above may list less than it ran.`]),
      ...(outside.length === 0
        ? []
        : [
            '',
            'Ran outside any request, or while a module loaded, and so listed under none of them:',
            ...outside.flatMap((one) => [`  head ${one.head.head}`, ...cappedRows(one.regions, line, COMMON).map(indented)]),
          ]),
    ].join('\n');
  },
};

/** One region an execution entered, or a module whose regions could not be named and why. */
type Entered =
  | { readonly file: string; readonly name: string; readonly path: string; readonly line?: number }
  | { readonly file: string; readonly count: number; readonly unnamed: string };

/** How many regions of what one process ran outside every request are listed before the rest are counted. */
const COMMON = 40;

/** `cappedRows` writes its count two spaces in; a region sits under its head. */
const indented = (row: string): string => (row.startsWith('      ') ? row : `    ${row}`);

/** How many executions are listed when no `limit` is said. */
const SHOWN = 20;

/** The newest `limit` of what matched: the ones a call lists. */
const newest = (matching: readonly WatchedExecution[], limit: number): readonly WatchedExecution[] =>
  matching.slice(Math.max(0, matching.length - limit));

/**
 * The heads a call will name regions of. Asked for no name it lists the newest
 * `limit` executions, and only those are cut; a name is matched against every
 * execution, so every one is, as it is for a `limit` that `run` will refuse.
 */
function headsOf(state: VantageState, input: Readonly<Record<string, unknown>>): readonly HeadRan[] {
  const { executions, common } = state.ran;
  const limit = input['limit'] === undefined ? SHOWN : Number(input['limit']);
  const narrowed = input['name'] === undefined && Number.isInteger(limit) && limit >= 1;
  return [...(narrowed ? newest(executions, limit) : executions).flatMap((execution) => execution.heads), ...common];
}

/**
 * A region arrives as an ordinal. Its name and line are read from the file its
 * build was made from, by the host, and where that file is no longer that text
 * the region is counted and the reason said: a name read off the new text would
 * be a name for some other region.
 */
function regionsOf(head: HeadRan, cut: CutModules | undefined): readonly Entered[] {
  return head.modules.flatMap((module): readonly Entered[] => {
    const file = modulePath(module.id);
    const unnamed = (why: string): readonly Entered[] => [{ file, count: module.entered.length, unnamed: why }];
    if (loadedUnprobed(module.id)) return unnamed('its build placed no probe in it, so it is known only to have loaded');
    if (cut === undefined) return unnamed('no checkout was read');
    const modules = cut.get(head.instrumentation);
    if (modules === undefined) return unnamed(`numbered by \`${head.instrumentation}\`, which this build does not read`);
    const read = modules.get(module.id);
    if (read === undefined) return unnamed('the file is not in this checkout');
    if (!read.instrumented) return unnamed('the file has changed since the application was built');
    const blocks = new Map(read.blocks.map((block) => [block.ordinal, block]));
    return module.entered.map((ordinal) => {
      const block = blocks.get(ordinal);
      return block === undefined
        ? { file, name: `#${ordinal}`, path: '' }
        : { file, name: block.name, path: block.path, ...(block.startLine === undefined ? {} : { line: block.startLine }) };
    });
  });
}

/** Whether a region is called `name`: its whole name path, or one declaration along it. */
function named(region: Entered, name: string): boolean {
  return !('unnamed' in region) && (region.name === name || region.name.split('/').includes(name));
}

function line(region: Entered): string {
  if ('unnamed' in region) return `      ${region.file} — ${region.count} region(s), not named: ${region.unnamed}`;
  const at = region.line === undefined ? region.file : `${region.file}:${region.line}`;
  return `      ${[at, region.name, region.path].filter((part) => part !== '').join(' ')}`;
}

function listed(execution: WatchedExecution, cut: CutModules | undefined, story: boolean): string[] {
  const mark = execution.open ? '▸' : ' ';
  return [
    `${mark} ${execution.id}`,
    ...execution.heads.flatMap((head) => [
      `  head ${head.head}`,
      ...(story && head.stories !== undefined ? toldRows(head, cut) : regionsOf(head, cut).map(line)),
    ]),
    // A request that reached a head and none of its probed code: a route the build left out.
    ...(execution.heads.some((head) => head.modules.length > 0) ? [] : [execution.open ? '  still open: what it ran is listed when it settles' : '  ran no code the build placed a probe in']),
  ];
}

/** The variable that turns a head on, as `@variance-authority/sense/journey` reads it; a test holds the two together. */
export const JOURNEYS = 'VARIANCE_AUTHORITY_JOURNEYS';

function storyArg(input: Readonly<Record<string, unknown>>): boolean {
  const value = input['story'];
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new Error('`story` must be true or false');
  return value;
}

function nameArg(input: Readonly<Record<string, unknown>>): string | undefined {
  const value = input['name'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') throw new Error('`name` must be a non-empty string');
  return value;
}

/**
 * What to do when no application has reported.
 *
 * Its own sentence, apart from the one a suite gets: an application is started
 * by hand and takes one call, and the fixtures a suite needs are nothing to it.
 */
function unreported(state: VantageState): string {
  const address = state.address ?? 'http://127.0.0.1:<port>';
  return [
    'No request has reported to this watcher yet.',
    '',
    'An application reports here when it is built with the probes on, runs its request ' +
      'handler inside `collectJourneys().enter` from `@variance-authority/sense/journey`, ' +
      'and is started with both of these in its environment:',
    '',
    `  ${JOURNEYS}=1 ${VARIABLE}=${address}`,
    '',
    'The first turns the reporting on and the second says where to. Each request no test ' +
      'drove is then one execution here. A request a test drove answers that test, and an ' +
      'application started without either reports nothing here.',
  ].join('\n');
}
