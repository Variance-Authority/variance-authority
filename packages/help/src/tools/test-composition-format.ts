/**
 * The `docs_test_composition` answer as text: the test's footprint against the
 * suite, the smaller tests inside it, the larger ones holding it, then the
 * regions no piece entered, split into its own layer and the paths of a piece's
 * modules only it takes.
 *
 * Every count is regions, and every row a file, a line range and a test or a
 * region; nothing is read from source text. A part with nothing in it is left
 * out, except that a test with neither pieces nor wholes says so once.
 */

// compass: variance-authority.report.agent-surface

import { cappedRows } from '@variance-authority/mcp/tools';
import type { JourneyBlock, JourneyPiece, TestComposition } from '@variance-authority/sense';

/** Rows listed per part when the part is longer. */
const ROWS = 12;

/** The composition as text; `test` is set, since a refusal is not formatted. */
export function formatTestComposition(composition: TestComposition): string {
  const { suite, structure } = composition;
  const test = composition.test ?? { file: '', name: '', blocks: 0 };
  const majority = `run by more than half of the ${suite} recorded tests`;
  if (test.blocks === 0) {
    if (structure === 0) return `${test.file}  ${test.name}: an empty footprint; it ran no recorded region.`;
    return `${test.file}  ${test.name}: an empty footprint; all ${structure} regions it ran are structure, ${majority}.`;
  }
  const head = `${test.file}  ${test.name}: a footprint of ${regions(test.blocks)}`;
  const lines = [structure === 0 ? `${head}.` : `${head}; ${structure} more ${structure === 1 ? 'is' : 'are'} structure, ${majority}.`];
  if (composition.alike > 0) {
    lines.push(`${composition.alike === 1 ? '1 other test' : `${composition.alike} other tests`} ran exactly the same regions.`);
  }
  if (composition.pieces.length === 0 && composition.wholes.length === 0) {
    lines.push('', 'No smaller test sits inside it and no larger test holds it.');
  }
  if (composition.pieces.length > 0) {
    lines.push('', 'Pieces, smaller tests inside it, most shared first:');
    lines.push(...cappedRows(composition.pieces, (piece) => `  ${named(piece)}  (${piece.shared} of its ${regions(piece.case.blocks)} inside it)`, ROWS));
  }
  if (composition.wholes.length > 0) {
    lines.push('', 'Wholes, larger tests holding it, smallest first:');
    lines.push(...cappedRows(composition.wholes, (whole) => `  ${named(whole)}  (${regions(whole.case.blocks)}, ${whole.shared} of the ${test.blocks} inside it)`, ROWS));
  }
  const left = composition.own.length + composition.reached.length;
  if (left === 0) {
    lines.push('', `Its pieces ran all ${regions(test.blocks)}: nothing is its alone.`);
    return lines.join('\n');
  }
  lines.push(
    '',
    composition.explained === 0
      ? `No piece ran any of its ${regions(test.blocks)}:`
      : `Pieces ran ${composition.explained} of its ${regions(test.blocks)}. The other ${left} no piece ran:`,
  );
  if (composition.own.length > 0) {
    lines.push('Its own layer, in modules no piece ran:');
    lines.push(...cappedRows(composition.own, region, ROWS));
  }
  if (composition.reached.length > 0) {
    lines.push('Paths of a piece\'s modules only it takes; a test nearer that code would run them more cheaply:');
    lines.push(...cappedRows(composition.reached, region, ROWS));
  }
  return lines.join('\n');
}

function named(piece: JourneyPiece): string {
  return `${piece.case.file}  ${piece.case.name}`;
}

/** A region as its place and what it is; a function is named, any other region by the function it is written in. An anonymous function has no name to give. */
function region(block: JourneyBlock): string {
  const span = block.end === block.line ? `${block.line}` : `${block.line}-${block.end}`;
  const what = block.function === undefined || block.function === null || block.function === ''
    ? block.kind
    : block.kind === 'function' ? `function ${block.function}` : `${block.kind} in ${block.function}`;
  return `  ${block.file}:${span}  ${what}`;
}

function regions(count: number): string {
  return `${count} ${count === 1 ? 'region' : 'regions'}`;
}
