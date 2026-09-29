import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';

export type LayersFormat = 'text' | 'markdown' | 'json';

export interface ParsedLayers {
  readonly command: 'layers';
  /** A source index kept at the base, with its code map beside it. Absent: list every package's layer. */
  readonly against?: string;
  readonly root: string;
  readonly format: LayersFormat;
}

export function parseLayersArgs(flags: Flags): ParsedLayers {
  noPositionals(flags.positionals, 'layers');
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'markdown' && format !== 'json') {
    throw new OperatorError(`--format must be text, markdown or json, not \`${format}\``);
  }
  const against = flags.values.get('--against');
  if (against === '') throw new OperatorError('`--against` takes the path of a source index kept at the base.');
  return {
    command: 'layers',
    ...(against === undefined ? {} : { against: resolve(against) }),
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    format,
  };
}
