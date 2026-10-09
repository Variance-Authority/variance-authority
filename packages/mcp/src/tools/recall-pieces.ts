import type { ResidueRecord, SubjectPiecesRecord, SubjectShareRecord } from '@variance-authority/report';

/**
 * One subject read as the narrower subjects inside it, as text.
 *
 * Its footprint against structure, the smaller subjects inside it, the larger
 * ones holding it, then what no piece renders: components only it mounts, and
 * components a piece mounts and renders another way. Every count is renderings —
 * a component and the digest of what it rendered — so a component rendered two
 * ways is two. A part with nothing in it is left out.
 */

/** Rows listed per part when the part is longer. */
const ROWS = 12;

export function recallPieces(record: SubjectPiecesRecord): string {
  const { footprint, structure } = record;
  const majority = 'mounted by more than half the suite';
  if (footprint === 0) {
    return `nothing of its own: all ${components(structure)} it mounts ${structure === 1 ? 'is' : 'are'} structure, ${majority}.`;
  }
  const head = `${renderings(footprint)} of its own`;
  const lines = [
    structure === 0 ? `${head}.` : `${head}; ${structural(structure)}, ${majority}, ${structure === 1 ? 'is' : 'are'} left out.`,
  ];
  if (record.alike.length > 0) {
    const others = record.alike.length === 1 ? '1 other subject renders' : `${record.alike.length} other subjects render`;
    lines.push(`${others} exactly the same: ${record.alike.join(', ')}`);
  }
  if (record.pieces.length > 0) {
    lines.push('pieces, smaller subjects inside it, most shared first:');
    listed(lines, record.pieces, (piece) => `  ${piece.subject}  (${piece.shared} of its ${renderings(piece.footprint)} inside it)`);
  }
  if (record.wholes.length > 0) {
    lines.push('wholes, larger subjects holding it, smallest first:');
    listed(lines, record.wholes, (whole: SubjectShareRecord) => `  ${whole.subject}  (${renderings(whole.footprint)}, ${whole.shared} of the ${footprint} inside it)`);
  }
  const left = footprint - record.explained;
  if (left === 0) {
    lines.push(`its pieces render all ${renderings(footprint)}: nothing is its alone.`);
    return lines.join('\n');
  }
  lines.push(
    record.explained === 0
      ? `no piece renders any of its ${renderings(footprint)}:`
      : `pieces render ${record.explained} of its ${renderings(footprint)}. The other ${left} no piece renders:`,
  );
  if (record.own.length > 0) {
    lines.push('  its own, in components no piece mounts:');
    listed(lines, record.own, (row) => `    ${row.component}  (${renderings(row.renderings)})`);
  }
  if (record.inContext.length > 0) {
    lines.push('  in context, components a piece renders another way:');
    listed(lines, record.inContext, inContext);
  }
  return lines.join('\n');
}

function inContext(row: ResidueRecord): string {
  const by = row.pieces ?? [];
  const pieces = by.length <= 4 ? by.join(', ') : `${by.slice(0, 4).join(', ')} and ${by.length - 4} more`;
  return `    ${row.component}  (${renderings(row.renderings)}; ${pieces} render${by.length === 1 ? 's' : ''} it otherwise)`;
}

function renderings(count: number): string {
  return `${count} ${count === 1 ? 'rendering' : 'renderings'}`;
}

function components(count: number): string {
  return `${count} ${count === 1 ? 'component' : 'components'}`;
}

function structural(count: number): string {
  return `${count} structural ${count === 1 ? 'component' : 'components'}`;
}

function listed<T>(lines: string[], rows: readonly T[], row: (value: T) => string): void {
  lines.push(...rows.slice(0, ROWS).map(row));
  if (rows.length > ROWS) lines.push(`  and ${rows.length - ROWS} more`);
}
