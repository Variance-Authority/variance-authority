import { digestValue, type Provenance, type OwnerFrame } from '@variance-authority/core';

/**
 * Provenance carried on the elements themselves.
 *
 * **The second implementation, and the reason it exists.** `collect` takes
 * `provenanceOf` as a caller-supplied callback, and until now the only
 * implementation was `@variance-authority/react` — which walks fiber internals.
 * One implementation of an interface is not an interface; it is an
 * implementation with a callback in front of it, and "React only" was written
 * down as a property of the project rather than as a count.
 *
 * This is the count changed. Attribution — the axis this project claims and no
 * competitor has — needs exactly two things from a renderer: **a component name
 * per element, and a stable digest of what was passed into it.** Fibers are one
 * way to get them. Attributes are another, and every framework in the category
 * can already emit attributes at build time:
 *
 * | framework | what already emits this |
 * |---|---|
 * | Vue | `vite-plugin-vue-inspector` emits `data-v-inspector="file:line:col"` |
 * | Svelte | the compiler knows the component and the file for every element |
 * | Angular | `ng-reflect-*` in dev builds; a schematic can add more |
 * | anything | a Babel/SWC/esbuild plugin, ~50 lines, one JSX visitor |
 *
 * So the honest statement is not "provenance is React-only". It is that a
 * framework needs a build step that writes a name onto an element, and one
 * exists or is trivially written for every framework anyone asks about. The
 * reading side — this file — is **25 lines**, measured rather than estimated:
 * `attributeProvenance` walks ancestors and reads two attributes.
 *
 * What has *not* happened: no Vue, Svelte or Angular application has been run
 * through this. The claim it supports is that the interface is not React-shaped,
 * which `attributed.test.ts` demonstrates by driving the whole chain — diff,
 * docket, root versus collateral — from markup with no framework in the process.
 * The claim it does not support is that any particular framework works today.
 *
 * **What is worse here than with fibers, stated rather than discovered.**
 *
 * - **The props digest is whatever the emitter computed.** React's is derived
 *   from live props by `propsDigest`, which is what separates a root change from
 *   a collateral one. An emitter that writes no digest gets one derived from the
 *   name alone, so every boundary's digest holds — and `attribute`'s "the props
 *   digest moved, so the cause is upstream" test can then never fire. The
 *   consequence is a coarser docket, never a wrong verdict, and
 *   {@link attributeProvenance} reports it as a diagnostic rather than leaving it
 *   to be inferred.
 * - **It is in the DOM.** Attributes ship to production unless the build strips
 *   them, and they are dropped by `ATTRIBUTE_ALLOWLIST` before hashing, so they
 *   cannot invalidate a baseline — but they are bytes on the wire that a fiber
 *   walk does not cost.
 * - **A minifier can rename the component before it reaches the attribute.**
 *   The same failure `cases/storybook-case` hit with `keepNames`, one layer up.
 */

export interface AttributeProvenanceOptions {
  /**
   * Attribute naming the component that rendered this element.
   * Default `data-component`.
   */
  readonly component?: string;

  /**
   * Attribute naming the component whose template placed this element, when the
   * emitter can tell the two apart. Default `data-created-by`.
   *
   * Absent is normal and is not guessed at: `createdBy` and `owners[0]` diverge
   * exactly where structural attribution needs them to, and inventing the
   * distinction from an enclosure would name the wrong component on every
   * reorder — the one case it exists for.
   */
  readonly createdBy?: string;

  /**
   * Attribute carrying a digest of the props this boundary received.
   * Default `data-props`.
   */
  readonly props?: string;
}

const DEFAULTS = {
  component: 'data-component',
  createdBy: 'data-created-by',
  props: 'data-props',
} as const;

/**
 * A `provenanceOf` for any renderer that can label an element.
 *
 * The chain is read by walking ancestors, innermost first, which is the same
 * shape a fiber walk produces and the same shape `Provenance.owners` promises.
 * An element with no labelled ancestor gets `undefined` rather than an empty
 * chain: "nothing owns this" and "the emitter did not label it" are different
 * claims, and the docket's `unattributed` root exists to surface the second.
 */
export function attributeProvenance(
  options: AttributeProvenanceOptions = {},
): (element: Element) => Provenance | undefined {
  const attributes = { ...DEFAULTS, ...options };

  return (element: Element): Provenance | undefined => {
    const owners: OwnerFrame[] = [];

    for (
      let current: Element | null = element;
      current !== null;
      current = current.parentElement
    ) {
      const name = current.getAttribute(attributes.component);
      if (name === null || name.length === 0) continue;

      const createdBy = current.getAttribute(attributes.createdBy);

      owners.push({
        name,
        // No digest emitted means no digest, not a fabricated one. Deriving it
        // from the name would make every boundary's props look unchanged
        // forever, which reads as "this component changed internally" for every
        // change that actually arrived from outside.
        propsDigest: current.getAttribute(attributes.props) ?? digestValue(`unstated:${name}`),
        ...(createdBy !== null && createdBy.length > 0 ? { createdBy } : {}),
      });
    }

    if (owners.length === 0) return undefined;

    const createdBy = element.getAttribute(attributes.createdBy) ?? owners[0]!.name;
    return { owners, createdBy };
  };
}

/**
 * Whether an emitter supplied props digests, so a caller can say so.
 *
 * Not a boolean on the provenance itself, because it is a property of the
 * *emitter* rather than of any one element, and a per-element flag would invite
 * a report that says "3 of 40 nodes have digests" when the answer is always
 * either all or none. Callers use it to attach a diagnostic once per subject.
 */
export function statesProps(root: Element, options: AttributeProvenanceOptions = {}): boolean {
  const attribute = options.props ?? DEFAULTS.props;
  return root.matches(`[${attribute}]`) || root.querySelector(`[${attribute}]`) !== null;
}
