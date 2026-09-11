// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '@variance-authority/core/compare';
import { propsDigest, type SemanticSnapshot } from '@variance-authority/core/format';
import { buildDocket } from '@variance-authority/core/judge';
import { normalize } from '@variance-authority/core/rules';
import { collect } from './collect.js';
import { attributeProvenance, statesProps } from './attributed.js';

/**
 * The claim: attribution is not React-shaped.
 *
 * `docs/comparison.md` said "React only for provenance" as if it were a property
 * of the approach. It is a count. The pipeline asks a renderer for two things —
 * a component name per element and a digest of what was passed in — and a build
 * plugin that writes two attributes supplies both. What follows is the same
 * chain the React adapter feeds, driven by markup a Vue, Svelte or Angular build
 * step could have emitted, with no React in the process.
 */

const options = {
  subject: { id: 'story:panel', kind: 'fixture' as const },
  viewport: { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' as const },
  engine: 'jsdom@test',
  fonts: ['Inter/400/normal/deadbeef'],
};

function snapshot(html: string): SemanticSnapshot {
  document.body.innerHTML = `<div id="canvas">${html}</div>`;
  return normalize(
    collect(document.getElementById('canvas')!, {
      ...options,
      provenanceOf: attributeProvenance(),
    }),
  );
}

/**
 * One markup shape, with and without the attributes a build plugin would emit.
 *
 * Written as one template so the two differ in nothing else — whitespace
 * included. The first version of this test wrote the bare markup by hand and the
 * hashes differed over indentation text nodes, which would have looked exactly
 * like the claim being false.
 */
const panel = (label: string, variant: string, labelled = true) => {
  const on = (attributes: string) => (labelled ? ` ${attributes}` : '');

  return (
    `<section${on(`data-component="Panel" data-props="${propsDigest({ title: 'Plan' })}"`)}>` +
    `<h2${on(`data-component="Heading" data-props="${propsDigest({ level: 2 })}"`)}>Plan</h2>` +
    `<button style="background:${variant === 'primary' ? 'rgb(45, 108, 223)' : 'transparent'}"${on(
      `data-component="Button" data-created-by="Panel" data-props="${propsDigest({ variant })}"`,
    )}>${label}</button>` +
    `</section>`
  );
};

/** The first `<button>` in a snapshot, wherever normalization put it. */
function buttonOf(snapshot: SemanticSnapshot) {
  const find = (node: SemanticSnapshot['root']): SemanticSnapshot['root'] | undefined =>
    node.tag === 'button' ? node : node.children.map(find).find((hit) => hit !== undefined);

  return find(snapshot.root)!;
}

describe('provenance from attributes, with no framework in the process', () => {
  it('reads the owner chain innermost first, the same shape a fiber walk gives', () => {
    const button = buttonOf(snapshot(panel('Continue', 'primary')));

    expect(button.provenance?.owners.map((owner) => owner.name)).toEqual(['Button', 'Panel']);
  });

  /**
   * `createdBy` and `owners[0]` diverge exactly where structural attribution
   * needs them to, so the emitter states it rather than the adapter inferring
   * one from the other.
   */
  it('keeps who wrote the element apart from what encloses it', () => {
    const button = buttonOf(snapshot(panel('Continue', 'primary')));

    expect(button.provenance?.createdBy).toBe('Panel');
    expect(button.provenance?.owners[0]?.name).toBe('Button');
  });

  /**
   * "Nothing owns this" and "the emitter did not label it" are different claims,
   * and the docket's `unattributed` root exists to surface the second. An empty
   * chain would make an unlabelled build look like a build with no components.
   */
  it('returns nothing at all for an element no emitter labelled', () => {
    const plain = snapshot('<section><p>hello</p></section>');

    expect(plain.root.children[0]?.provenance).toBe(undefined);
  });

  it('drops its own attributes before hashing, so labelling cannot move a baseline', () => {
    const labelled = snapshot(panel('Continue', 'primary'));

    document.body.innerHTML = `<div id="canvas">${panel('Continue', 'primary', false)}</div>`;
    const bare = normalize(collect(document.getElementById('canvas')!, options));

    // `data-*` is not in `ATTRIBUTE_ALLOWLIST`, so adding a build plugin to an
    // existing project does not invalidate one stored baseline.
    expect(labelled.renderHash).toBe(bare.renderHash);
  });
});

describe('the chain that follows from it', () => {
  /**
   * The whole chain, on attributes alone: a rendered difference becomes a delta,
   * the delta arrives carrying an owner chain, and the docket separates the
   * component the change came *from* from the one it shows up *in*.
   *
   * `Panel` passed a different variant, so `Button`'s incoming props digest
   * moved and the change arrived from outside it. Naming `Button` would send a
   * reviewer to a file nobody edited — the failure `prop-primary-variant/hero`
   * exists to catch on the React path, reproduced here with no React.
   */
  it('separates the component a change came from and the one it shows in', () => {
    const before = snapshot(panel('Continue', 'primary'));
    const after = snapshot(panel('Continue', 'secondary'));

    const docket = buildDocket([diffSnapshots(before, after)]);
    const named = docket.entries.flatMap((entry) =>
      entry.components.map((component) => `${component.role}:${component.name}`),
    );

    expect(docket.entries.map((entry) => `${entry.kind}: ${entry.label}`)).toEqual([
      'prop: Panel → Button',
    ]);
    expect(named).toContain('root:Panel');
    expect(named).toContain('collateral:Button');
  });

  /**
   * The half a digest buys, demonstrated by removing it.
   *
   * `Button`'s props moved, so the change arrived from outside it and `Panel` is
   * where a reviewer should look — that is `attribute`'s whole test, and it can
   * only run on a digest the emitter computed. Without one, every boundary looks
   * unchanged forever and every change reads as internal.
   */
  it('reports a coarser answer when the emitter states no props, and says so', () => {
    const unstated = (label: string) =>
      `<section data-component="Panel"><button data-component="Button">${label}</button></section>`;

    const before = snapshot(unstated('Continue'));
    const after = snapshot(unstated('Proceed'));

    expect(statesProps(document.getElementById('canvas')!)).toBe(false);

    // Still attributed — the name is there, so the docket still names a
    // component and the report still reaches a file. What is lost is the
    // root/collateral question, not the location.
    const docket = buildDocket([diffSnapshots(before, after)]);
    expect(docket.entries.flatMap((e) => e.components.map((c) => c.name))).toContain('Button');
  });

  it('detects that an emitter did state them', () => {
    snapshot(panel('Continue', 'primary'));

    expect(statesProps(document.getElementById('canvas')!)).toBe(true);
  });
});
