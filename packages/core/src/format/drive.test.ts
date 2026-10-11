import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  clockById,
  DEFAULT_NOW,
  driveBeforeLoad,
  driveBeforeRead,
  featuresOf,
  forDriver,
  freezeClock,
  freezeClockAt,
  freezeDate,
  instantOf,
  noFocus,
  noHover,
  reducedMotion,
  type DriverTarget,
} from './drive.js';
import { environmentKey, type EnvironmentInputs } from './environment.js';
import { COLLECT_RECIPE, hideScrollbars, interventionById, recipeDigest, recipeToDrive } from './stabilize.js';

/**
 * The tricks a stylesheet cannot reach, and the browser driver can.
 *
 * Hover, the motion preference and the clock belong to the browser rather than
 * the document, so they are asked of whatever drives it. What is pinned here is
 * the half that does not need a browser: which calls a recipe makes of a driver,
 * when, with what instant, and that a host with no driver records the trick as
 * absent rather than applied.
 */

interface Recorded {
  readonly calls: string[];
  readonly target: DriverTarget;
}

const recording = (): Recorded => {
  const calls: string[] = [];
  return {
    calls,
    target: {
      emulateMedia: async (options) => {
        calls.push(`emulateMedia ${JSON.stringify(options)}`);
      },
      addInitScript: async (script, frozen) => {
        calls.push(`addInitScript ${script.name} ${new Date(frozen).toISOString()}`);
      },
      mouse: {
        move: async (x, y) => {
          calls.push(`mouse.move ${x},${y}`);
        },
      },
    },
  };
};

describe('before the page loads', () => {
  it('takes the pointer off the page, asks for reduced motion and a fixed Date, and names what it asked for', async () => {
    // The pointer once per page rather than once per reading: a move is
    // acknowledged on the next frame, ~14 ms measured, and inside a collector
    // nothing but the host moves it.
    const { calls, target } = recording();

    const driven = await driveBeforeLoad(COLLECT_RECIPE, target);

    expect(calls).toEqual([
      'mouse.move -1,-1',
      'emulateMedia {"reducedMotion":"reduce"}',
      `addInitScript freezeDate ${DEFAULT_NOW}`,
    ]);
    expect(driven).toEqual(['no-hover', 'reduced-motion', 'freeze-clock']);
  });

  it('fixes Date at the instant the caller chose, and names the instant it fixed', async () => {
    const { calls, target } = recording();

    const driven = await driveBeforeLoad(recipeToDrive({ now: '2031-01-02T03:04:05+02:00' }), target);

    expect(calls).toContain('addInitScript freezeDate 2031-01-02T01:04:05.000Z');
    expect(driven).toContain('freeze-clock@2031-01-02T01:04:05.000Z');
  });

  it('emulates the motion preference a project declared, and records no reduced motion it did not apply', async () => {
    const { calls, target } = recording();

    const driven = await driveBeforeLoad([reducedMotion], target, { 'prefers-reduced-motion': 'no-preference' });

    expect(calls).toEqual(['emulateMedia {"reducedMotion":"no-preference"}']);
    expect(driven).toEqual([]);
  });

  it('records reduced motion when the project declares the value the trick would set', async () => {
    const { target } = recording();

    expect(await driveBeforeLoad([reducedMotion], target, { 'prefers-reduced-motion': 'reduce' })).toEqual([
      'reduced-motion',
    ]);
  });

  it('refuses a declared motion preference no browser reports', async () => {
    const { target } = recording();

    await expect(driveBeforeLoad([reducedMotion], target, { 'prefers-reduced-motion': 'slow' })).rejects.toThrow(
      /declare "reduce" or "no-preference"/,
    );
  });

  it('touches nothing for a recipe that asks nothing of the driver', async () => {
    const { calls, target } = recording();

    expect(await driveBeforeLoad([hideScrollbars, noFocus], target)).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('before the subject is read, on a page somebody else drives', () => {
  it('takes the pointer off the page again', async () => {
    // Off it rather than to its corner: content at the top-left is under
    // (0, 0) and stays hovered there.
    const { calls, target } = recording();

    expect(await driveBeforeRead(COLLECT_RECIPE, target)).toEqual(['no-hover']);
    expect(calls).toEqual(['mouse.move -1,-1']);
  });

  it('leaves the pointer where it is when the recipe does not hold it', async () => {
    const { calls, target } = recording();

    expect(await driveBeforeRead([reducedMotion], target)).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('the media features a recipe makes the browser report', () => {
  it('declares the motion preference the recipe emulates', () => {
    expect(featuresOf(COLLECT_RECIPE)).toEqual({ 'prefers-reduced-motion': 'reduce' });
  });

  it('lets a project declare its own, which the driver then emulates', () => {
    expect(featuresOf([reducedMotion], { 'prefers-reduced-motion': 'no-preference', 'forced-colors': 'none' })).toEqual({
      'prefers-reduced-motion': 'no-preference',
      'forced-colors': 'none',
    });
  });

  it('declares nothing for a recipe the driver did not hold', () => {
    expect(featuresOf(forDriver(COLLECT_RECIPE, []))).toBeUndefined();
  });
});

describe('a host with no driver', () => {
  it('records the driver tricks as absent rather than applied', () => {
    // The page agent cannot emulate a media feature or move a pointer. Keeping
    // a trick nobody drove in the recorded ids would put it in the digest and
    // claim a hold the page never had.
    const kept = forDriver([hideScrollbars, noHover, noFocus, reducedMotion, freezeClock], []);

    expect(kept).toEqual([hideScrollbars, noFocus]);
  });

  it('keeps the ones a driver says it applied', () => {
    expect(forDriver([noHover, reducedMotion, freezeClock], ['no-hover', 'freeze-clock'])).toEqual([
      noHover,
      freezeClock,
    ]);
  });

  it('records the clock the driver fixed, when it chose another instant', () => {
    // The page names `freeze-clock`; the host fixed 2031. The recorded id is
    // the host's, so the digest says which instant the page was read at.
    const fixed = freezeClockAt('2031-01-02T01:04:05Z');

    expect(forDriver([hideScrollbars, freezeClock], [fixed.id]).map((i) => i.id)).toEqual([
      'hide-scrollbars',
      'freeze-clock@2031-01-02T01:04:05.000Z',
    ]);
  });
});

describe('the instant a fixed clock reads', () => {
  it('reads the documented default', () => {
    expect(instantOf(DEFAULT_NOW)).toBe(Date.UTC(2024, 5, 15, 12));
  });

  it('accepts an instant with its zone written down', () => {
    expect(instantOf('2024-06-15T12:00:00+10:00')).toBe(Date.UTC(2024, 5, 15, 2));
  });

  it.each(['2024-06-15T12:00', '2024-06-15', 'yesterday', ''])(
    'refuses %j, which names no single instant',
    (now) => {
      // A local time with no zone is a different instant on every machine,
      // which is the variance this trick exists to remove.
      expect(() => instantOf(now)).toThrow(/`now` must be an ISO 8601 instant/);
    },
  );
});

describe('the recipe a host drives', () => {
  it('is the collection recipe when the caller named none', () => {
    expect(recipeToDrive({})).toBe(COLLECT_RECIPE);
  });

  it('is what the caller named, by id', () => {
    expect(recipeToDrive({ stabilize: ['no-hover', 'hide-scrollbars'] })).toEqual([noHover, hideScrollbars]);
  });

  it('refuses an instant with no zone before a browser is opened', () => {
    // Checked here although only `freeze-clock` reads it: a collector that
    // waits for the first page to say so has already paid for a browser.
    expect(() => recipeToDrive({ now: '2024-06-15T12:00' })).toThrow(/`now` must be an ISO 8601 instant/);
  });

  it('refuses an instant for a recipe that fixes no clock', () => {
    expect(() => recipeToDrive({ stabilize: ['no-hover'], now: DEFAULT_NOW })).toThrow(/no `freeze-clock`/);
  });
});

describe('the instant, as part of what a reading is keyed by', () => {
  const inputs = (now?: string): EnvironmentInputs => ({
    profile: 'route',
    engine: 'chromium@140',
    ruleset: 'r1',
    allowlist: 'a1',
    viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
    fonts: [],
    conditions: {},
    assets: {},
    stabilization: recipeDigest(recipeToDrive(now === undefined ? {} : { now })),
  });

  it('keys two instants apart, so a run read at one names the instant as the cause against a baseline read at the other', () => {
    const at2024 = environmentKey(inputs());
    const at2031 = environmentKey(inputs('2031-01-02T03:04:05Z'));

    expect(at2031.digest).not.toBe(at2024.digest);
    expect(at2031.semanticDigest).not.toBe(at2024.semanticDigest);
  });

  it('keys the default instant, named or not, as one', () => {
    expect(environmentKey(inputs(DEFAULT_NOW)).digest).toBe(environmentKey(inputs()).digest);
  });

  it('resolves an id with an instant in it, as a page receives it', () => {
    expect(interventionById('freeze-clock@2031-01-02T01:04:05.000Z')).toEqual(
      freezeClockAt('2031-01-02T01:04:05Z'),
    );
    expect(clockById('freeze-clock')).toBeUndefined();
    expect(clockById('no-hover')).toBeUndefined();
  });
});

describe('Date, frozen', () => {
  const FROZEN = Date.UTC(2024, 5, 15, 12);

  // A context of its own, because the script replaces the global `Date` of
  // whatever realm it runs in.
  const frozenRealm = (probe: string): unknown =>
    runInNewContext(`(${freezeDate.toString()})(${FROZEN}); (${probe})()`, {});

  it('reads the instant from `new Date()`, `Date.now()` and `Date()`', () => {
    expect(
      frozenRealm(`() => [new Date().getTime(), Date.now(), Date() === new Date(${FROZEN}).toString()]`),
    ).toEqual([FROZEN, FROZEN, true]);
  });

  it('leaves a date the page names, and every method on one, alone', () => {
    expect(
      frozenRealm(
        `() => [new Date(0).getTime(), new Date(2020, 0, 1).getFullYear(), Date.UTC(2020, 0, 1), Date.parse('2020-01-01T00:00:00Z')]`,
      ),
    ).toEqual([0, 2020, Date.UTC(2020, 0, 1), Date.UTC(2020, 0, 1)]);
  });

  it('keeps `instanceof`, `constructor` and a subclass working', () => {
    expect(
      frozenRealm(
        `() => { class Day extends Date {} const day = new Day(); return [new Date() instanceof Date, new Date().constructor === Date, day instanceof Date, day.getTime(), Date.name, Date.length]; }`,
      ),
    ).toEqual([true, true, true, FROZEN, 'Date', 7]);
  });

  it('formats the instant when Intl is asked for today', () => {
    expect(
      frozenRealm(
        `() => { const f = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'UTC' }); return [f.format() === f.format(${FROZEN}), JSON.stringify(f.formatToParts()) === JSON.stringify(f.formatToParts(${FROZEN})), f.format(0) === f.format(new Date(0))]; }`,
      ),
    ).toEqual([true, true, true]);
  });
});

describe('no element holding focus', () => {
  interface Focusable {
    readonly name: string;
    readonly shadowRoot?: { readonly activeElement: Focusable | null } | null;
    blur(): void;
  }

  const blurred: string[] = [];
  const focusable = (name: string, inner?: Focusable): Focusable => ({
    name,
    shadowRoot: inner === undefined ? null : { activeElement: inner },
    blur: () => {
      blurred.push(name);
    },
  });

  let frames = 0;
  const settleWith = async (activeElement: Focusable | null, autofocus = false): Promise<void> => {
    const previous = Reflect.get(globalThis, 'document');
    const frame = Reflect.get(globalThis, 'requestAnimationFrame');
    frames = 0;
    Reflect.set(globalThis, 'document', {
      activeElement,
      querySelector: (selectors: string) => (autofocus && selectors === '[autofocus]' ? {} : null),
    });
    Reflect.set(globalThis, 'requestAnimationFrame', (callback: () => void) => {
      frames += 1;
      return setTimeout(callback, 0);
    });
    try {
      await noFocus.settle?.({ evaluate: async (fn) => fn() });
    } finally {
      Reflect.set(globalThis, 'document', previous);
      Reflect.set(globalThis, 'requestAnimationFrame', frame);
    }
  };

  it('blurs the element inside a shadow root, not its host', async () => {
    // A host is `activeElement` for whatever its shadow tree focused. Blurring
    // the host leaves the input inside it focused and styled.
    blurred.length = 0;
    await settleWith(focusable('host', focusable('input')));

    expect(blurred).toEqual(['input']);
  });

  it('does nothing on a page where nothing is focused', async () => {
    await expect(settleWith(null)).resolves.toBeUndefined();
  });

  it('waits a frame only for a document holding an `autofocus`, and blurs again after it', async () => {
    // The browser honours an `autofocus` at the next rendering update, so a
    // blur before it is undone. A page without one pays no frame per subject.
    blurred.length = 0;
    await settleWith(focusable('field'));
    expect({ blurred: [...blurred], frames }).toEqual({ blurred: ['field'], frames: 0 });

    blurred.length = 0;
    await settleWith(focusable('field'), true);
    expect({ blurred: [...blurred], frames }).toEqual({ blurred: ['field', 'field'], frames: 1 });
  });
});
