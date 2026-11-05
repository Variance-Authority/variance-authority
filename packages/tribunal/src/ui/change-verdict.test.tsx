import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SubjectView } from '../review-types.js';
import { build, subject } from '../__fixtures__/build-page.js';
import { ChangePanel } from './change.js';
import { createReviewClient } from './client.js';
import { originsOf } from './grouping.js';

/**
 * The rows and the batch of a change, held to the render page's reading of what
 * a render allows: the same two states, the same two sentences.
 */

const CLIENT = createReviewClient({ endpoint: '/api', token: 'unused-in-a-static-render' });

function page(overrides: Partial<SubjectView>): string {
  const detail = build('4', [subject(overrides)]);
  const origin = originsOf(detail).origins[0];
  if (origin === undefined) throw new Error('this build holds no change to draw');

  return renderToStaticMarkup(
    <ChangePanel
      client={CLIENT}
      reviewer="marina"
      build={detail}
      origin={origin}
      crossing={{ state: 'none' }}
      changes={new Set()}
      go={() => undefined}
      onDecided={() => undefined}
    />,
  );
}

describe('a row offers what the render offers', () => {
  it('offers no verdict on a row whose image the run did not keep', () => {
    const has = { before: true, after: false, diff: false };
    const drawn = page({ has, approvable: false });

    expect(drawn).toMatch(/<button[^>]*disabled=""[^>]*>✓/);
    expect(drawn).toMatch(/<button[^>]*disabled=""[^>]*>✕/);
    expect(drawn).toContain('1 render left out.');
    expect(drawn).toContain('nothing to approve or reject');
  });

  it('keeps ✕ on a row whose image is on screen and cannot become a baseline', () => {
    const drawn = page({ approvable: false });

    expect(drawn).toMatch(/<button[^>]*disabled=""[^>]*>✓/);
    expect(drawn).not.toMatch(/<button[^>]*disabled=""[^>]*>✕/);
    expect(drawn).toContain('1 render left out.');
    expect(drawn).toContain('cannot become a baseline');
    expect(drawn).not.toContain('no candidate image');
  });
});
