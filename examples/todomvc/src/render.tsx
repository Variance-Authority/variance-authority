import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { DS_CSS } from './ds/styles.js';
import { TOKENS_CSS } from './tokens/foundation.js';
import type { Mutation } from './mutations.js';
import { setCodeMutations } from './code-mutation.js';
import { storyById } from './stories.js';

/**
 * Render a story, with an optional mutation applied.
 *
 * Sheet order is load-bearing and not incidental: tokens, then the design
 * system, then the mutation. A mutation sheet must arrive last so that a
 * same-specificity override actually wins on document order — otherwise
 * `token-radius` would silently do nothing and the comparison would score a
 * no-op as a passing case.
 */

const SHEET_MARKER = 'data-todomvc-sheet';

export interface RenderOptions {
  readonly mutation?: Mutation;
  /**
   * Several edits applied together, as a branch carries them.
   *
   * Sheet order follows array order, so a later mutation overrides an earlier one
   * at equal specificity — the same rule as a real stylesheet import order.
   */
  readonly mutations?: readonly Mutation[];
}

export interface Rendered {
  readonly container: HTMLElement;
  unmount(): void;
}

/**
 * React roots are cached per container.
 *
 * The session reuses one container across subjects, and `createRoot` on an
 * element that already has a root warns and leaks the previous one. Keeping the
 * root and calling `render` again is what the warning asks for, and it is also
 * faster — the reconciler keeps its fiber tree instead of rebuilding it.
 */
const ROOTS = new WeakMap<HTMLElement, Root>();

export function renderStory(
  container: HTMLElement,
  storyId: string,
  options: RenderOptions = {},
): Rendered {
  const document = container.ownerDocument;
  const mutations = options.mutations ?? (options.mutation ? [options.mutation] : []);

  installSheets(document, mutations);
  setCodeMutations(mutations.filter((each) => each.code).map((each) => each.id));

  const story = storyById(storyId);
  const element = story.render();

  let root = ROOTS.get(container);
  if (!root) {
    root = createRoot(container);
    ROOTS.set(container, root);
  }

  const tree = mutations.some((each) => each.noop) ? wrapInert(element) : element;
  act(() => root!.render(tree));

  return {
    container,
    unmount(): void {
      act(() => root!.render(null));
    },
  };
}

/**
 * Inert wrappers plus generated-class churn: the no-op refactor.
 *
 * The `<div>`s carry no role, no attributes, and no styling, so they contribute
 * nothing to the rendered result — extracting a layout wrapper is among the most
 * common React refactors, and it must not invalidate a baseline. The salted
 * class name models a CSS-in-JS runtime regenerating its hash when any
 * declaration in its file changes, including in an unrelated rule.
 */
function wrapInert(element: ReactNode): ReactNode {
  return (
    <div className={`css-${saltedHash()}`}>
      <div>
        <div>{element}</div>
      </div>
    </div>
  );
}

let salt = 0;
function saltedHash(): string {
  salt += 1;
  return (salt * 2654435761).toString(36).slice(-6);
}

function installSheets(document: Document, mutations: readonly Mutation[]): void {
  for (const existing of Array.from(document.querySelectorAll(`[${SHEET_MARKER}]`))) {
    existing.remove();
  }

  append(document, 'tokens', TOKENS_CSS);
  append(document, 'design-system', DS_CSS);
  for (const mutation of mutations) {
    if (mutation.css) append(document, `mutation:${mutation.id}`, mutation.css);
  }
}

function append(document: Document, name: string, css: string): void {
  const style = document.createElement('style');
  style.setAttribute(SHEET_MARKER, name);
  style.textContent = css;
  document.head.appendChild(style);
}
