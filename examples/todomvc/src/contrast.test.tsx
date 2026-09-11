// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { componentInstances, type ComponentInstance } from '@variance-authority/core/attribute';
import { JSDOM_PROFILE, type Viewport } from '@variance-authority/core/format';
import { normalize } from '@variance-authority/core/rules';
import { collect } from '@variance-authority/dom';
import { portalContentOf, provenanceOf } from '@variance-authority/react';
import type { ReactNode } from 'react';
import { Button, Chip, Text, Toggle } from './ds/components.js';
import { DS_CSS } from './ds/styles.js';
import { TOKENS_CSS } from './tokens/foundation.js';

/**
 * What a prop controls, measured rather than documented.
 *
 * A visual-regression suite is normally read down one axis: this subject, this
 * revision, against its baseline. `composition.test.tsx` reads a second axis —
 * many subjects, one revision, joined on shared components. This is a third, and
 * it runs *inside* one component:
 *
 * > Render the same component twice, varying exactly one prop. Whatever moved is
 * > what that prop controls.
 *
 * The answer comes out in the four bands the rest of the system already speaks —
 * `structure`, `semantics`, `text`, `style` — so it composes with everything
 * that consumes them. A sensitivity level that absorbs `style` can be told, from
 * this table, which props it has stopped watching.
 *
 * ## Why it is worth having
 *
 * `docs/composition.md` ends its ladder at `unexplained`: no edited file, no
 * moved token, no edited caller, no contradiction. What it cannot ask is the
 * next question a person asks, which is *could anything this component was
 * passed have done this?* A `Chip` that moved in `style` when nothing in the
 * change set touches the one prop of `Chip` that controls `style` is a much
 * stronger claim than an unexplained movement, and it costs no collection —
 * this table is a fold over instances a run already has.
 *
 * ## What it is not, yet
 *
 * The join here is supplied by the test, and that is the whole gap. A
 * `ComponentInstance` carries `props` as a single digest, and `instances.ts`
 * says so in as many words: *which* prop differed is not recoverable. So the
 * measurement below proves the inference is sound and available; carrying it
 * into a run needs a per-key digest, which is
 * [spec 0024](../../../docs/specs/0024-what-a-prop-controls.md).
 *
 * ## What the profile can and cannot see
 *
 * Two limits, both of the profile rather than of the method, and both asserted
 * below so that an absence is never read as a measurement:
 *
 * - **No layout.** `geometry` is undefined on every instance here, so a prop
 *   that moves only a box reads as controlling nothing.
 * - **Declared style only.** `style` is the author rules matched to the element,
 *   never the user-agent cascade. `Text.as` swapping a `<span>` for an `<h1>`
 *   therefore moves no `style` under jsdom and would move it under Chromium.
 *
 * Both limits are one-directional — they lose rows, never invent them — so every
 * band named in the table is a band that really moved.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWPORT: Viewport = { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' };

/** The bands a contrast can move. `rendering` is their join and not a band. */
const BANDS = ['structure', 'semantics', 'text', 'style'] as const;
type Band = (typeof BANDS)[number];

interface Contrast {
  readonly component: string;
  /** The single prop that differs between the two renderings. */
  readonly prop: string;
  readonly held: ReactNode;
  readonly varied: ReactNode;
}

/**
 * One prop varied per row, everything else held.
 *
 * Held is doing real work: a contrast where two props move at once measures the
 * union and attributes it to whichever one the reader happens to name, which is
 * the same error as attributing a page's diff to whichever component is largest.
 */
const CONTRASTS: readonly Contrast[] = [
  {
    component: 'Chip',
    prop: 'selected',
    held: <Chip label="All" />,
    varied: <Chip label="All" selected />,
  },
  {
    component: 'Chip',
    prop: 'label',
    held: <Chip label="All" />,
    varied: <Chip label="Active" />,
  },
  {
    component: 'Text',
    prop: 'tone',
    held: <Text>seven left</Text>,
    varied: <Text tone="muted">seven left</Text>,
  },
  {
    component: 'Text',
    prop: 'size',
    held: <Text>seven left</Text>,
    varied: <Text size="lg">seven left</Text>,
  },
  {
    component: 'Text',
    prop: 'as',
    held: <Text>seven left</Text>,
    varied: <Text as="h1">seven left</Text>,
  },
  {
    component: 'Button',
    prop: 'variant',
    held: <Button label="Clear" />,
    varied: <Button label="Clear" variant="danger" />,
  },
  {
    component: 'Toggle',
    prop: 'checked',
    held: <Toggle id="t" label="Buy milk" checked={false} />,
    varied: <Toggle id="t" label="Buy milk" checked />,
  },
];

function instanceOf(element: ReactNode, component: string): ComponentInstance {
  document.head.innerHTML = '';
  document.body.innerHTML = '';

  for (const [name, css] of [
    ['tokens', TOKENS_CSS],
    ['design-system', DS_CSS],
  ] as const) {
    const sheet = document.createElement('style');
    sheet.setAttribute('data-contrast-sheet', name);
    sheet.textContent = css;
    document.head.appendChild(sheet);
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    act(() => root.render(element as never));

    const snapshot = normalize(
      collect(container, {
        // One subject id for every rendering on purpose: a contrast is not two
        // subjects, and giving them different ids would invite a comparison
        // that has nothing to do with this measurement.
        subject: { id: 'contrast', kind: 'story' },
        viewport: VIEWPORT,
        engine: 'jsdom@contrast',
        fonts: ['system/400/normal/contrast'],
        provenanceOf,
        portalsOf: portalContentOf,
      }),
    );

    const found = componentInstances(snapshot).find(
      (instance) => instance.component === component,
    );
    if (!found) throw new Error(`no boundary for ${component}`);
    return found;
  } finally {
    act(() => root.render(null));
    container.remove();
  }
}

/** Which bands moved between two renderings of one component. */
function bandsThatMoved(held: ComponentInstance, varied: ComponentInstance): Band[] {
  return BANDS.filter((band) => held[band] !== varied[band]);
}

const MEASURED = CONTRASTS.map((contrast) => ({
  contrast,
  held: instanceOf(contrast.held, contrast.component),
  varied: instanceOf(contrast.varied, contrast.component),
}));

describe('what one prop controls', () => {
  it.each(
    MEASURED.map((row) => ({
      name: `${row.contrast.component}.${row.contrast.prop}`,
      ...row,
    })),
  )('$name moves something, and the run can see that the input moved', (row) => {
    // Both halves. A prop that moves nothing is either dead or absorbed
    // somewhere, and a contrast whose *inputs* read as equal is not a contrast
    // at all — it would silently measure two identical renderings and report
    // that the prop controls nothing.
    expect(row.held.props).not.toBe(row.varied.props);
    expect(bandsThatMoved(row.held, row.varied).length).toBeGreaterThan(0);
  });

  /**
   * The table this whole file exists to produce.
   *
   * Asserted as one object rather than seven cases, because the *shape* is the
   * finding and it is only legible side by side: seven props of one small design
   * system reach five distinct sets of bands, from one band to three, and the
   * grouping does not follow how different the two renderings look.
   *
   * Three rows came out wider than the obvious prediction — `Chip.label`,
   * `Text.as`, `Toggle.checked` — which is the argument for measuring this per
   * component instead of writing it down once.
   */
  it('separates the bands each prop reaches', () => {
    const controls = Object.fromEntries(
      MEASURED.map((row) => [
        `${row.contrast.component}.${row.contrast.prop}`,
        bandsThatMoved(row.held, row.varied),
      ]),
    );

    expect(controls).toEqual({
      // A class *and* an `aria-pressed` value. `structure` stays still because
      // `ATTRIBUTE_ALLOWLIST` drops every `aria-*` attribute — they are resolved
      // into role/name/state instead — so the pressed state reaches exactly one
      // band, and that band is the one a screen reader reads.
      'Chip.selected': ['semantics', 'style'],
      // Two, not one, and this is the row worth arguing about. The words moved,
      // and so did the accessible name, because a `<button>` with no `aria-label`
      // takes its name from its content. A suite that relaxed `text` to stop
      // chasing copy edits would still be told about this — which is right, and
      // was not obvious before it was measured.
      'Chip.label': ['semantics', 'text'],
      // Only the class, so only what it is painted with.
      'Text.tone': ['style'],
      'Text.size': ['style'],
      // A different element and a different implicit role. No `style`, and that
      // is not jsdom being poor: this profile is `declaredStyle` only, and the
      // one author rule in play — `.va-text` — matches the `<span>` and the
      // `<h1>` alike. What separates them is the user-agent cascade, `h1`'s
      // `font-weight: bold` and `display: block`, which reaches nothing until
      // `computedStyle` is on. Asserted below rather than left as a surprise.
      'Text.as': ['structure', 'semantics'],
      'Button.variant': ['style'],
      // All three, and the widest reach in the table. `checked` is on
      // `ATTRIBUTE_ALLOWLIST`, unlike `aria-pressed`, so it lands in `structure`
      // as well as in the announced state and in the class that paints the box.
      // The prop that changes the most is not the one that looks the most
      // different.
      'Toggle.checked': ['structure', 'semantics', 'style'],
    });
  });

  it('reads declared style only, which is why one row above is shorter than it looks', () => {
    // The stated cause for `Text.as` reaching no `style`. If this profile ever
    // gains `computedStyle`, this fails first and the table above is re-measured
    // knowingly rather than quietly acquiring a row.
    expect(JSDOM_PROFILE.declaredStyle).toBe(true);
    expect(JSDOM_PROFILE.computedStyle).toBe(false);
  });

  it('holds everything else still, so a band that did not move is evidence', () => {
    const [tone] = MEASURED.filter((row) => row.contrast.prop === 'tone');
    if (!tone) throw new Error('no tone contrast');

    // `Text.tone` reaches `style` and nothing else, which is what makes the
    // negative usable: a `Text` that moved in `text` was not moved by `tone`.
    expect(tone.held.structure).toBe(tone.varied.structure);
    expect(tone.held.semantics).toBe(tone.varied.semantics);
    expect(tone.held.text).toBe(tone.varied.text);
    expect(tone.held.style).not.toBe(tone.varied.style);
  });

  it('reports nothing when nothing varied', () => {
    const twice = [instanceOf(<Chip label="All" />, 'Chip'), instanceOf(<Chip label="All" />, 'Chip')];
    // The control group for the whole file. Without it, every row above could be
    // measuring collection noise rather than a prop.
    expect(bandsThatMoved(twice[0]!, twice[1]!)).toEqual([]);
    expect(twice[0]!.props).toBe(twice[1]!.props);
    expect(twice[0]!.rendering).toBe(twice[1]!.rendering);
  });

  it('has no geometry to read under jsdom, and says so rather than reporting none moved', () => {
    // Stated as an assertion so that running this file under a layout engine
    // fails here — at which point `geometry` belongs in `BANDS` and the table
    // above gains rows it currently cannot see.
    for (const row of MEASURED) {
      expect(row.held.geometry).toBeUndefined();
      expect(row.varied.geometry).toBeUndefined();
    }
  });
});

describe('what the run cannot do with this today', () => {
  it('can tell that the inputs differ and not which one', () => {
    const held = instanceOf(<Chip label="All" />, 'Chip');
    const label = instanceOf(<Chip label="Active" />, 'Chip');
    const selected = instanceOf(<Chip label="All" selected />, 'Chip');

    // Three different props digests, and no way to get from any pair of them to
    // the name of the prop that moved. The join in this file is supplied by the
    // `CONTRASTS` table — that is, by a person — and spec 0024 is what replaces
    // the person with a per-key digest.
    expect(new Set([held.props, label.props, selected.props]).size).toBe(3);
  });
});
