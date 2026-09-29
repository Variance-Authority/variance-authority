/**
 * `variance layers`: which dependency layer each package sits in, and, against
 * a base, which packages changed layer and why.
 *
 * A layer is one more than the highest layer among the packages a package
 * takes. A change moves everything above it, so the answer against a base is
 * the few packages whose own dependencies changed, each with the count it
 * carried along, and never the list of everything that moved.
 *
 * Nothing here decides: the exit is clean whatever the answer, and the
 * markdown answer is empty when nothing moved, so a poster clears its comment
 * rather than posting a line that says nothing happened.
 */

// compass: variance-authority.reach.relations

import { layerMoves, packageLayers, type LayerCause, type LayerMoves, type PackageLayer } from '@variance-authority/sense';
import { OperatorError } from '../exit.js';
import type { ParsedLayers } from '../layers-args.js';

/** First line of the markdown answer, which the poster finds the previous comment by. */
export const LAYERS_MARKER = '<!-- variance-authority:layers -->';

function read(root: string, index: string | undefined, what: string): readonly PackageLayer[] {
  const layers = index === undefined ? packageLayers(root) : packageLayers(root, index);
  if (layers?.packages == null) {
    const why = layers?.unmade == null
      ? 'no code map is kept beside it; `variance index` folds one'
      : `it was folded into no code map, because ${layers.unmade}`;
    throw new OperatorError(`The ${what} source index${index === undefined ? '' : ` at ${index}`} holds no package layers: ${why}.`);
  }
  return layers.packages;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function edges(cause: LayerCause): string {
  return [
    ...cause.added.map((name) => `takes ${name}`),
    ...cause.removed.map((name) => `no longer takes ${name}`),
  ].join(', ');
}

function cascade(cause: LayerCause): string {
  return cause.carried.length > 0 ? ` Carried ${plural(cause.carried.length, 'package')}.` : '';
}

function headline(moves: LayerMoves): string {
  const causes = moves.causes.length;
  const rest = moves.carried > 0
    ? ` ${plural(moves.carried, 'other package')} moved with ${causes === 1 ? 'it' : 'them'}.`
    : '';
  return `${plural(causes, 'package')} ${causes === 1 ? 'changed its layer' : 'changed layer'} by ${causes === 1 ? 'its' : 'their'} own dependencies.${rest}`;
}

function existence(moves: LayerMoves): string[] {
  const lines: string[] = [];
  if (moves.appeared.length > 0) lines.push(`Appeared: ${moves.appeared.join(', ')}`);
  if (moves.vanished.length > 0) lines.push(`Vanished: ${moves.vanished.join(', ')}`);
  return lines;
}

function quiet(moves: LayerMoves): boolean {
  return moves.causes.length === 0 && moves.carried === 0 && existence(moves).length === 0;
}

function text(moves: LayerMoves): string {
  if (quiet(moves)) return 'No package changed layer.\n';
  const lines = moves.causes.length > 0 ? [headline(moves)] : [];
  for (const cause of moves.causes) lines.push(`${cause.package} ${cause.from} → ${cause.to}: ${edges(cause)}.${cascade(cause)}`);
  lines.push(...existence(moves));
  return `${lines.join('\n')}\n`;
}

function markdown(moves: LayerMoves): string {
  if (quiet(moves)) return '';
  const lines = [LAYERS_MARKER, '### Dependency layers', ''];
  if (moves.causes.length > 0) lines.push(headline(moves), '');
  for (const cause of moves.causes) lines.push(`- \`${cause.package}\` ${cause.from} → ${cause.to}: ${edges(cause)}.${cascade(cause)}`);
  const rest = existence(moves);
  if (rest.length > 0) lines.push('', ...rest.map((line) => `${line}  `));
  return `${lines.join('\n')}\n`;
}

/** Every package's layer, lowest first, then by name in code-unit order. */
function listing(packages: readonly PackageLayer[], format: ParsedLayers['format']): string {
  const sorted = [...packages].sort((a, b) => a.layer - b.layer || (a.package < b.package ? -1 : a.package > b.package ? 1 : 0));
  if (format === 'json') return `${JSON.stringify({ packages: sorted.map((entry) => ({ package: entry.package, layer: entry.layer })) })}\n`;
  const lines = sorted.map((entry) => `${entry.layer} ${entry.package}`);
  return format === 'markdown' ? `${lines.map((line) => `- ${line}`).join('\n')}\n` : `${lines.join('\n')}\n`;
}

export function layersOutput(request: ParsedLayers): string {
  const head = read(request.root, undefined, "checkout's");
  if (request.against === undefined) return listing(head, request.format);
  const moves = layerMoves(read(request.root, request.against, 'base'), head);
  if (request.format === 'json') return `${JSON.stringify(moves)}\n`;
  return request.format === 'markdown' ? markdown(moves) : text(moves);
}
