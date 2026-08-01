import type { MutationId } from './mutations.js';

/**
 * Code edits, modelled as code edits.
 *
 * The first version of this example threaded `brokenToggle` and `reversedFilters`
 * down as props, which was wrong in a way that produced wrong output rather than
 * merely inelegant output.
 *
 * A prop change and a source change are *different causes* with different
 * correct attributions. §6.2 says a diff explained by changed props at a boundary
 * is a composition change whose root is the prop provider, while a diff
 * originating inside a component with unchanged incoming props is an internal
 * change rooted at that component. Threading the switch as a prop made every
 * source edit look like a composition change — so it was attributed to whichever
 * component happened to be the story's entry point, and the same logical edit
 * produced `TodoApp` in one story and `TodoFooter` in another. Two docket roots
 * for one edit, and neither of them naming the file that changed.
 *
 * Components read the flag directly here, the way they would read their own
 * source. Their props do not move, so the change is correctly rooted at the
 * component whose implementation changed — in every story that renders it.
 */

/**
 * A *set*, not a single value.
 *
 * A branch carries several edits at once — that is what a branch is — and
 * modelling one at a time was the shape that made the head-to-head a toy. The
 * interesting question only appears once changes overlap: which of the five
 * things in front of me is the one I did not mean to do?
 */
let active: ReadonlySet<MutationId> = new Set();

export function setCodeMutations(mutations: readonly MutationId[]): void {
  active = new Set(mutations);
}

export function codeMutationIs(mutation: MutationId): boolean {
  return active.has(mutation);
}
