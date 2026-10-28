import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';

export interface ParsedStory {
  readonly command: 'story';
  /** The story's test file, by its path in the checkout. */
  readonly file?: string;
  /** The story's case, by its whole name as the runner reports it; absent when several are compared. */
  readonly name?: string;
  /** The checkout the stories were written in; defaults to the working directory. */
  readonly root: string;
  readonly format: 'text' | 'json';
  /** How much of the route to read; absent, the overview of files and declarations. */
  readonly zoom?: StoryZoom;
  /** Read the newest reading with this label rather than the newest of all. */
  readonly label?: string;
  /** Which readings to compare, of one case or of several, instead of reading one route. */
  readonly compare?: StoryCompare;
}

/**
 * The sides of a comparison: the two newest readings of a case, its readings
 * that passed against the ones that threw, its readings under each of several
 * labels, or several cases, each by its readings. `1` names the readings a run
 * wrote with the variable set to `1`. A case is named as `--name` names one,
 * or as `<file> > <name>` when two files hold a case by that name.
 */
export type StoryCompare =
  | 'last'
  | 'outcome'
  | { readonly labels: readonly string[] }
  | { readonly cases: readonly string[] };

/** One file's part of the route, one package's, the steps near one step, or all of it. */
export type StoryZoom =
  | { readonly in: string }
  | { readonly package: string }
  | { readonly around: number }
  | { readonly whole: true };

const ZOOMS = ['--in', '--package', '--around', '--whole'] as const;

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
  const names = flags.repeated.get('--name') ?? [];
  const twice = names.find((name, at) => names.indexOf(name) !== at);
  if (twice !== undefined) throw new OperatorError(`--name ${twice} is named twice; name each case once`);
  if (names.length > 1 && flags.present.has('--compare')) {
    throw new OperatorError('several --name compare those cases, and --compare compares readings of one; name one case with --compare, or drop it');
  }
  const name = names.length > 1 ? undefined : flags.values.get('--name');
  const label = flags.values.get('--label');
  const compare = names.length > 1 ? { cases: names } : compareOf(flags.values.get('--compare'));
  if (compare !== undefined && zooms.length > 0) {
    const comparing = names.length > 1 ? 'several --name compare cases and read' : '--compare reads';
    throw new OperatorError(`${comparing} no route, so ${zooms.join(' and ')} has nothing to narrow; name one or the other`);
  }
  if (compare !== undefined && !(typeof compare === 'object' && 'cases' in compare) && label !== undefined) {
    throw new OperatorError('--label picks the reading to read; with --compare, name every label there: --compare <a>,<b>');
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
  if (labels.length < 2 || labels.some((label) => label === '') || new Set(labels).size < labels.length) {
    throw new OperatorError(`--compare takes last, outcome, or two labels or more as <a>,<b>,…, not \`${value}\``);
  }
  return { labels };
}

function zoomOf(flags: Flags): StoryZoom | undefined {
  if (flags.present.has('--whole')) return { whole: true };
  const within = flags.values.get('--in');
  if (within !== undefined) return { in: within };
  const home = flags.values.get('--package');
  if (home !== undefined) return { package: home };
  const around = flags.values.get('--around');
  if (around === undefined) return undefined;
  const step = Number(around);
  if (!Number.isInteger(step) || step < 1) throw new OperatorError(`--around takes a step number from the route, not \`${around}\``);
  return { around: step };
}
