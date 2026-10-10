import { items } from './dom-list.js';

/**
 * What a form control holds now, where its markup says something else.
 *
 * A play function, a Playwright `fill`, a route restoring a draft: each leaves a
 * control's state in its *properties* — `value`, `checked`, an option's
 * selectedness — and none of them writes an attribute. Markup still says what
 * the server sent, so a document serialized from `outerHTML` paints a form
 * nobody filled in, and a snapshot recording attributes compares one.
 *
 * Both readers ask here, so the document and the snapshot carry the same answer:
 * the attribute, or for a `<textarea>` the text, that makes the markup say what
 * the control holds. A control whose markup already says it gets nothing, which
 * is what keeps every untouched form byte-identical to what it was before this
 * existed.
 *
 * "Already says it" is asked of the engine rather than written down here. An
 * untouched `<input type="color">` holds `#000000` with no `value` attribute, a
 * `range` holds its midpoint, a `number` sanitizes `value="abc"` to nothing, and
 * a `<select>` with no `selected` option shows its first. So a control whose
 * property and attribute disagree is parsed again from its own markup, in an
 * inert document, and only a disagreement that survives the reparse is state.
 *
 * Two values never leave the page. A password field's value is written as one
 * mask character per character typed, which paints the same dots and moves the
 * snapshot when the length moves. A file input's value is `C:\fakepath\` and the
 * name of a file from the user's machine; markup cannot set it, and a reparse
 * holds no file, so a guard keeps it out before the reparse is asked.
 */

const HTML = 'http://www.w3.org/1999/xhtml';

/**
 * Whether a checkbox or a radio is ticked now, or `undefined` for any other element.
 *
 * The one reading of `checked` both the accessibility state and the form state
 * take: the property, which a click moves, and never the attribute, which says
 * only how the markup started.
 */
export function liveChecked(element: Element): boolean | undefined {
  if (element.namespaceURI !== HTML || element.localName !== 'input') return undefined;
  const input = element as HTMLInputElement;
  return input.type === 'checkbox' || input.type === 'radio' ? input.checked : undefined;
}

/** The edit that makes one control's markup say what it holds. */
export type FormEdit =
  | {
      readonly attribute: 'value' | 'checked' | 'selected';
      /** `null` removes the attribute. */
      readonly value: string | null;
    }
  | { readonly text: string };

export interface FormState {
  /** The edit `element` needs, or `undefined` when its markup already says it. */
  editOf(element: Element): FormEdit | undefined;

  /**
   * `root.outerHTML`, with every edit in the subtree written in.
   *
   * The edits go onto a copy imported into an inert document, never onto the
   * page. Writing them on the live tree and taking them off again is not an
   * inspection: adding `selected` back to an option the page's script moved
   * away from re-selects it, and adding `checked` back to a radio its group
   * unchecked unchecks the other one. An inert document has no browsing
   * context, so the copy runs no custom element constructor and fetches
   * nothing. With no edit, the copy is never made.
   */
  serialize(root: Element): string;
}

const CONTROLS = 'input, textarea, option';
const MASK = '•';

/** One reader per acquisition: it remembers each `<select>` it has asked about. */
export function formState(ownerDocument: Document): FormState {
  let inert: Document | undefined;
  const inertDocument = (): Document =>
    (inert ??= ownerDocument.implementation.createHTMLDocument(''));

  const reparse = (element: Element): Element | null => {
    const host = inertDocument().createElement('div');
    host.innerHTML = element.outerHTML;
    return host.firstElementChild;
  };

  const selections = new Map<Element, boolean>();
  const selectionMoved = (select: HTMLSelectElement): boolean => {
    let moved = selections.get(select);
    if (moved !== undefined) return moved;

    const options = items(select.options);
    moved = false;
    if (options.some((option) => option.selected !== option.hasAttribute('selected'))) {
      const parsed = reparse(select) as HTMLSelectElement | null;
      const markup = items(parsed?.options);
      moved = options.some((option, index) => option.selected !== markup[index]?.selected);
    }
    selections.set(select, moved);
    return moved;
  };

  const editOf = (element: Element): FormEdit | undefined => {
    if (element.namespaceURI !== HTML) return undefined;

    switch (element.localName) {
      case 'input': {
        const input = element as HTMLInputElement;
        if (input.type === 'file') return undefined;
        const checked = liveChecked(input);
        if (checked !== undefined) {
          return checked === input.hasAttribute('checked')
            ? undefined
            : { attribute: 'checked', value: checked ? '' : null };
        }
        if (input.value === (input.getAttribute('value') ?? '')) return undefined;
        if ((reparse(input) as HTMLInputElement | null)?.value === input.value) return undefined;
        return { attribute: 'value', value: secret(input) ? masked(input.value) : input.value };
      }
      case 'textarea': {
        const area = element as HTMLTextAreaElement;
        return area.value === area.defaultValue ? undefined : { text: area.value };
      }
      case 'option': {
        const option = element as HTMLOptionElement;
        const select = selectOf(option);
        if (select === null || option.selected === option.hasAttribute('selected')) return undefined;
        if (!selectionMoved(select)) return undefined;
        return { attribute: 'selected', value: option.selected ? '' : null };
      }
      default:
        return undefined;
    }
  };

  return {
    editOf,
    serialize(root) {
      const edits = controlsIn(root).map(editOf);
      if (edits.every((edit) => edit === undefined)) return root.outerHTML;

      const copy = inertDocument().importNode(root, true);
      const copies = controlsIn(copy);
      edits.forEach((edit, index) => {
        const target = copies[index];
        if (edit !== undefined && target !== undefined) apply(target, edit);
      });
      return copy.outerHTML;
    },
  };
}

/**
 * `attributes` as the control's markup would carry them, given its edit.
 *
 * The record the snapshot holds, so a key is added or deleted rather than set to
 * an empty marker: a removed `checked` is absent, as it would be in the markup.
 */
export function editedAttributes(
  attributes: Record<string, string>,
  edit: FormEdit,
): Record<string, string> {
  if (!('attribute' in edit)) return attributes;
  const edited = { ...attributes };
  if (edit.value === null) delete edited[edit.attribute];
  else edited[edit.attribute] = edit.value;
  return edited;
}

function apply(element: Element, edit: FormEdit): void {
  if ('text' in edit) {
    element.textContent = edit.text;
    return;
  }
  if (edit.value === null) element.removeAttribute(edit.attribute);
  else element.setAttribute(edit.attribute, edit.value);
}

/** Every control in `root`'s subtree, `root` included, in document order. */
function controlsIn(root: Element): Element[] {
  return [...(root.matches(CONTROLS) ? [root] : []), ...items(root.querySelectorAll(CONTROLS))];
}

function selectOf(option: Element): HTMLSelectElement | null {
  const parent = option.parentElement;
  const select = parent?.localName === 'optgroup' ? parent.parentElement : parent;
  return select?.localName === 'select' ? (select as HTMLSelectElement) : null;
}

/**
 * A password field, or a field the page says holds one.
 *
 * The `autocomplete` tokens cover a reveal toggle, which switches `type` to
 * `text` and leaves the hint where it was: the value is on screen then, and it
 * is still not ours to carry off the page.
 */
function secret(input: HTMLInputElement): boolean {
  if (input.type === 'password') return true;
  const hint = (input.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/);
  return hint.includes('current-password') || hint.includes('new-password');
}

function masked(value: string): string {
  return MASK.repeat([...value].length);
}
