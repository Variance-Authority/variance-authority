import type { HeadRan, VantageState, WatchedExecution } from '@variance-authority/vantage';
import { limitOf } from './limit.js';
import { fileArg } from './run-signals.js';
import { spellingOf } from './spelling.js';
import type { CutModules, Tool } from './tool.js';
import { VARIABLE } from './vantage-lines.js';

// compass: variance-authority.runtime.watched-run

/**
 * What an application used by hand ran, one execution per request.
 *
 * A request no test drove has no test to be listed under, so it is listed as
 * itself: in the order it arrived, with the regions each of its heads entered.
 * Oldest first, as the suite's listing is, because a reader who just clicked
 * something is looking for the last one. What a process entered outside any
 * request, or while a module evaluated, is every request's and so is listed
 * once, apart, and never under whichever request arrived first.
 *
 * A region arrives as an ordinal. Its name and line are read from the file its
 * build was made from, by the host, and where that file is no longer that text
 * the region is counted and the reason said: a name read off the new text would
 * be a name for some other region.
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
      file: {
        type: 'string',
        description: 'Show only executions that ran code in this file: its path from the repository root.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        description: 'How many of the most recent to list. Defaults to 20.',
      },
    },
    additionalProperties: false,
  },
  cuts(state) {
    const asked = new Map<string, Set<string>>();
    for (const head of headsOf(state)) {
      let ids = asked.get(head.instrumentation);
      if (ids === undefined) asked.set(head.instrumentation, (ids = new Set()));
      for (const module of head.modules) ids.add(module.id);
    }
    return new Map([...asked].map(([instrumentation, ids]) => [instrumentation, [...ids]]));
  },
  run(state, input, invocation) {
    const { executions, common, forgotten, lost } = state.ran;
    if (executions.length === 0 && common.length === 0) return unreported(state);

    const cut = invocation?.modules;
    const name = nameArg(input);
    const file = fileArg(input, invocation?.root);
    const matching = executions.filter(
      (execution) =>
        (name === undefined || execution.heads.some((head) => regionsOf(head, cut).some((region) => named(region, name)))) &&
        (file === undefined || execution.heads.some((head) => head.modules.some((module) => fileOf(module.id) === file))),
    );
    if (matching.length === 0 && (name !== undefined || file !== undefined)) {
      const asked = [
        ...(name === undefined ? [] : [`a region named ${name}`]),
        ...(file === undefined ? [] : [`code in the file ${file}`]),
      ].join(' and ');
      return `No execution here ran ${asked}. ${executions.length} execution(s) have reported.`;
    }

    const spell = spellingOf(invocation);
    const limit = limitOf(input, 20, spell);
    const shown = matching.slice(Math.max(0, matching.length - limit));
    const elided = matching.length - shown.length;
    const where = state.address === undefined ? '' : ` at ${state.address}`;
    const count = matching.length === executions.length ? `${executions.length}` : `${matching.length} of ${executions.length}`;

    return [
      `${count} execution(s)${where}.`,
      ...shown.flatMap((execution) => ['', ...listed(execution, cut)]),
      ...(elided === 0 ? [] : ['', `… ${elided} earlier execution(s) not listed; a higher \`${spell.input('limit')}\` lists them.`]),
      ...(forgotten === 0 ? [] : ['', `${forgotten} earlier execution(s) were dropped to keep this watcher bounded.`]),
      ...(lost === 0
        ? []
        : ['', `${lost} report(s) never arrived at this watcher, so an execution above may list less than it ran.`]),
      ...(common.length === 0
        ? []
        : [
            '',
            'Ran outside any request, or while a module loaded, and so listed under none of them:',
            ...common.flatMap((head) => [`  head ${head.head}`, ...entered(head, cut)]),
          ]),
    ].join('\n');
  },
};

/** One region an execution entered, or a module whose regions could not be named and why. */
type Entered =
  | { readonly file: string; readonly name: string; readonly path: string; readonly line?: number }
  | { readonly file: string; readonly count: number; readonly unnamed: string };

function headsOf(state: VantageState): readonly HeadRan[] {
  return [...state.ran.executions.flatMap((execution) => execution.heads), ...state.ran.common];
}

/** The file an id names: `path@digest`, and a digest has no `@` in it. */
function fileOf(id: string): string {
  const at = id.lastIndexOf('@');
  return at < 0 ? id : id.slice(0, at);
}

function regionsOf(head: HeadRan, cut: CutModules | undefined): readonly Entered[] {
  return head.modules.flatMap((module): readonly Entered[] => {
    const file = fileOf(module.id);
    const unnamed = (why: string): readonly Entered[] => [{ file, count: module.entered.length, unnamed: why }];
    // A module its build marked as loaded and placed no probe in: `path@~digest`.
    if (module.id.startsWith('~', file.length + 1)) return unnamed('its build placed no probe in it, so it is known only to have loaded');
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

function entered(head: HeadRan, cut: CutModules | undefined): string[] {
  return regionsOf(head, cut).map((region) => {
    if ('unnamed' in region) return `      ${region.file} — ${region.count} region(s), not named: ${region.unnamed}`;
    const at = region.line === undefined ? region.file : `${region.file}:${region.line}`;
    const called = [region.name, region.path].filter((part) => part !== '').join(' ');
    return `      ${at} ${called === '' ? '(module)' : called}`;
  });
}

function listed(execution: WatchedExecution, cut: CutModules | undefined): string[] {
  const mark = execution.open ? '▸' : ' ';
  return [
    `${mark} ${execution.id}`,
    ...execution.heads.flatMap((head) => [`  head ${head.head}`, ...entered(head, cut)]),
  ];
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
    'An application reports here when it is built with the probes on, calls ' +
      '`collectJourneys()` from `@variance-authority/sense/journey` where it starts, ' +
      'and is started with this in its environment:',
    '',
    `  ${VARIABLE}=${address}`,
    '',
    'Each request no test drove is then one execution here. A request a test drove ' +
      'answers that test, and an application started without the variable reports nothing.',
  ].join('\n');
}
