import { describe, expect, it } from 'vitest';
import { applySensitivity, asIgnore, bandsOf, summarizeSensitivity } from './sensitivity.js';
import { validateIgnoreRule } from './ignore.js';
import { diffSnapshots, type SemanticDiff } from '../compare/diff/index.js';
import { normalize } from '../rules/normalize/index.js';
import { CHROMIUM_PROFILE, capture, node } from '../rules/normalize/fixture.js';

/**
 * Route-level assertion, and the line it must not cross.
 *
 * A route test asserts the page still assembles and should never be shown a
 * design-token repaint that reached forty routes. The danger in saying so is that
 * every mechanism for it in this category is a threshold, and a threshold hides
 * whatever is small enough rather than whatever is the declared kind of thing.
 *
 * So the tests come in pairs: what a level absorbs, and — for the same level —
 * the change of the *same magnitude* it must still report. A suite that only
 * checked the first would pass for a rule that silenced the subject.
 */

/**
 * A page with three independent levers, one per band this cares about.
 *
 * Independent on purpose. `padding` looks like the obvious way to move geometry
 * and is not: it is a style *value*, so it produces a `token` delta as well as
 * the rect change, and a test built on it cannot tell which band a level
 * absorbed. A box that only moves, a colour that only repaints, and a state that
 * only a screen reader can hear are three levers that each pull one band.
 */
interface Levers {
  /** `token`: a repaint, nothing moves. */
  readonly colour?: string;
  /** `geometry`: the box moves, nothing is restyled. */
  readonly wide?: boolean;
  /** `a11y`: what is announced changes, nothing repaints and nothing moves. */
  readonly pressed?: boolean;
}

function route(levers: Levers = {}): SemanticDiff {
  const build = (l: Levers) =>
    capture({
      profile: CHROMIUM_PROFILE,
      subjectId: 'route:/dashboard',
      root: node({
        owners: [{ name: 'Page', props: {} }],
        rect: { x: 0, y: 0, width: 400, height: 200 },
        children: [
          node({
            tag: 'button',
            role: 'button',
            name: 'Save',
            text: 'Save',
            state: { pressed: l.pressed === true },
            owners: [{ name: 'Button', props: {} }, { name: 'Page', props: {} }],
            rect: { x: 0, y: 0, width: l.wide === true ? 120 : 80, height: 24 },
            rules: [{ selector: '.b', declare: { color: l.colour ?? '#000000' } }],
          }),
        ],
      }),
    });

  return diffSnapshots(normalize(build({})), normalize(build(levers)));
}

const LAYOUT = {
  id: 'routes',
  reason: 'a route asserts the page assembles, not what it is painted',
  level: 'layout' as const,
};

describe('a route that asserts on layout', () => {
  it('does not report a repaint', () => {
    const { register } = applySensitivity([route({ colour: '#ff0000' })], [LAYOUT]);

    expect(register.totalAbsorbed).toBeGreaterThan(0);
    expect(register.relaxations[0]!.bands).toContain('token');
  });

  it('still reports a box that moved', () => {
    // The control, and the reason this is not a threshold. The geometry change
    // here is small; the repaint above was large. A tolerance would have made the
    // opposite choice on both.
    const { diffs } = applySensitivity([route({ wide: true })], [LAYOUT]);

    expect(diffs[0]!.deltas.length).toBeGreaterThan(0);
    expect(diffs[0]!.deltas.some((delta) => delta.band === 'geometry')).toBe(true);
  });

  it('still reports a control whose announced state changed', () => {
    // The half that gets left out of every "layout only" mode and should not be.
    // `aria-pressed` flipping repaints nothing and moves nothing; the only thing
    // that changed is what a screen reader says, which is the evidence this
    // project collects and no image comparison can.
    //
    // The lever is a state rather than a name deliberately: `matchTrees` pairs
    // nodes by accessible name, so *changing* a name makes the differ report a
    // removal and an addition rather than an `a11y` delta — a real limit, noted
    // where `compareLocales` hit it, and not the thing under test here.
    const { diffs } = applySensitivity([route({ pressed: true })], [LAYOUT]);

    expect(diffs[0]!.deltas.some((delta) => delta.band === 'a11y')).toBe(true);
  });

  it('keeps the geometry when it absorbs the repaint beside it', () => {
    // Both at once, which is the real case: a rebrand lands on a route that also
    // moved. The token half goes; the layout half is reported.
    const { diffs, register } = applySensitivity(
      [route({ colour: '#ff0000', wide: true })],
      [LAYOUT],
    );

    expect(register.totalAbsorbed).toBeGreaterThan(0);
    expect(diffs[0]!.deltas.some((delta) => delta.band === 'geometry')).toBe(true);
    expect(diffs[0]!.deltas.some((delta) => delta.band === 'token')).toBe(false);
  });
});

describe('the register', () => {
  it('names a rule that absorbed nothing', () => {
    // A route declared `layout` that nothing has ever restyled is a declaration
    // nobody needed, and it reads as protection until somebody counts.
    const { register } = applySensitivity([route({ wide: true })], [LAYOUT]);

    expect(register.dead).toEqual(['routes']);
    expect(summarizeSensitivity(register).join('\n')).toContain('absorbed nothing');
  });

  it('states what it absorbed in the words the operator wrote', () => {
    const { register } = applySensitivity([route({ colour: '#ff0000' })], [LAYOUT]);

    expect(summarizeSensitivity(register).join('\n')).toContain('asserts on layout');
  });
});

describe('what a level is', () => {
  it('asserts on everything under `strict`, and produces no rule', () => {
    expect(bandsOf('strict')).toContain('texture');
    // No ignore at all, rather than one absorbing nothing: a permanently-dead
    // register line telling an operator to delete their explicit default is the
    // one thing worse than no line.
    expect(asIgnore({ id: 'x', reason: 'default', level: 'strict' })).toBeNull();
  });

  it('carries a11y into every level', () => {
    // A level that dropped it would let a route go green while a control lost
    // its name, which is the evidence this project has and pixel tools do not.
    expect(bandsOf('layout')).toContain('a11y');
    expect(bandsOf('content')).toContain('a11y');
  });

  it('translates to an ignore whose place is the whole subject, said explicitly', () => {
    const ignore = asIgnore({ id: 'routes', reason: 'r', level: 'layout' })!;

    expect(ignore.whole).toBe(true);
    expect(ignore.bands).toEqual(['token', 'content', 'texture']);
    // And it passes the check that refuses a band-only ignore, because it now
    // names a place rather than omitting one.
    expect(validateIgnoreRule(ignore)).toEqual([]);
  });

  it('still refuses a hand-written rule that is only a band', () => {
    // The property the whole translation rests on. `whole` is what makes a
    // sensitivity legal, and it is not reachable from a config file.
    expect(validateIgnoreRule({ id: 'x', reason: 'noisy', bands: ['token'] })).toContainEqual(
      expect.stringContaining('tolerance'),
    );
  });

  it('refuses a whole-subject rule that narrows nothing', () => {
    // That is not an ignore, it is switching the subject off — and there is a
    // word for that which a reader cannot mistake.
    expect(validateIgnoreRule({ id: 'x', reason: 'noisy', whole: true })).toContainEqual(
      expect.stringContaining('silences it entirely'),
    );
  });
});
