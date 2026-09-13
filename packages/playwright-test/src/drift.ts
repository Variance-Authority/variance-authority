/**
 * What moved while the in-place path was taking its screenshots.
 *
 * The guard that rejects a subject for moving mid-capture is the one message a
 * caller has to act on, and it is thrown from the only place that still holds
 * both readings. Reporting that "something" changed spends that position on
 * nothing: the reader is sent back to the page to re-find a caret, an animation
 * or a poll that this function can already name.
 */

import { digestValue, documentDigest } from '@variance-authority/core/format';
import type {
  AccessibilitySnapshot,
  RenderDocument,
  SemanticSnapshot,
} from '@variance-authority/core/format';

/** The four independently digested readings the in-place guard compares. */
export interface InPlaceReading {
  readonly document: Parameters<typeof documentDigest>[0];
  readonly snapshot: SemanticSnapshot;
  readonly accessibility: AccessibilitySnapshot;
  readonly stabilization: { readonly digest?: string };
}

/**
 * Name every facet that disagrees between two readings of one subject.
 *
 * Structure and style are reported apart even though one snapshot digest covers
 * both, because they point at different writers: a node count that moved is a
 * render still running, and style alone is a transition or a theme settling.
 */
export function driftBetween(before: InPlaceReading, after: InPlaceReading): readonly string[] {
  const drifted: string[] = [];
  if (documentDigest(after.document) !== documentDigest(before.document)) {
    drifted.push(...documentDrift(before.document, after.document));
  }
  if (after.snapshot.structureHash !== before.snapshot.structureHash) {
    drifted.push('DOM structure');
  }
  if (after.snapshot.styleHash !== before.snapshot.styleHash) {
    drifted.push('applied style');
  }
  if (
    drifted.length === 0 &&
    digestValue(JSON.stringify(after.snapshot)) !== digestValue(JSON.stringify(before.snapshot))
  ) {
    // Neither half-hash moved, so whatever differs sits outside them: text
    // content, an attribute the hashes exclude, or provenance.
    drifted.push('subject content');
  }
  if (after.accessibility.digest !== before.accessibility.digest) {
    drifted.push('the accessibility tree');
  }
  if (after.stabilization.digest !== before.stabilization.digest) {
    drifted.push('the stabilization it needed');
  }
  return drifted;
}

/**
 * Which part of the rendered document moved.
 *
 * `documentDigest` covers the markup, the styles that reached it, the frame it
 * sits in and the viewport at once, and the four have nothing in common as
 * causes: markup is a render still committing, CSS is a stylesheet arriving
 * late, and the viewport is something resizing the page under the capture.
 * Reporting the digest would name the reading rather than the writer.
 */
function documentDrift(before: RenderDocument, after: RenderDocument): readonly string[] {
  const moved: string[] = [];
  if (after.html !== before.html) moved.push('the subject markup');
  if (digestValue([...after.css]) !== digestValue([...before.css])) moved.push('the applied CSS');
  if (JSON.stringify(after.frame) !== JSON.stringify(before.frame)) {
    moved.push('the page frame around the subject');
  }
  if (digestValue({ ...after.viewport }) !== digestValue({ ...before.viewport })) {
    moved.push('the viewport');
  }
  if (digestValue({ ...after.inherited }) !== digestValue({ ...before.inherited })) {
    moved.push('style inherited from above the subject');
  }
  if (digestValue([...after.fonts]) !== digestValue([...before.fonts])) {
    moved.push('the fonts the document asked for');
  }
  // Everything the digest covers that the branches above do not: assets, base
  // URL, captured resources, the document version itself.
  return moved.length > 0 ? moved : ['the rendered document'];
}

/** Read a drift list back as the subject of a sentence. */
export function listDrift(drifted: readonly string[]): string {
  if (drifted.length <= 1) return drifted[0] ?? 'nothing';
  return `${drifted.slice(0, -1).join(', ')} and ${drifted[drifted.length - 1]!}`;
}
