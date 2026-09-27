import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';

export interface ParsedStory {
  readonly command: 'story';
  /** Text the story's test file contains. */
  readonly file?: string;
  /** Text the story's case name contains. */
  readonly name?: string;
  /** The checkout the stories were written in; defaults to the working directory. */
  readonly root: string;
  readonly format: 'text' | 'json';
  /** How much of the route to read; absent, the overview of files and declarations. */
  readonly zoom?: StoryZoom;
  /** Read the newest reading with this label rather than the newest of all. */
  readonly label?: string;
  /** Which readings of the case to compare, instead of reading one route. */
  readonly compare?: StoryCompare;
}

/**
 * The two sides of a comparison: the two newest readings, the readings that
 * passed against the ones that threw, or the readings under one label against
 * another's. `1` names the readings a run wrote with the variable set to `1`.
 */
export type StoryCompare = 'last' | 'outcome' | { readonly labels: readonly [string, string] };

/** One file's part of the route, the steps near one step, or all of it. */
export type StoryZoom = { readonly in: string } | { readonly around: number } | { readonly whole: true };

const ZOOMS = ['--in', '--around', '--whole'] as const;

/** Parse the story reader outside the config-shaped command parser. */
export function parseStory(flags: Flags): ParsedStory {
  noPositionals(flags.positionals, 'story');
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new OperatorError(`--format must be text or json, not \`${format}\``);
  }
  const zooms = ZOOMS.filter((flag) => flags.present.has(flag));
  if (zooms.length > 1) throw new OperatorError(`${zooms.join(' and ')} each choose how much of the route to read; name one`);
  const zoom = zoomOf(flags);
  const file = flags.values.get('--file');
  const name = flags.values.get('--name');
  const label = flags.values.get('--label');
  const compare = compareOf(flags.values.get('--compare'));
  if (compare !== undefined && zooms.length > 0) {
    throw new OperatorError(`--compare reads no route, so ${zooms.join(' and ')} has nothing to narrow; name one or the other`);
  }
  if (compare !== undefined && label !== undefined) {
    throw new OperatorError('--label picks the reading to read; with --compare, name both labels there: --compare <a>,<b>');
  }
  return {
    command: 'story',
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    ...(file === undefined ? {} : { file }),
    ...(name === undefined ? {} : { name }),
    format,
    ...(zoom === undefined ? {} : { zoom }),
    ...(label === undefined ? {} : { label }),
    ...(compare === undefined ? {} : { compare }),
  };
}

function compareOf(value: string | undefined): StoryCompare | undefined {
  if (value === undefined) return undefined;
  if (value === 'last' || value === 'outcome') return value;
  const labels = value.split(',');
  if (labels.length !== 2 || labels.some((label) => label === '') || labels[0] === labels[1]) {
    throw new OperatorError(`--compare takes last, outcome, or two labels as <a>,<b>, not \`${value}\``);
  }
  return { labels: [labels[0]!, labels[1]!] };
}

function zoomOf(flags: Flags): StoryZoom | undefined {
  if (flags.present.has('--whole')) return { whole: true };
  const within = flags.values.get('--in');
  if (within !== undefined) return { in: within };
  const around = flags.values.get('--around');
  if (around === undefined) return undefined;
  const step = Number(around);
  if (!Number.isInteger(step) || step < 1) throw new OperatorError(`--around takes a step number from the route, not \`${around}\``);
  return { around: step };
}
