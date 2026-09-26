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
}

/** Parse the story reader outside the config-shaped command parser. */
export function parseStory(flags: Flags): ParsedStory {
  noPositionals(flags.positionals, 'story');
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new OperatorError(`--format must be text or json, not \`${format}\``);
  }
  const file = flags.values.get('--file');
  const name = flags.values.get('--name');
  return {
    command: 'story',
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    ...(file === undefined ? {} : { file }),
    ...(name === undefined ? {} : { name }),
    format,
  };
}
