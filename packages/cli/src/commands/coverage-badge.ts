/**
 * The figure as an image a README can link to. The label is the unit, `regions
 * run`: the figure runs lower than the line coverage a stranger expects from a
 * badge, and read as that it says something false.
 */

const HEIGHT = 20;
const LABEL = 'regions run';
/** Verdana at 11px, wide enough for a digit: the image has no font to measure with. */
const CHARACTER = 7;
const PADDING = 12;

export function coverageBadge(value: string): string {
  const left = LABEL.length * CHARACTER + PADDING;
  const right = value.length * CHARACTER + PADDING;
  const width = left + right;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" role="img" aria-label="${LABEL}: ${value}">`,
    `<title>${LABEL}: ${value}</title>`,
    `<rect width="${left}" height="${HEIGHT}" fill="#555"/>`,
    `<rect x="${left}" width="${right}" height="${HEIGHT}" fill="#007ec6"/>`,
    '<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="11">',
    `<text x="${left / 2}" y="14">${LABEL}</text>`,
    `<text x="${left + right / 2}" y="14">${value}</text>`,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}
