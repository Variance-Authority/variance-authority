import type { Intent, Policy } from '@variance-authority/core';
import { mutationById, type Mutation, type MutationId } from './mutations.js';

/**
 * Branches, not edits.
 *
 * Every measurement in this example so far applied one mutation at a time, which
 * is not what anyone reviews. A branch carries several deliberate changes
 * together — a token, a component, a page — and the question a review actually
 * asks is not *what changed* but **which of the things in front of me is not one
 * I meant to do**.
 *
 * That question is unanswerable from a diff alone, however well attributed. It
 * needs a declaration written before the diff is read, and then it becomes
 * mechanical: everything matching the declaration is authorized and needs no
 * attention; everything else is the finding.
 *
 * The reason this matters more as a branch grows is arithmetic. One accidental
 * change among one deliberate one is easy to spot. One accidental change among
 * four deliberate ones, spread across twenty-three changed screenshots, is not —
 * and the review that misses it is not careless, it is doing the only thing the
 * output allows.
 */

export interface Changeset {
  readonly id: string;
  /** The pull request title a person would write. */
  readonly title: string;
  readonly mutations: readonly MutationId[];
  /** What the author declared. Written from the title, not from the diff. */
  readonly intent: Intent;
  /**
   * Mutations deliberately left out of `intent`.
   *
   * The accidents. Recorded so the assertions can name what should have been
   * caught, rather than checking that *something* was.
   */
  readonly undeclared: readonly MutationId[];
}

export const POLICY: Policy = {
  // Nothing blocks on band alone. A team adopting this needs to be able to start
  // without CI going red on day one, or it gets switched off in week one.
  blocking: [],
  // `Toggle` is an interactive control: it is where accessibility regressions
  // land, and where an undeclared change is a violation rather than a review.
  protectedComponents: ['Toggle'],
};

export const CHANGESETS: readonly Changeset[] = [
  {
    id: 'rebrand',
    title: 'Rebrand: new accent, rounder corners',
    mutations: ['token-accent', 'token-radius'],
    intent: {
      claims: [
        { root: 'token:--va-color-accent', reason: 'new brand accent' },
        { root: 'token:--va-radius-md', reason: 'rounder corners' },
        { root: 'token:--va-radius-sm', reason: 'rounder corners' },
      ],
    },
    undeclared: [],
  },
  {
    id: 'rebrand-with-accident',
    title: 'Rebrand: new accent, rounder corners',
    // The same branch, with a refactor the author did not think of as a change.
    mutations: ['token-accent', 'token-radius', 'broken-toggle'],
    intent: {
      claims: [
        { root: 'token:--va-color-accent', reason: 'new brand accent' },
        { root: 'token:--va-radius-md', reason: 'rounder corners' },
        { root: 'token:--va-radius-sm', reason: 'rounder corners' },
      ],
    },
    undeclared: ['broken-toggle'],
  },
  {
    id: 'density-pass',
    title: 'Density pass: tighter spacing, bigger type, roomier buttons',
    mutations: ['token-space', 'token-type-scale', 'button-padding', 'noop-refactor'],
    intent: {
      claims: [
        { root: 'token:--va-space-3', reason: 'tighter rows', impact: ['layout'] },
        { root: 'token:--va-font-size-md', reason: 'larger body type', impact: ['layout'] },
        { root: 'component:Button', reason: 'roomier buttons', impact: ['layout'] },
      ],
    },
    undeclared: [],
  },
  {
    id: 'density-pass-with-accident',
    title: 'Density pass: tighter spacing, bigger type, roomier buttons',
    // Four deliberate changes and one silent accessibility regression that
    // changes no pixel. This is the case the whole project exists for.
    mutations: [
      'token-space',
      'token-type-scale',
      'button-padding',
      'noop-refactor',
      'label-detached',
    ],
    intent: {
      claims: [
        { root: 'token:--va-space-3', reason: 'tighter rows', impact: ['layout'] },
        { root: 'token:--va-font-size-md', reason: 'larger body type', impact: ['layout'] },
        { root: 'component:Button', reason: 'roomier buttons', impact: ['layout'] },
      ],
    },
    undeclared: ['label-detached'],
  },
  {
    id: 'understated-blast-radius',
    title: 'Tweak the accent on the primary button',
    // Declared truthfully and scoped wrongly. The token is not Button's; it is
    // the product's, and the author has not looked at where else it lands.
    mutations: ['token-accent'],
    intent: {
      claims: [
        {
          root: 'token:--va-color-accent',
          reason: 'tweak the primary button accent',
          maxSubjects: 2,
        },
      ],
    },
    undeclared: [],
  },
  {
    id: 'undelivered',
    title: 'Loosen row spacing',
    // The declaration says a token moves. Nothing does — the edit was lost in a
    // rebase, or the declaration is stale. Both are worth a sentence before merge.
    mutations: [],
    intent: {
      claims: [{ root: 'token:--va-space-3', reason: 'loosen rows' }],
    },
    undeclared: [],
  },
];

export function changesetById(id: string): Changeset {
  const changeset = CHANGESETS.find((candidate) => candidate.id === id);
  if (!changeset) throw new Error(`unknown changeset: ${id}`);
  return changeset;
}

export function mutationsOf(changeset: Changeset): readonly Mutation[] {
  return changeset.mutations.map(mutationById);
}
