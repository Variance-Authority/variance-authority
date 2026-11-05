import type { SubjectView } from '../review-types.js';
import { senseOfSubject } from './sense.js';

/**
 * What nobody measured on this render, one line per gap.
 *
 * A card with nothing to say is not drawn, and an unknown must not vanish with
 * it: *no defect found* and *never inspected* are different answers. No line for
 * a render with no baseline, whose verdict already says so.
 */
export function gapsOf(subject: SubjectView): readonly string[] {
  const gaps: string[] = [];
  if (subject.changedPixels > 0 && senseOfSubject(subject).unmeasured === 'no-hashes') {
    gaps.push('Which components moved: the baseline has no component hashes to compare.');
  }
  if (subject.findings === undefined) gaps.push('Defects: this render was not inspected.');
  return gaps;
}
