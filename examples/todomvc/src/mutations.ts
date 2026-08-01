import { DS_OVERRIDES } from './ds/styles.js';
import { TOKEN_OVERRIDES } from './tokens/foundation.js';

/**
 * The change set: what a team actually does to a repository between two builds.
 *
 * Each mutation is a *single* edit a person would make, chosen so the layers are
 * distinguishable — foundation, component, page, and the two cases that separate
 * a semantic tool from a pixel one.
 *
 * The declared fields are the ground truth the comparison is scored against, and
 * they were written from the edit, not from any tool's output.
 */

export type MutationId =
  | 'token-radius'
  | 'token-space'
  | 'token-accent'
  | 'token-type-scale'
  | 'button-padding'
  | 'filter-reorder'
  | 'broken-toggle'
  | 'noop-refactor';

export interface Mutation {
  readonly id: MutationId;
  /** Which layer the edit was made in. */
  readonly layer: 'foundation' | 'design-system' | 'page' | 'none';
  /** Prose a reviewer would write in the PR description. */
  readonly intent: string;

  /** CSS appended to the document, as a theme or component file edit would be. */
  readonly css?: string;
  /**
   * A source edit, read by the component itself rather than passed to it.
   *
   * Modelled this way because a prop change and a source change are different
   * causes with different correct attributions (§6.2), and threading the switch
   * as a prop made every source edit look like a composition change — attributed
   * to whichever component happened to be a story's entry point, so one edit
   * produced a different root in each story. See `code-mutation.ts`.
   */
  readonly code?: boolean;
  /** Insert inert wrappers and churn generated class names. */
  readonly noop?: boolean;

  /**
   * Whether this edit changes what a camera would see.
   *
   * The discriminating field. `false` here plus a real defect is the case a
   * pixel differ is structurally unable to report, whatever its threshold.
   */
  readonly visible: boolean;

  /** What a correct tool should conclude. Declared before any tool was run. */
  readonly expect: {
    readonly roots: number;
    readonly rootKind: 'token' | 'component' | 'prop' | 'none';
    readonly impact: 'layout' | 'paint' | 'composite' | 'mixed' | 'structural' | 'none';
    readonly structureIntact: boolean;
  };
}

export const MUTATIONS: readonly Mutation[] = [
  {
    id: 'token-radius',
    layer: 'foundation',
    intent: 'Round the corners a little more across the product.',
    css: TOKEN_OVERRIDES['token-radius']!,
    visible: true,
    // Two roots for one pull request, and correctly so: the edit moves two
    // tokens, and a docket that merged them would be claiming a shared cause
    // that does not exist. One *edit* is not always one *cause*.
    expect: { roots: 2, rootKind: 'token', impact: 'paint', structureIntact: true },
  },
  {
    id: 'token-space',
    layer: 'foundation',
    intent: 'Loosen the default row spacing.',
    css: TOKEN_OVERRIDES['token-space']!,
    visible: true,
    // The pair that matters: same band and same shape of edit as `token-radius`,
    // opposite answer to "can this have moved anything?".
    expect: { roots: 1, rootKind: 'token', impact: 'layout', structureIntact: true },
  },
  {
    id: 'token-accent',
    layer: 'foundation',
    intent: 'Rebrand: new accent colour.',
    css: TOKEN_OVERRIDES['token-accent']!,
    visible: true,
    expect: { roots: 1, rootKind: 'token', impact: 'paint', structureIntact: true },
  },
  {
    id: 'token-type-scale',
    layer: 'foundation',
    intent: 'Bump the body type one step.',
    css: TOKEN_OVERRIDES['token-type-scale']!,
    visible: true,
    // Typography is layout: glyph advances change, boxes resize, everything after
    // reflows. A tool that files this under "styling" has mis-sold the risk.
    expect: { roots: 1, rootKind: 'token', impact: 'layout', structureIntact: true },
  },
  {
    id: 'button-padding',
    layer: 'design-system',
    intent: 'Give Button more horizontal room.',
    css: DS_OVERRIDES['button-padding']!,
    visible: true,
    expect: { roots: 1, rootKind: 'component', impact: 'layout', structureIntact: true },
  },
  {
    id: 'filter-reorder',
    layer: 'page',
    intent: 'Show the completed filter first.',
    code: true,
    visible: true,
    expect: { roots: 1, rootKind: 'component', impact: 'structural', structureIntact: false },
  },
  {
    id: 'broken-toggle',
    layer: 'page',
    intent: 'Refactor the toggle to a styled div (accidental accessibility regression).',
    code: true,
    // Pixel-identical by construction: the `<div>` carries the same classes and
    // therefore the same box, the same background, the same border, the same
    // radius. A camera sees nothing. A user with a keyboard or a screen reader
    // loses the control entirely.
    visible: false,
    expect: { roots: 1, rootKind: 'component', impact: 'structural', structureIntact: false },
  },
  {
    id: 'noop-refactor',
    layer: 'none',
    intent: 'Extract layout wrappers; rename generated classes.',
    noop: true,
    visible: false,
    expect: { roots: 0, rootKind: 'none', impact: 'none', structureIntact: true },
  },
];

export function mutationById(id: MutationId): Mutation {
  const mutation = MUTATIONS.find((candidate) => candidate.id === id);
  if (!mutation) throw new Error(`unknown mutation: ${id}`);
  return mutation;
}
