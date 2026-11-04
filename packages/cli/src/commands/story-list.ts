/**
 * The cases the flags name, when they name more than one: each with the
 * readings kept of it, so the next ask names the one wanted.
 */

import type { StoryEntry } from '@variance-authority/sense/story';
import { labelled } from './story-compare.js';

/** The cases the flags name, one line each with the readings kept of it. */
export function storiesText(entries: readonly StoryEntry[], format: 'text' | 'json'): string {
  const cases = new Map<string, StoryEntry[]>();
  for (const entry of entries) {
    const key = caseOf(entry);
    (cases.get(key) ?? cases.set(key, []).get(key)!).push(entry);
  }
  if (format === 'json') {
    const stories = [...cases.values()].map((readings) => ({
      file: readings[0]!.file,
      name: readings[0]!.name,
      ...(readings[0]!.project === undefined ? {} : { project: readings[0]!.project }),
      readings: readings.map(({ visits, label, written, stopped }) => ({ visits, label, written, stopped })),
    }));
    return `${JSON.stringify({ stories }, null, 2)}\n`;
  }
  const projects = entries.some((entry) => entry.project !== undefined) ? ', and --project' : '';
  const lines = [`${cases.size} stories; name one with --file and --name${projects}`, ''];
  for (const readings of cases.values()) {
    const [newest] = readings;
    const project = newest!.project === undefined ? '' : `project ${newest!.project}, `;
    const kept = readings.length === 1 ? '' : `, ${readings.length} readings${labels(readings)}`;
    lines.push(`  ${newest!.file} > ${newest!.name}  (${project}${newest!.visits} visits${kept})`);
  }
  return `${lines.join('\n')}\n`;
}

/** A case, as its readings are told apart from another's: by its file, its name and the project it ran under. */
export function caseOf(entry: StoryEntry): string {
  return `${entry.file}\0${entry.name}\0${entry.project ?? ''}`;
}

/** The labels a case's readings were written under, when any has one. */
function labels(readings: readonly StoryEntry[]): string {
  const named = [...new Set(readings.map(labelled))].sort();
  return named.length === 1 && named[0] === '1' ? '' : ` labelled ${named.join(', ')}`;
}
