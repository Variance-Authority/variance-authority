/**
 * `variance layers`: which dependency layer each package sits in, and, against
 * a base, which packages changed layer and why.
 *
 * A layer is one more than the highest layer among the packages a package
 * takes. A change moves everything above it, so the answer against a base is
 * the few packages whose own dependencies changed, each with the count it
 * carried along, and never the list of everything that moved.
 *
 * When the root config declares `tiers`, each package is also placed by how
 * much code it pulls in, and a base answer tells the tier moves the same way:
 * the few packages that caused them and the count each carried. Installed
 * packages are not in the code map, so a closure stops at them and the
 * listing says so once. It also names, once, every package whose manifest
 * offers none of its files, because the fold had to compute where that
 * package's shipped code starts rather than read it.
 *
 * Nothing here decides: the exit is clean whatever the answer, and the
 * markdown answer is empty when nothing moved, so a poster clears its comment
 * rather than posting a line that says nothing happened.
 */

// compass: variance-authority.reach.relations

import {
  layerMoves,
  packageLayers,
  tierLabel,
  tierMoves,
  tierOf,
  type LayerCause,
  type LayerHeld,
  type LayerMoves,
  type LayerPresence,
  type PackageLayer,
  type TierCause,
  type TierMoves,
  type Tiers,
} from '@variance-authority/sense';
import { readTiers } from '../config-declared.js';
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

function edges(cause: LayerCause | LayerHeld): string {
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

/** A package that came or went, with its layer and the edges it brought or took away. */
function presence(entry: LayerPresence, verb: string): string {
  return `${entry.package} ${entry.layer}${entry.takes.length > 0 ? ` (${verb} ${entry.takes.join(', ')})` : ''}`;
}

function existence(moves: LayerMoves): string[] {
  const lines: string[] = [];
  if (moves.appeared.length > 0) lines.push(`Appeared: ${moves.appeared.map((entry) => presence(entry, 'takes')).join(', ')}`);
  if (moves.vanished.length > 0) lines.push(`Vanished: ${moves.vanished.map((entry) => presence(entry, 'took')).join(', ')}`);
  return lines;
}

function quiet(moves: LayerMoves): boolean {
  return moves.causes.length === 0 && moves.carried === 0 && existence(moves).length === 0;
}

function heldHeadline(moves: LayerMoves): string {
  const count = moves.held.length;
  return `${plural(count, 'package')} changed ${count === 1 ? 'its' : 'their'} own dependencies and kept ${count === 1 ? 'its layer' : 'their layers'}.`;
}

function heldLine(held: LayerHeld): string {
  return `${held.package} ${held.layer}: ${edges(held)}.`;
}


/** What a tier cause did to its own code: the lines it ships, and the packages it took or dropped. */
function tierEdges(cause: TierCause): string {
  const parts = [
    ...(cause.ownFrom === cause.ownTo ? [] : [`its own code ${cause.ownFrom} → ${cause.ownTo} lines`]),
    ...cause.added.map((name) => `takes ${name}`),
    ...cause.removed.map((name) => `no longer takes ${name}`),
  ];
  return parts.length > 0 ? parts.join(', ') : 'a package it pulls in changed size through code no package owns';
}

function tierLine(cause: TierCause): string {
  const carried = cause.carried.length > 0 ? ` Carried ${plural(cause.carried.length, 'package')}.` : '';
  return `${cause.package} ${tierLabel(cause.from)} → ${tierLabel(cause.to)} (${cause.linesFrom} → ${cause.linesTo} lines): ${tierEdges(cause)}.${carried}`;
}

function tierHeadline(moves: TierMoves): string {
  const causes = moves.causes.length;
  const rest = moves.carried > 0 ? ` ${plural(moves.carried, 'other package')} moved with ${causes === 1 ? 'it' : 'them'}.` : '';
  return `${plural(causes, 'package')} changed tier.${rest}`;
}

function text(moves: LayerMoves, tiers: TierMoves | undefined): string {
  const lines: string[] = [];
  if (quiet(moves)) lines.push('No package changed layer.');
  else {
    if (moves.causes.length > 0) lines.push(headline(moves));
    for (const cause of moves.causes) lines.push(`${cause.package} ${cause.from} → ${cause.to}: ${edges(cause)}.${cascade(cause)}`);
    lines.push(...existence(moves));
  }
  if (moves.held.length > 0) lines.push(heldHeadline(moves), ...moves.held.map(heldLine));
  if (tiers !== undefined) {
    if (tiers.causes.length === 0) lines.push('No package changed tier.');
    else lines.push(tierHeadline(tiers), ...tiers.causes.map(tierLine));
  }
  return `${lines.join('\n')}\n`;
}

function markdown(moves: LayerMoves, tiers: TierMoves | undefined): string {
  const tiersMoved = tiers !== undefined && tiers.causes.length > 0;
  const held = moves.held.length > 0;
  if (quiet(moves) && !held && !tiersMoved) return '';
  const lines = [LAYERS_MARKER];
  if (!quiet(moves) || held) lines.push('### Dependency layers', '');
  if (!quiet(moves)) {
    if (moves.causes.length > 0) lines.push(headline(moves), '');
    for (const cause of moves.causes) lines.push(`- \`${cause.package}\` ${cause.from} → ${cause.to}: ${edges(cause)}.${cascade(cause)}`);
    const rest = existence(moves);
    if (rest.length > 0) lines.push(...(moves.causes.length > 0 ? [''] : []), ...rest.map((line) => `${line}  `));
  }
  if (held) {
    if (!quiet(moves)) lines.push('');
    lines.push(heldHeadline(moves), '');
    for (const entry of moves.held) lines.push(`- \`${entry.package}\`${heldLine(entry).slice(entry.package.length)}`);
  }
  if (tiersMoved) {
    if (lines.length > 1) lines.push('');
    lines.push('### Tiers', '', tierHeadline(tiers), '');
    for (const cause of tiers.causes) {
      const line = tierLine(cause);
      lines.push(`- \`${cause.package}\`${line.slice(cause.package.length)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

const UNCOUNTED = 'Installed packages are not in the code map, so no closure counts their lines.';

/** The packages whose manifest names none of their files, which the listing says once, or nothing. */
function undeclared(packages: readonly PackageLayer[]): string[] {
  const names = packages
    .filter((entry) => entry.undeclared)
    .map((entry) => entry.package)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (names.length === 0) return [];
  return ['', `No \`exports\`, \`main\`, \`module\` or \`bin\` names a file of these packages, so each one's closure starts at the files its own code never imports: ${names.join(', ')}.`];
}

/** One package's tier and the closure that places it, or nothing when no tiers are declared. */
function placed(entry: PackageLayer, tiers: Tiers | undefined): string {
  if (tiers === undefined) return '';
  const unsized = entry.unsizedFiles > 0 ? `, ${plural(entry.unsizedFiles, 'file')} unsized` : '';
  return ` ${tierLabel(tierOf(tiers, entry))} (${plural(entry.lines, 'line')} in ${plural(entry.files, 'file')}${unsized})`;
}

/** Every package's layer, lowest first, then by name in code-unit order. */
function listing(packages: readonly PackageLayer[], tiers: Tiers | undefined, format: ParsedLayers['format']): string {
  const sorted = [...packages].sort((a, b) => a.layer - b.layer || (a.package < b.package ? -1 : a.package > b.package ? 1 : 0));
  if (format === 'json') {
    const entries = sorted.map((entry) => ({
      package: entry.package,
      layer: entry.layer,
      ...(tiers === undefined ? {} : { ...tierOf(tiers, entry), lines: entry.lines, files: entry.files, unsizedFiles: entry.unsizedFiles, undeclared: entry.undeclared }),
    }));
    return `${JSON.stringify({ packages: entries })}\n`;
  }
  const lines = sorted.map((entry) => `${entry.layer} ${entry.package}${placed(entry, tiers)}`);
  const note = tiers === undefined ? [] : ['', UNCOUNTED, ...undeclared(sorted)];
  return format === 'markdown' ? `${[...lines.map((line) => `- ${line}`), ...note].join('\n')}\n` : `${[...lines, ...note].join('\n')}\n`;
}

export function layersOutput(request: ParsedLayers): string {
  const head = read(request.root, undefined, "checkout's");
  const tiers = readTiers(request.root);
  if (request.against === undefined) return listing(head, tiers, request.format);
  const base = read(request.root, request.against, 'base');
  const moves = layerMoves(base, head);
  const tiered = tiers === undefined ? undefined : tierMoves(base, head, tiers);
  if (request.format === 'json') return `${JSON.stringify(tiered === undefined ? moves : { ...moves, tiers: tiered })}\n`;
  return request.format === 'markdown' ? markdown(moves, tiered) : text(moves, tiered);
}
