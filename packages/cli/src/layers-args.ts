import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';

export type LayersFormat = 'text' | 'markdown' | 'json';

export interface ParsedLayers {
  readonly command: 'layers';
  /** A source index kept at the base, with its code map beside it. */
  readonly against?: string;
  readonly roots?: readonly string[];
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
  const roots = [...new Set(flags.repeated.get('--package') ?? [])];
  if (roots.some((root) => root.trim() === '')) throw new OperatorError('--package takes a non-empty exact package name.');
  if (roots.length > 0 && against !== undefined) throw new OperatorError('--package cannot be combined with --against.');
  return {
    command: 'layers',
    ...(against === undefined ? {} : { against: resolve(against) }),
    ...(roots.length === 0 ? {} : { roots }),
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    format,
  };
}
