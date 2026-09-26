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
}

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
  return {
    command: 'story',
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    ...(file === undefined ? {} : { file }),
    ...(name === undefined ? {} : { name }),
    format,
    ...(zoom === undefined ? {} : { zoom }),
  };
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
