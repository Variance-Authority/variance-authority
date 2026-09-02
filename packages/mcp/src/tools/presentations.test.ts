import type { PresentationReport } from '@variance-authority/presentation';
import { describe, expect, it } from 'vitest';
import { presentations } from './presentations.js';

const REPORT: PresentationReport = {
  formatVersion: 1,
  digest: 'presentation-digest',
  contentDigest: 'content-digest',
  subject: { id: 'story:drawing--default', kind: 'story', title: 'Drawing / Default' },
  semantic: { anchors: [] },
  telemetry: {
    content: {
      elements: 8,
      characters: 14,
      estimatedLines: 2,
      controls: 1,
      repeatedObjects: 0,
    },
  },
  graph: { nodes: [], relations: [] },
  spacing: [],
  axes: [],
  findings: [],
};

describe('variance_presentations', () => {
  it('lists full presentation readings by their producer identity', () => {
    expect(presentations.run([REPORT], {})).toContain(
      'Drawing / Default [story:drawing--default] — 0 node(s), 0 relation(s)',
    );
  });

  it('keeps unavailable structures distinct from measured empty structures', () => {
    const text = presentations.run([REPORT], { subject: 'story:drawing--default' });

    expect(text).toContain('Browser accessibility: unavailable.');
    expect(text).toContain('spacing clusters: measured 0.');
    expect(text).toContain('baseline clusters: unavailable.');
    expect(text).toContain('Findings: measured empty.');
  });
});
