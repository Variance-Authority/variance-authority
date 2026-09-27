/**
 * A page of the code map, said from the page the addon read.
 *
 * Apart from the tool for the reason `orient-format.ts` is: the wording is a
 * pure function of the page, and a test holding it should not need a
 * repository and an index to get one. Every count and every share's parts are
 * the addon's; this divides them into percents and chooses the words.
 *
 * One line heads the page — what it covers, the dependency layers it spans and
 * how many areas it splits into — and one line follows per area: its size, the
 * layers its packages sit in, the packages most of what comes into it lands on,
 * and the areas most of what it imports lands in. An area with no areas inside
 * it lists its packages instead.
 */

// compass: variance-authority.report.agent-surface

import type { CodeMapAnswer, CodeMapPage, CodeMapRow } from '@variance-authority/sense';
import { percent } from './orient-format.js';

/** A count of files, short: `569`, `1.6k`, `27k`. */
export function thousands(count: number): string {
  if (count >= 10000) return `${Math.round(count / 1000)}k`;
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`;
}

/** A package's name without its scope, which a page of one repository's packages repeats on every row. */
export function unscoped(name: string): string {
  return name.replace(/^@[^/]+\//u, '');
}

function heading(page: CodeMapPage, repository: string, layers: number): string {
  const what = page.id === ''
    ? `${repository}: ${page.packages} packages in ${layers} dependency layers (0 takes nothing)`
    : `${page.id} ${page.name}: ${page.packages} packages in dependency layers ${page.low}–${page.high} of ${layers}`;
  const loose = page.alone > 0 && page.rows.length > 0 ? ` + ${page.alone} packages in none` : '';
  return `# ${what}, ${thousands(page.files)} source files, ${page.rows.length} areas${loose}`;
}

function row(area: CodeMapRow): string {
  const parts = [
    `${area.id} ${area.name}`,
    `${area.packages} pkg, ${thousands(area.files)} files`,
    `layers ${area.low}–${area.high} (median ${area.median})`,
  ];
  if (area.incoming > 0) {
    const front = area.front.map((share) => `${unscoped(share.name)} ${percent(share.files / area.incoming)}`).join(', ');
    parts.push(`front: ${front}${area.more > 0 ? ` (+${area.more})` : ''}`);
  }
  if (area.uses.length > 0) {
    parts.push(`uses ${area.uses.map((share) => `${share.name} ${percent(share.files / area.outgoing)}`).join(', ')}`);
  }
  return parts.join(' · ');
}

/** The page as `variance ask orient` prints it; `repository` names the top page. */
export function formatCodeMapPage(answer: CodeMapAnswer & { readonly page: CodeMapPage }, repository: string): string {
  const { page } = answer;
  const lines = [heading(page, repository, answer.layers), ...page.rows.map(row)];
  if (page.rows.length === 0) lines.push(`  packages: ${page.list.map(unscoped).join(', ')}`);
  if (!answer.current) {
    lines.push('', 'This map was folded from an earlier source index; `variance index` folds it again.');
  }
  return lines.join('\n');
}
