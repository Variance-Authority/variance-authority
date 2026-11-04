/**
 * A file's text, for an answer that prints it from a record.
 *
 * A record's lines and spans describe the text its read saw, so they say
 * something only of that text. Whether a file still is that text is a question
 * of write times, the one the look asks: a file written after the read began
 * may hold anything at those lines, and a line that happens to spell the same
 * word says nothing. So the file's own text goes unread, and the answer gives
 * what the record holds.
 */

// compass: variance-authority.report.agent-surface

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Help } from '@variance-authority/package/help';
import { workspaceReadStarted } from '../snapshot.js';

/** Whether a file last written at `mtimeMs` was written after a read that began at `since`, as `movedSince` in sense compares one. */
export function writtenSince(mtimeMs: number, since: number): boolean {
  return Math.floor(mtimeMs) > since;
}

/**
 * The text of `at`, relative to `root`, when it is the text a read that began at
 * `since` saw; nothing when the file is gone or was written after. Its time is
 * taken after the text, so a save between the two costs the text and never
 * passes as old. A reading with no recorded time has only today's text to give.
 */
export function textSince(root: string, at: string, since: number | undefined): string | undefined {
  const path = join(root, at);
  try {
    const text = readFileSync(path, 'utf8');
    return since !== undefined && writtenSince(statSync(path).mtimeMs, since) ? undefined : text;
  } catch {
    return undefined;
  }
}

/** {@link textSince} of the read `help` came from. */
export function textAsRead(help: Help, root: string, at: string): string | undefined {
  return textSince(root, at, workspaceReadStarted(help));
}
