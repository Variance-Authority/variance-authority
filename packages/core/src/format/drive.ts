import type {
  DriverTarget,
  Intervention,
  MotionPreference,
  PageFocusable,
  PageGlobals,
} from './intervention.js';

/**
 * The tricks a stylesheet cannot reach, and the one call each makes of a driver.
 *
 * Every other trick in [`stabilize.ts`](./stabilize.ts) is CSS, a screenshot
 * option or a script the page runs on itself. Three causes of a page that reads
 * two ways sit outside the document:
 *
 * - **the motion preference** — a page that honours `prefers-reduced-motion`
 *   runs its script animation only when the browser says motion is welcome, and
 *   a stylesheet cannot reach a `requestAnimationFrame` loop;
 * - **the clock** — a page that prints `new Date()` prints a new value every
 *   run, and the date is read by the page's first script, before any stylesheet
 *   or settle step exists, so it is replaced by a script the browser runs before
 *   the page's own;
 * - **the pointer** — a hover ends when the pointer leaves, and nothing in the
 *   page can move it.
 *
 * So each is declared as a {@link DriverState} and applied here, through the
 * structural {@link DriverTarget} a Playwright `Page` already is. A host that
 * owns the browser calls {@link driveBeforeLoad} before its first navigation
 * and hands the page the ids it applied. A host that shares the page with
 * somebody who moves the pointer, such as a test, also calls
 * {@link driveBeforeRead} before each subject is read. A host that does not — a page agent, a test runner's own
 * browser — drives nothing, and {@link forDriver} keeps those tricks out of its
 * recorded recipe, so the absence shows in the reading's ids and digest the way
 * a trick filtered by `needs` does.
 */

/**
 * The instant a fixed clock reads unless a project names another.
 *
 * Noon UTC, so it is the same calendar date in every zone from UTC−11 to
 * UTC+11: a page that prints today's date prints one date whichever zone the
 * browser runs in. A date in the past, so a page that compares against "now"
 * to show something as expired does so on every run or on none.
 */
export const DEFAULT_NOW = '2024-06-15T12:00:00.000Z';

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * The milliseconds an ISO 8601 instant names, or an error that says what an
 * instant is.
 *
 * The zone is required. `2024-06-15T12:00` with no zone is read in whatever
 * zone the machine runs in, so two machines would fix two clocks — the
 * variance this trick exists to remove.
 */
export function instantOf(now: string): number {
  const time = INSTANT.test(now) ? Date.parse(now) : Number.NaN;
  if (Number.isNaN(time)) {
    throw new Error(
      '`now` must be an ISO 8601 instant with its zone, such as "2024-06-15T12:00:00Z" or ' +
        `"2024-06-15T14:00:00+02:00", not ${JSON.stringify(now)}`,
    );
  }
  return time;
}

/**
 * `prefers-reduced-motion: reduce`, the switch a well-built page already reads.
 *
 * It reaches what `pin-animations` cannot: a script animation, which a
 * stylesheet has no handle on. It reaches only a page that honours the
 * preference, and that is the cost: the page is read as a user who asked for
 * less motion sees it, which can differ from what everybody else sees.
 */
export const reducedMotion: Intervention = {
  id: 'reduced-motion',
  trick: 'reset',
  needs: 'layout',
  governs: 'motion-preference',
  because: 'the browser reports prefers-reduced-motion: reduce, so a page that honours it stops its script animations',
  driver: { reducedMotion: 'reduce' },
};

const CLOCK_ID = 'freeze-clock';

/**
 * `Date` reads one instant; timers, animation frames and `performance` keep
 * running.
 *
 * An init script, {@link freezeDate}, run in every frame before the page's own
 * first script. It replaces `Date` and nothing else, because the thing that
 * prints two ways is the date a page shows, and the things that make a page
 * settle are timers and frames. Playwright's `clock.setFixedTime` was measured
 * against it and rejected: it installs a fake for `setTimeout`,
 * `requestAnimationFrame` and `performance.now` as well, and a frame's
 * timestamp no longer agrees with `document.timeline`, which drives every CSS
 * and Web Animations frame. Installing no clock also leaves `page.clock` to the
 * test that wants one.
 *
 * The id carries the instant when it is not {@link DEFAULT_NOW}, as
 * `freeze-clock@2031-01-02T03:04:05.000Z`, so the instant is in the recipe's
 * digest and so in the environment key: a baseline read at one instant is
 * `incomparable` with a run read at another, rather than `changed`.
 *
 * The cost: code that measures elapsed time with `Date.now()`, such as a
 * debounce, sees no time pass and never fires. `performance.now()` keeps
 * counting.
 */
export function freezeClockAt(now: string): Intervention {
  const at = instantOf(now);
  return {
    id: at === instantOf(DEFAULT_NOW) ? CLOCK_ID : `${CLOCK_ID}@${new Date(at).toISOString()}`,
    trick: 'hold',
    needs: 'layout',
    governs: 'clock',
    because: 'Date reads one fixed instant, so elapsed time measured with Date.now() reads zero',
    driver: { clock: { at } },
  };
}

/** {@link freezeClockAt} the default instant, {@link DEFAULT_NOW}. */
export const freezeClock: Intervention = freezeClockAt(DEFAULT_NOW);

/**
 * The clock trick a `freeze-clock@<instant>` id names, or undefined for any
 * other id.
 *
 * The registry holds `freeze-clock` alone; an id with an instant in it is
 * resolved here, so a recipe that crossed into a page as ids keeps its instant.
 */
export function clockById(id: string): Intervention | undefined {
  return id.startsWith(`${CLOCK_ID}@`) ? freezeClockAt(id.slice(CLOCK_ID.length + 1)) : undefined;
}

/**
 * The init script {@link freezeClock} installs: `Date` answers `frozen`, and
 * nothing else changes.
 *
 * Runs in the page, so it closes over nothing. `new Date()`, `Date()` and
 * `Date.now()` read the instant; `new Date(value)`, `Date.UTC`, `Date.parse`
 * and every method on a date are the browser's own. `Intl.DateTimeFormat`'s
 * `format()` and `formatToParts()` with no date read the browser's clock rather
 * than `Date`, so they are given the instant too.
 */
export function freezeDate(frozen: number): void {
  // TODO: `Temporal.Now` and a worker's `Date` read the real clock. This runs
  // in each frame's window and replaces `Date` alone, so a page that prints a
  // date from either prints a second reading.
  const Real = Date;
  function Frozen(...args: unknown[]): unknown {
    if (new.target === undefined) return new Real(frozen).toString();
    return Reflect.construct(Real, args.length === 0 ? [frozen] : args, new.target);
  }
  Object.setPrototypeOf(Frozen, Real);
  Object.defineProperties(Frozen, {
    prototype: { value: Real.prototype },
    name: { value: 'Date' },
    length: { value: 7 },
    now: { value: () => frozen, writable: true, configurable: true },
  });
  Object.defineProperty(Real.prototype, 'constructor', { value: Frozen, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'Date', { value: Frozen, writable: true, configurable: true });

  const format = Intl.DateTimeFormat.prototype;
  const formatting = Object.getOwnPropertyDescriptor(format, 'format')?.get;
  if (formatting !== undefined) {
    Object.defineProperty(format, 'format', {
      configurable: true,
      get(this: Intl.DateTimeFormat) {
        const bound = formatting.call(this) as (date?: Date | number) => string;
        return (date?: Date | number) => bound(date === undefined ? frozen : date);
      },
    });
  }
  const toParts = format.formatToParts;
  Object.defineProperty(format, 'formatToParts', {
    configurable: true,
    writable: true,
    value(this: Intl.DateTimeFormat, date?: Date | number) {
      return toParts.call(this, date === undefined ? frozen : date);
    },
  });
}

/**
 * The pointer moved off the page, so nothing is hovered.
 *
 * To `(-1, -1)` rather than to the page's corner: content at the top left is
 * under `(0, 0)` and stays hovered there. `pointer-events: none` is not a
 * substitute — measured, an element already hovered keeps `:hover` under it.
 *
 * Once per page, before load, where nothing but the host moves the pointer. A
 * move is acknowledged on the next frame, ~14 ms measured, so a host that alone
 * drives its page does not move it again. A host that shares the page with a
 * test does, before every reading: see {@link driveBeforeRead}.
 */
export const noHover: Intervention = {
  id: 'no-hover',
  trick: 'reset',
  needs: 'layout',
  governs: 'pointer',
  because: 'the pointer moved off the page, so a hover a test left behind is not read',
  driver: { pointer: 'outside' },
};

/**
 * Nothing focused, so a field a test filled or a page focused on load reads
 * as it does untouched.
 *
 * A settle step rather than a stylesheet: `:focus` and `:focus-visible` follow
 * the element that holds focus, and no rule can unmatch them. It blurs the
 * deepest focused element, walking through shadow roots, because a shadow host
 * is the document's `activeElement` for whatever its tree focused, and blurring
 * the host leaves the input inside it focused and outlined.
 *
 * The cost: a page evaluate per subject, and an animation frame as well when
 * the document holds an `[autofocus]`. A host that reads a page somebody goes
 * on using — a test, an agent's browser — gives focus back once the reading
 * is taken; a host that owns its page does not need to.
 */
export const noFocus: Intervention = {
  id: 'no-focus',
  trick: 'reset',
  needs: 'layout',
  governs: 'focus',
  because: 'focus released, so a field a test or the page focused is read unfocused',
  // Again in a frame callback when the document holds an `autofocus`, because
  // the browser honours one at the page's next rendering update: a blur before
  // it is undone, and a document written by `setContent` has had no update yet.
  // Only then, so a page without one pays no frame per subject.
  settle: async (target) => {
    await target.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const view = globalThis as unknown as PageGlobals;
          const release = (): void => {
            let focused: PageFocusable | null | undefined = view.document.activeElement;
            while (focused?.shadowRoot?.activeElement != null) focused = focused.shadowRoot.activeElement;
            focused?.blur?.();
          };
          release();
          if (view.document.querySelector('[autofocus]') === null) return resolve();
          view.requestAnimationFrame(() => {
            release();
            resolve();
          });
        }),
    );
  },
};

/**
 * The tricks that put a page into the state nobody is touching, in every
 * default collection recipe whose tier can see them.
 *
 * A hover, a focus, a script animation and a printed date are each a second
 * reading of one subject, and each comes from something other than the code
 * under review. Three of them reach the page only through a driver, so a host
 * that cannot drive one leaves it out of the ids it records — see {@link forDriver}.
 */
export const UNTOUCHED: readonly Intervention[] = [noHover, noFocus, reducedMotion, freezeClock];

const MOTION = 'prefers-reduced-motion';

/**
 * The media features a recipe's driver tricks make the browser report, merged
 * under the ones a project declared, or undefined when there are none.
 *
 * Collection resolves `@media` against declared features, not against the
 * browser, so a preference the driver emulated and nobody declared would be
 * read as unknown: both the `reduce` and the `no-preference` block applied, a
 * box the browser never drew. Declaring what the trick emulates gives the
 * preference one owner. A project's own value wins, and
 * {@link driveBeforeLoad} emulates that value, so the two still agree.
 */
export function featuresOf(
  recipe: readonly Intervention[],
  declared?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> | undefined {
  const motion = recipe.find((intervention) => intervention.driver?.reducedMotion !== undefined);
  const features = {
    ...(motion === undefined ? {} : { [MOTION]: motion.driver!.reducedMotion! }),
    ...declared,
  };
  return Object.keys(features).length === 0 ? undefined : features;
}

/**
 * Apply what a recipe asks of the browser before the page loads.
 *
 * All three survive navigation, so a host calls this once per page, before its
 * first `goto` or `setContent`. Returns the ids applied, in recipe order. The
 * clock's instant is the trick's own, so a host that wants another instant
 * asks `recipeToDrive` for the recipe rather than telling this.
 *
 * `declared` is the media features the project declared. A declared
 * `prefers-reduced-motion` is what the motion trick emulates, so the browser
 * reports what the record says; see {@link featuresOf}.
 */
export async function driveBeforeLoad(
  recipe: readonly Intervention[],
  target: DriverTarget,
  declared?: Readonly<Record<string, string>>,
): Promise<readonly string[]> {
  const applied: string[] = [];
  for (const intervention of recipe) {
    const driver = intervention.driver;
    if (driver?.pointer === 'outside') {
      await target.mouse.move(-1, -1);
      applied.push(intervention.id);
    } else if (driver?.reducedMotion !== undefined) {
      const preference = motionOf(declared?.[MOTION] ?? driver.reducedMotion);
      await target.emulateMedia({ reducedMotion: preference });
      // A declared `no-preference` is emulated and recorded among the features;
      // the trick's id would claim a reduced motion the page never had.
      if (preference === driver.reducedMotion) applied.push(intervention.id);
    } else if (driver?.clock !== undefined) {
      await target.addInitScript(freezeDate, driver.clock.at);
      applied.push(intervention.id);
    }
  }
  return applied;
}

function motionOf(value: string): MotionPreference {
  if (value === 'reduce' || value === 'no-preference') return value;
  throw new Error(
    `\`${MOTION}\` is declared as ${JSON.stringify(value)}, which no browser reports; ` +
      'declare "reduce" or "no-preference"',
  );
}

/**
 * Take the pointer off the page again before a subject is read.
 *
 * For a host that shares the page: a test hovers a menu to open it and then
 * observes, so the pointer is wherever the test's last step left it. A host
 * that alone drives its page needs only {@link driveBeforeLoad}.
 *
 * Every reading pays the frame, hovered or not: measured in Chromium, a
 * Playwright hover restyles the element while `:hover` matches nothing from
 * script, so the page cannot say whether the move is needed. The pointer is
 * not put back afterwards, and the move fires `mouseleave`: a menu a script
 * opened on hover is closed for the test's next step.
 */
export async function driveBeforeRead(
  recipe: readonly Intervention[],
  target: Pick<DriverTarget, 'mouse'>,
): Promise<readonly string[]> {
  const applied: string[] = [];
  for (const intervention of recipe) {
    if (intervention.driver?.pointer === 'outside') {
      await target.mouse.move(-1, -1);
      applied.push(intervention.id);
    }
  }
  return applied;
}

/**
 * The recipe as it holds on a page, given the driver tricks a host applied.
 *
 * A trick with no `driver` is kept. A trick with one is kept only when its id
 * is in `driven`: a host that could not drive it leaves it out of the ids and
 * the digest it records, rather than claiming a hold the page never had. The
 * clock is the one trick whose id the driver may change, because the instant is
 * the host's to choose: the recipe's clock is recorded as the one the host
 * fixed.
 */
export function forDriver(
  recipe: readonly Intervention[],
  driven: readonly string[],
): readonly Intervention[] {
  const fixed = driven.map((id) => (id === freezeClock.id ? freezeClock : clockById(id))).find(Boolean);
  return recipe.flatMap((intervention) => {
    if (intervention.driver === undefined || driven.includes(intervention.id)) return [intervention];
    return intervention.driver.clock !== undefined && fixed !== undefined ? [fixed] : [];
  });
}
