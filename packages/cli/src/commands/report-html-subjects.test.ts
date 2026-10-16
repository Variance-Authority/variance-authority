import { describe, expect, it } from 'vitest';
import { presentationImpact } from './report-html-subjects.js';

describe('presentation impact on the page', () => {
  it('names the side that supplied no presentation reading as a change', () => {
    const html = presentationImpact([{
      subject: 'story:underwriter',
      verdict: 'unchanged',
      because: 'no pixels differ',
      changedPixels: 0,
      signals: { presentation: { verdict: 'changed', because: 'the baseline supplied no presentation reading' } },
      regions: [],
    }]);

    expect(html).toContain('<span class="mark warn">changed</span>the baseline supplied no presentation reading');
    expect(html).not.toContain('incomparable');
  });
});
