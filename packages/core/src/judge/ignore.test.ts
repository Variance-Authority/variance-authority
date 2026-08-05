import { describe, expect, it } from 'vitest';
import {
  applyIgnores,
  summarizeIgnores,
  validateIgnoreRule,
  type IgnoreRule,
} from './ignore.js';
import { isUnder, matchesGlob } from './scope.js';
import { fingerprintOfMask, fingerprintOfRoot } from './fingerprint.js';
import { buildDocket } from './docket.js';
import { diffSnapshots, type SemanticDiff } from '../compare/diff/index.js';
import { normalize } from '../rules/normalize/index.js';
import { capture, node } from '../rules/normalize/fixture.js';
import type { ChangeMask } from '../attribute/mask.js';

/**
 * What an ignore has to be, to be worth having.
 *
 * The suite is written against the failure that makes ignores dangerous rather
 * than against the feature: a rule that silences more than it says, or that
 * silences forever, or that produces a subject indistinguishable from one that
 * genuinely did not change. Each of those is a test here, and each of them is a
 * bug this file exists to make impossible rather than unlikely.
 */

/** A page with a live clock beside a real control, both under named owners. */
function pageWithClock(clock: string, label: string, subjectId = 'route:/dashboard'): SemanticDiff {
  const build = (time: string, buttonLabel: string) =>
    capture({
      subjectId,
      root: node({
        owners: [{ name: 'Dashboard', props: {} }],
        children: [
          node({
            tag: 'time',
            text: time,
            owners: [{ name: 'Clock', props: {} }, { name: 'Dashboard', props: {} }],
          }),
          node({
            tag: 'button',
            role: 'button',
            name: buttonLabel,
            text: buttonLabel,
            owners: [{ name: 'Refresh', props: {} }, { name: 'Dashboard', props: {} }],
          }),
        ],
      }),
    });

  return diffSnapshots(
    normalize(build('09:41', 'Refresh')),
    normalize(build(clock, label)),
  );
}

/** The path of the `<time>` element in the tree above. */
const CLOCK_PATH = '0/0';

const CLOCK: IgnoreRule = {
  id: 'dashboard-clock',
  reason: 'renders wall time, which moves every run',
};

const SITES = { 'route:/dashboard': [{ path: CLOCK_PATH, rule: 'dashboard-clock' }] };

describe('absorbing a difference by place', () => {
  it('removes the clock and keeps the regression beside it', () => {
    const diff = pageWithClock('11:02', 'Reload');
    const { diffs, register } = applyIgnores([diff], [CLOCK], { sites: SITES });

    expect(register.totalAbsorbed).toBeGreaterThan(0);
    // The button is the whole point: an ignore that took the regression with it
    // would be indistinguishable from switching the subject off.
    expect(diffs[0]!.deltas.some((delta) => delta.path.startsWith('0/1'))).toBe(true);
    expect(diffs[0]!.deltas.some((delta) => delta.path.startsWith(CLOCK_PATH))).toBe(false);
  });

  it('leaves the docket explaining the regression alone', () => {
    const { diffs } = applyIgnores([pageWithClock('11:02', 'Reload')], [CLOCK], { sites: SITES });
    const docket = buildDocket(diffs);

    expect(docket.entries.length).toBeGreaterThan(0);
    expect(docket.entries.flatMap((entry) => entry.components.map((c) => c.name))).toContain(
      'Refresh',
    );
  });

  it('names the subject as fully absorbed when nothing else moved', () => {
    // The rule this whole file rests on: a subject that differed and was not
    // looked at is not a subject that did not differ. `fullyAbsorbed` is the
    // only thing standing between an ignore and a silent pass.
    const { diffs, register } = applyIgnores([pageWithClock('11:02', 'Refresh')], [CLOCK], {
      sites: SITES,
    });

    expect(register.fullyAbsorbed).toEqual(['route:/dashboard']);
    expect(diffs[0]!.deltas).toHaveLength(0);
    expect(diffs[0]!.identical).toBe(false);
  });

  it('does not absorb a subject the rule does not name', () => {
    const diff = pageWithClock('11:02', 'Refresh', 'route:/settings');
    const scoped = { ...CLOCK, subjects: ['route:/dashboard'] };

    const { register } = applyIgnores([diff], [scoped], { sites: SITES });

    expect(register.totalAbsorbed).toBe(0);
    expect(register.dead).toEqual(['dashboard-clock']);
  });
});

describe('absorbing a difference by shape', () => {
  it('recognises the same change in a subject the rule never listed', () => {
    const first = pageWithClock('11:02', 'Refresh', 'route:/a');
    const second = pageWithClock('11:03', 'Refresh', 'route:/b');

    const clockRoot = first.roots.find((root) =>
      root.deltas.some((delta) => delta.path.startsWith(CLOCK_PATH)),
    );
    expect(clockRoot).toBeDefined();

    const byShape: IgnoreRule = {
      id: 'clock-shape',
      reason: 'wall time, wherever it is rendered',
      fingerprints: [fingerprintOfRoot(clockRoot!)],
    };

    const { register } = applyIgnores([first, second], [byShape]);

    expect(register.absorbed[0]!.subjects.sort()).toEqual(['route:/a', 'route:/b']);
  });

  it('is scoped to the component, so an identical-looking change elsewhere survives', () => {
    // The property a coordinate mask cannot have. `Clock` and `Refresh` both
    // changed their text; silencing one must not silence the other.
    const diff = pageWithClock('11:02', 'Reload');

    const clockRoot = diff.roots.find((root) => root.cause === 'Clock');
    const buttonRoot = diff.roots.find((root) => root.cause === 'Refresh');

    expect(clockRoot).toBeDefined();
    expect(buttonRoot).toBeDefined();
    expect(fingerprintOfRoot(clockRoot!)).not.toBe(fingerprintOfRoot(buttonRoot!));
  });

  it('is stable across runs, which is what makes it writable into a config', () => {
    const one = pageWithClock('11:02', 'Refresh', 'route:/a');
    const two = pageWithClock('23:59', 'Refresh', 'route:/a');

    const root = (diff: SemanticDiff) => diff.roots.find((r) => r.cause === 'Clock')!;

    expect(fingerprintOfRoot(root(one))).toBe(fingerprintOfRoot(root(two)));
  });

  it('reports which shapes a place-scoped rule absorbed, so it can be narrowed', () => {
    const { register } = applyIgnores([pageWithClock('11:02', 'Refresh')], [CLOCK], {
      sites: SITES,
    });

    expect(register.absorbed[0]!.fingerprints.length).toBeGreaterThan(0);
  });
});

describe('a rule that stops working', () => {
  it('is reported as dead rather than kept quietly', () => {
    const unchanged = pageWithClock('09:41', 'Refresh');
    const { register } = applyIgnores([unchanged], [CLOCK], { sites: SITES });

    expect(register.dead).toEqual(['dashboard-clock']);
    expect(summarizeIgnores(register)).toContain('[dead] dashboard-clock');
  });

  it('stops absorbing past its date, and says so', () => {
    const rule = { ...CLOCK, until: '2026-01-01' };
    const { diffs, register } = applyIgnores([pageWithClock('11:02', 'Refresh')], [rule], {
      sites: SITES,
      now: '2026-08-05',
    });

    expect(register.expired).toEqual(['dashboard-clock']);
    expect(register.totalAbsorbed).toBe(0);
    // The differences come back. That is the point of an expiry rather than a
    // warning: the suite starts reporting again without anyone editing anything.
    expect(diffs[0]!.deltas.length).toBeGreaterThan(0);
  });

  it('still absorbs before its date', () => {
    const rule = { ...CLOCK, until: '2026-12-31' };
    const { register } = applyIgnores([pageWithClock('11:02', 'Refresh')], [rule], {
      sites: SITES,
      now: '2026-08-05',
    });

    expect(register.totalAbsorbed).toBeGreaterThan(0);
    expect(register.expired).toEqual([]);
  });
});

describe('what a rule is not allowed to be', () => {
  it('refuses a rule with no reason', () => {
    expect(validateIgnoreRule({ id: 'x', reason: '' }, { hasPlace: true })).toContainEqual(
      expect.stringContaining('needs a reason'),
    );
  });

  it('refuses a band on its own, because that is a tolerance', () => {
    expect(validateIgnoreRule({ id: 'x', reason: 'noisy', bands: ['token'] })).toContainEqual(
      expect.stringContaining('tolerance'),
    );
  });

  it('accepts a rule whose place the caller resolved', () => {
    // A selector needs a DOM, which `core` does not have. The caller says whether
    // one was supplied; the rule about what that buys is still enforced here.
    expect(validateIgnoreRule({ id: 'x', reason: 'clock' }, { hasPlace: true })).toEqual([]);
  });

  it('accepts a band that narrows a shape', () => {
    expect(
      validateIgnoreRule({
        id: 'x',
        reason: 'noisy',
        bands: ['token'],
        fingerprints: ['v1:abc'],
      }),
    ).toEqual([]);
  });

  it('absorbs nothing outside the bands it narrowed to', () => {
    const { register } = applyIgnores(
      [pageWithClock('11:02', 'Refresh')],
      [{ ...CLOCK, bands: ['token'] }],
      { sites: SITES },
    );

    // The clock's change is `content`, not `token`. A rule narrowed to `token`
    // must let it through rather than absorbing the whole site.
    expect(register.totalAbsorbed).toBe(0);
  });
});

describe('path containment', () => {
  it('does not treat a sibling index as a descendant', () => {
    // `startsWith` gets this wrong, silently, in the direction of ignoring more.
    expect(isUnder('0/10', '0/1')).toBe(false);
    expect(isUnder('0/1/0', '0/1')).toBe(true);
    expect(isUnder('0/1', '0/1')).toBe(true);
  });
});

describe('subject patterns', () => {
  it('matches a prefix wildcard without matching everything', () => {
    expect(matchesGlob('story:button--primary', 'story:button--*')).toBe(true);
    expect(matchesGlob('story:card--primary', 'story:button--*')).toBe(false);
  });

  it('treats a pattern with no star as an exact name', () => {
    expect(matchesGlob('story:button', 'story:button')).toBe(true);
    expect(matchesGlob('story:buttonish', 'story:button')).toBe(false);
  });
});

describe('the shape of a pixel difference', () => {
  const mask = (width: number, height: number, set: (x: number, y: number) => boolean): ChangeMask => {
    const data = new Uint8Array(width * height);
    let changed = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!set(x, y)) continue;
        data[y * width + x] = 1;
        changed += 1;
      }
    }
    return { width, height, data, changed };
  };

  const box = (x: number, y: number, width: number, height: number) => ({
    x,
    y,
    width,
    height,
    pixels: width * height,
    density: 1,
  });

  it('is the same shape after it moves', () => {
    // The whole reason this exists rather than a coordinate: a toast that
    // reappears forty pixels lower is the same artifact.
    const top = mask(200, 200, (x, y) => x >= 10 && x < 50 && y >= 10 && y < 30);
    const lower = mask(200, 200, (x, y) => x >= 10 && x < 50 && y >= 90 && y < 110);

    expect(fingerprintOfMask(top, box(10, 10, 40, 20))).toBe(
      fingerprintOfMask(lower, box(10, 90, 40, 20)),
    );
  });

  it('is a different shape when the interior differs', () => {
    const solid = mask(100, 100, (x, y) => x < 40 && y < 40);
    const striped = mask(100, 100, (x, y) => x < 40 && y < 40 && (y % 8 < 4));

    expect(fingerprintOfMask(solid, box(0, 0, 40, 40))).not.toBe(
      fingerprintOfMask(striped, box(0, 0, 40, 40)),
    );
  });

  it('does not collide a wide band with a tall one', () => {
    const wide = mask(200, 200, (x, y) => x < 120 && y < 20);
    const tall = mask(200, 200, (x, y) => x < 20 && y < 120);

    expect(fingerprintOfMask(wide, box(0, 0, 120, 20))).not.toBe(
      fingerprintOfMask(tall, box(0, 0, 20, 120)),
    );
  });

  it('survives a region growing by a pixel', () => {
    // A fingerprint that changed with every sub-pixel reflow would be a
    // coordinate with extra steps.
    const one = mask(200, 200, (x, y) => x >= 5 && x < 85 && y >= 5 && y < 45);
    const two = mask(200, 200, (x, y) => x >= 5 && x < 86 && y >= 5 && y < 45);

    expect(fingerprintOfMask(one, box(5, 5, 80, 40))).toBe(
      fingerprintOfMask(two, box(5, 5, 81, 40)),
    );
  });
});

describe('a run with no ignores', () => {
  it('is untouched, and reads exactly as it did before this existed', () => {
    const diff = pageWithClock('11:02', 'Reload');
    const { diffs, register } = applyIgnores([diff], []);

    expect(diffs[0]).toBe(diff);
    expect(summarizeIgnores(register)).toBe('');
  });
});
