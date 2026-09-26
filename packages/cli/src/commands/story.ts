/**
 * The route one case took through the code.
 *
 * `covering` answers *which tests went here*; this answers the question from
 * the other end, for one test: *where does this case go, and in what order*.
 * It reads a story, which a run writes under `VARIANCE_AUTHORITY_STORY=1`, and
 * prints it as a route through declarations — the functions, handlers and top
 * levels the case passed through, a loop drawn once, modules loaded along the
 * way named as one stop. It is a map to read before opening files, not a
 * trace to step through: which arm of an `if` ran, and how many times a loop
 * went round, stay on the tape.
 *
 * Who runs the case is not this command's business. Any runner with the seam
 * installed writes a story for every case it runs under the variable, and
 * narrowing the run is the runner's own flag.
 */

import {
  listStories,
  readRoute,
  STORY_VARIABLE,
  type Place,
  type Route,
  type Step,
  type Stop,
  type StoryEntry,
} from '@variance-authority/sense/story';
import { OperatorError } from '../exit.js';
import type { ParsedStory } from '../story-args.js';

/** One route, or the stories to choose from when the flags name more than one. */
export type StoryAnswer = { readonly route: Route } | { readonly stories: readonly StoryEntry[] };

/** The story the flags name, read as a route; every candidate when they name several. */
export function story(parsed: ParsedStory): StoryAnswer {
  const all = listStories(parsed.root);
  if (all.length === 0) {
    throw new OperatorError(
      `no story in this checkout: run the case with ${STORY_VARIABLE}=1, and the runner writes one for every case it runs`,
    );
  }
  const matching = all.filter(
    (entry) =>
      (parsed.file === undefined || entry.file.includes(parsed.file))
      && (parsed.name === undefined || entry.name.includes(parsed.name)),
  );
  if (matching.length === 0) {
    const asked = [parsed.file && `--file ${parsed.file}`, parsed.name && `--name ${parsed.name}`].filter(Boolean);
    throw new OperatorError(`no story matches ${asked.join(' and ')}; ${all.length} ${all.length === 1 ? 'is' : 'are'} written here`);
  }
  if (matching.length > 1) return { stories: matching };
  return { route: readRoute(parsed.root, matching[0]!.path) };
}

export function formatStory(answer: StoryAnswer, format: 'text' | 'json'): string {
  if (format === 'json') {
    const json = 'route' in answer
      ? answer.route
      : { stories: answer.stories.map(({ file, name, visits }) => ({ file, name, visits })) };
    return `${JSON.stringify(json, null, 2)}\n`;
  }
  if ('stories' in answer) {
    const lines = [`${answer.stories.length} stories; name one with --file and --name`, ''];
    for (const entry of answer.stories) lines.push(`  ${entry.file} > ${entry.name}  (${entry.visits} visits)`);
    return `${lines.join('\n')}\n`;
  }
  return routeText(answer.route);
}

function routeText(route: Route): string {
  const lines = [`story  ${route.file} > ${route.name}`];
  const files = route.files.length;
  lines.push(`  goes through ${files} ${files === 1 ? 'file' : 'files'}`);
  if (route.stopped === true) lines.push('  the case threw or rejected, so the route ends where it stopped');
  if (route.untaped > 0) lines.push(`  the tape filled, and ${route.untaped} later visits are not on this route`);
  if (route.interleaved > 0) {
    lines.push(`  another case's work ran in the middle of this one ${times(route.interleaved)}, and is left out`);
  }
  if (route.unresolved.length > 0) {
    lines.push(
      `  ${route.unresolved.length} ${route.unresolved.length === 1 ? 'file is' : 'files are'} drawn as the file alone:`
        + ' the recording holds no regions for them at this text, and `yarn test` records them',
    );
  }
  if (route.route.length === 0) {
    lines.push('', '  the case reached no instrumented code');
    return `${lines.join('\n')}\n`;
  }
  if (route.before.length > 0) {
    lines.push('', '  before the case');
    steps(route.before, 2, lines);
    lines.push('  the case');
  } else lines.push('');
  steps(route.route, 2, lines);
  return `${lines.join('\n')}\n`;
}

function steps(route: readonly Step<Stop>[], depth: number, lines: string[]): void {
  const indent = '  '.repeat(depth);
  for (const step of route) {
    if ('repeat' in step) {
      lines.push(`${indent}repeats`);
      steps(step.repeat, depth + 1, lines);
      continue;
    }
    const stop = step.token;
    lines.push(`${indent}${'loaded' in stop ? loaded(stop.loaded) : place(stop.place)}`);
  }
}

function place(place: Place): string {
  const lines = place.startLine === undefined
    ? ''
    : place.startLine === place.endLine ? `:${place.startLine}` : `:${place.startLine}-${place.endLine}`;
  const name = place.name === '' ? '(top level)' : place.name;
  const kind = place.kind === 'function' || place.kind === 'module' ? '' : `  ${place.kind}`;
  return `${place.file}${lines}  ${name}${kind}`;
}

const SHOWN = 3;

function loaded(files: readonly string[]): string {
  const named = files.slice(0, SHOWN).join(', ');
  const more = files.length > SHOWN ? `, and ${files.length - SHOWN} more` : '';
  return `loaded ${files.length} ${files.length === 1 ? 'file' : 'files'}: ${named}${more}`;
}

function times(count: number): string {
  return count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`;
}
