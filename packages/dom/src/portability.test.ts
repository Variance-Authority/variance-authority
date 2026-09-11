// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Viewport } from '@variance-authority/core/format';
import { normalize } from '@variance-authority/core/rules';
import { collect } from './collect.js';

/**
 * Baseline portability across machines.
 *
 * The reason visual regression ends up inside a container is that rasterization
 * is machine-bound: a different GPU, driver, or pixel ratio paints the same page
 * differently, so a pixel baseline is only valid on the machine that produced it.
 * The usual answer is to pin the whole pipeline in Docker, which pays a
 * per-subject, per-build cost to stabilise the tier that decides almost nothing.
 *
 * The semantic representation is built from the box tree, which device pixel
 * ratio cannot reach — layout is in CSS pixels. So the *semantic* key omits it
 * and one baseline is valid everywhere, leaving the container needed only for
 * the raster residue the tiering already makes rare.
 *
 * These tests hold both halves of that: the omission is real, and it is safe.
 * The second half is the one worth the effort — an omission that were merely
 * convenient would be a false `unchanged` generator.
 */

const AT = (deviceScaleFactor: number): Viewport => ({
  width: 1024,
  height: 768,
  deviceScaleFactor,
  colorScheme: 'light',
});

function snapshotAt(dpr: number, css: string) {
  document.head.innerHTML = `<style>${css}</style>`;
  document.body.innerHTML = '<div id="s"><p class="copy">Portable?</p></div>';

  return normalize(
    collect(document.getElementById('s')!, {
      subject: { id: 'story:portability', kind: 'story' },
      viewport: AT(dpr),
      engine: 'jsdom@portability',
      fonts: ['system/400/normal/pinned'],
    }),
  );
}

const PLAIN = '.copy { color: #333; padding-top: 8px; }';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('a semantic baseline crosses machines', () => {
  it('produces one render hash on a retina and a non-retina runner', () => {
    // The claim in one assertion. A pixel baseline cannot do this, and that
    // inability is the entire reason for the container.
    expect(snapshotAt(1, PLAIN).renderHash).toBe(snapshotAt(2, PLAIN).renderHash);
  });

  it.todo(
    'a capture recorded on macOS and one recorded on Linux normalize to the same renderHash — needs a fixture committed from each platform, which is the artifact `docker/linux-verify.sh` does not write: it agrees verdict by verdict inside one container and leaves no hash behind to compare against',
  );

  it('keeps the raster key machine-specific, because raster is', () => {
    // Not an oversight that the two keys differ. A raster baseline genuinely is
    // machine-bound; the point is that only raster pays for it.
    expect(snapshotAt(1, PLAIN).environment.digest).not.toBe(
      snapshotAt(2, PLAIN).environment.digest,
    );
  });

  it('still separates two viewport widths', () => {
    // Portability must not become permissiveness. Width reaches the box tree, so
    // it stays in the semantic key.
    document.head.innerHTML = `<style>${PLAIN}</style>`;
    document.body.innerHTML = '<div id="s"><p class="copy">Portable?</p></div>';

    const narrow = normalize(
      collect(document.getElementById('s')!, {
        subject: { id: 'story:portability', kind: 'story' },
        viewport: { ...AT(1), width: 480 },
        engine: 'jsdom@portability',
        fonts: ['system/400/normal/pinned'],
      }),
    );

    expect(narrow.renderHash).not.toBe(snapshotAt(1, PLAIN).renderHash);
  });

  it('still separates two font sets', () => {
    // A font substitution changes metrics and therefore geometry. Dropping fonts
    // would make baselines beautifully portable and quietly wrong.
    document.head.innerHTML = `<style>${PLAIN}</style>`;
    document.body.innerHTML = '<div id="s"><p class="copy">Portable?</p></div>';

    const other = normalize(
      collect(document.getElementById('s')!, {
        subject: { id: 'story:portability', kind: 'story' },
        viewport: AT(1),
        engine: 'jsdom@portability',
        fonts: ['system/400/normal/different-bytes'],
      }),
    );

    expect(other.renderHash).not.toBe(snapshotAt(1, PLAIN).renderHash);
  });
});

describe('the omission is safe, not merely convenient', () => {
  const RESOLUTION_GATED = `
    ${PLAIN}
    @media (min-resolution: 2dppx) { .copy { padding-top: 40px; } }
  `;

  it('splits the key when a resolution query resolves differently', () => {
    // The hole this would otherwise open. `deviceScaleFactor` is not in the
    // semantic key, but a rule gated on it genuinely applies to one machine and
    // not the other — so the *outcome* of every flattened condition is recorded
    // in the key, and the two runs stop sharing a baseline through that.
    expect(snapshotAt(1, RESOLUTION_GATED).renderHash).not.toBe(
      snapshotAt(2, RESOLUTION_GATED).renderHash,
    );
  });

  it('applies the gated rule on the machine that satisfies it', () => {
    // Confirms the split is caused by the rule applying, rather than by the
    // condition text differing while both machines rendered the same thing.
    const copyAt = (dpr: number): Record<string, string> => {
      const snapshot = snapshotAt(dpr, RESOLUTION_GATED);
      const copy = snapshot.root.children.find((child) => child.tag === 'p');
      if (!copy) throw new Error('the styled paragraph did not survive normalization');
      return copy.style as Record<string, string>;
    };

    expect(copyAt(2)['padding-top']).toBe('40px');
    expect(copyAt(1)['padding-top']).toBe('8px');
  });

  it('records the resolved condition in the environment inputs', () => {
    const at2 = snapshotAt(2, RESOLUTION_GATED);
    const entries = Object.entries(at2.environment.inputs.conditions);

    expect(entries.some(([prelude, matched]) => prelude.includes('min-resolution') && matched)).toBe(
      true,
    );
  });

  it('does not split the key on a resolution query neither machine satisfies', () => {
    // The other direction, and the reason for recording the outcome rather than
    // the presence of a query: a rule gated at 4dppx applies on neither runner,
    // so it is not a difference and must not cost a second baseline.
    const unreachable = `${PLAIN}\n@media (min-resolution: 4dppx) { .copy { padding-top: 40px; } }`;

    expect(snapshotAt(1, unreachable).renderHash).toBe(snapshotAt(2, unreachable).renderHash);
  });
});
