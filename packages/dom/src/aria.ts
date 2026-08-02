import type { RawAria } from '@variance-authority/core';

/**
 * Role, accessible name, and state.
 *
 * This is a **partial** implementation of ARIA in HTML and accname, and says so
 * rather than pretending otherwise. Full accname is a specification in its own
 * right — `aria-labelledby` traversal with cycle detection, `::before`/`::after`
 * content, `<table>`/`<select>` special cases, CSS-driven visibility, language
 * fallbacks. What is here covers the constructs component libraries actually
 * emit.
 *
 * The consequence is bounded, and worth being precise about. A role or name this
 * code fails to compute becomes *absent*, and an absent role is a weaker match
 * key (see the differ's `matchKey`) — so the failure mode is a coarser diff and
 * a worse docket label, not a wrong verdict. A role it computed *incorrectly*
 * would be worse, so every mapping below is one where the spec is unambiguous;
 * ambiguous cases yield nothing.
 */

/** HTML elements whose implicit role does not depend on their attributes. */
const IMPLICIT_ROLES: Readonly<Record<string, string>> = {
  article: 'article', aside: 'complementary', button: 'button', datalist: 'listbox',
  dd: 'definition', details: 'group', dialog: 'dialog', dt: 'term', fieldset: 'group',
  figure: 'figure', form: 'form', h1: 'heading', h2: 'heading', h3: 'heading',
  h4: 'heading', h5: 'heading', h6: 'heading', hr: 'separator', main: 'main',
  math: 'math', menu: 'list', meter: 'meter', nav: 'navigation', ol: 'list',
  optgroup: 'group', option: 'option', output: 'status', p: 'paragraph',
  progress: 'progressbar', search: 'search', summary: 'button', table: 'table',
  tbody: 'rowgroup', textarea: 'textbox', tfoot: 'rowgroup', thead: 'rowgroup',
  tr: 'row', ul: 'list', caption: 'caption', legend: 'legend', img: 'img',
};

const INPUT_ROLES: Readonly<Record<string, string>> = {
  button: 'button', checkbox: 'checkbox', email: 'textbox', image: 'button',
  number: 'spinbutton', radio: 'radio', range: 'slider', reset: 'button',
  search: 'searchbox', submit: 'button', tel: 'textbox', text: 'textbox',
  url: 'textbox',
};

export function ariaOf(element: Element): RawAria {
  const description = accessibleDescription(element);

  return {
    role: roleOf(element),
    name: accessibleName(element),
    ...(description !== null ? { description } : {}),
    state: stateOf(element),
  };
}

export function roleOf(element: Element): string | null {
  const explicit = element.getAttribute('role');
  if (explicit) {
    // A role list means "the first one the engine understands". Without a role
    // registry to consult, the first token is the honest reading.
    const first = explicit.trim().split(/\s+/)[0];
    if (first) return first;
  }

  const tag = element.tagName.toLowerCase();

  if (tag === 'input') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    // `<input type="text" list="...">` is a combobox, not a textbox.
    if (type === 'text' && element.hasAttribute('list')) return 'combobox';
    return INPUT_ROLES[type] ?? null;
  }

  if (tag === 'a' || tag === 'area') {
    // Without `href` these are generic, which is the classic accessibility bug
    // and must remain visible rather than be normalized into a link.
    return element.hasAttribute('href') ? 'link' : null;
  }

  if (tag === 'select') {
    const multiple = element.hasAttribute('multiple');
    const size = Number.parseInt(element.getAttribute('size') ?? '1', 10);
    return multiple || size > 1 ? 'listbox' : 'combobox';
  }

  if (tag === 'td' || tag === 'th') {
    // Correct only inside a plain `<table>`; a `role="grid"` ancestor changes
    // these to gridcell. Ancestor-dependent, so deliberately not attempted.
    return tag === 'th' ? 'columnheader' : 'cell';
  }

  if (tag === 'header' || tag === 'footer') {
    // `banner`/`contentinfo` only when not nested in a sectioning element.
    return element.closest('article, aside, main, nav, section') === null
      ? tag === 'header' ? 'banner' : 'contentinfo'
      : null;
  }

  if (tag === 'section') {
    // A `section` is only a `region` once it has an accessible name.
    return accessibleName(element) === null ? null : 'region';
  }

  if (tag === 'img') {
    // `alt=""` is a deliberate declaration that the image is decorative.
    return element.getAttribute('alt') === '' ? 'presentation' : 'img';
  }

  return IMPLICIT_ROLES[tag] ?? null;
}

/**
 * Accessible name, following accname's precedence for the cases covered.
 *
 * Order: `aria-labelledby`, `aria-label`, a native label host, then content.
 */
export function accessibleName(element: Element): string | null {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .trim()
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() ?? '')
      .filter((part) => part.length > 0);
    if (parts.length > 0) return normalize(parts.join(' '));
  }

  const label = element.getAttribute('aria-label');
  if (label && label.trim().length > 0) return normalize(label);

  const tag = element.tagName.toLowerCase();

  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const native = nativeLabelFor(element);
    if (native) return native;

    const placeholder = element.getAttribute('placeholder');
    if (placeholder && placeholder.trim().length > 0) return normalize(placeholder);

    const type = (element.getAttribute('type') ?? '').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'reset') {
      const value = element.getAttribute('value');
      if (value) return normalize(value);
    }

    return null;
  }

  if (tag === 'img' || tag === 'area') {
    const alt = element.getAttribute('alt');
    return alt === null ? null : alt === '' ? null : normalize(alt);
  }

  // Name from content applies only to roles that support it. A generic `<div>`
  // has no accessible name, however much text it contains.
  //
  // Getting this wrong is not cosmetic. Every wrapper `<div>` was being given
  // the concatenated text of its subtree as a name, which made it non-inert to
  // the wrapper-collapse rule — so no wrapper anywhere ever collapsed, and every
  // wrapper-insertion refactor in the corpus reported as a change. One
  // over-eager accname fallback silently disabled a whole normalization rule.
  const role = roleOf(element);
  if (role !== null && NAME_FROM_CONTENT.has(role)) {
    const text = element.textContent;
    if (text && text.trim().length > 0) return normalize(text);
  }

  const title = element.getAttribute('title');
  return title && title.trim().length > 0 ? normalize(title) : null;
}

/**
 * Accessible description: `aria-describedby`, then `title`.
 *
 * The narrower half of accname, and the half that had nowhere to go before this
 * existed. `ATTRIBUTE_ALLOWLIST` drops every `aria-*` attribute because they are
 * "resolved into role/name/state" — which is true of `aria-label` and
 * `aria-selected` and was never true of `aria-describedby`. A form field whose
 * error message was deleted kept its role, its name, its styles and its rect,
 * lost its description, and compared **equal** on every tier this project has.
 *
 * A reference that resolves to nothing yields `null` rather than an empty
 * string, so the delta reads as a description that vanished. That is the whole
 * point: the dangling reference *is* the regression, and the two must not
 * normalize onto each other.
 *
 * `title` is consulted second and only when it did not already become the name,
 * because a `title` on an unnamed element is its name, not its description.
 */
export function accessibleDescription(element: Element): string | null {
  const describedBy = element.getAttribute('aria-describedby');
  if (describedBy) {
    const parts = describedBy
      .trim()
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() ?? '')
      .filter((part) => part.length > 0);
    return parts.length > 0 ? normalize(parts.join(' ')) : null;
  }

  const title = element.getAttribute('title');
  if (!title || title.trim().length === 0) return null;

  return accessibleName(element) === normalize(title) ? null : normalize(title);
}

/**
 * Roles whose accessible name may be computed from their contents (ARIA 1.2
 * §"name from author and content"). Everything else takes a name only from an
 * explicit label or a `title`.
 */
const NAME_FROM_CONTENT = new Set([
  'button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading', 'link',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'row',
  'rowheader', 'switch', 'tab', 'tooltip', 'treeitem', 'term', 'definition',
  'caption', 'legend',
]);

function nativeLabelFor(element: Element): string | null {
  const id = element.getAttribute('id');
  if (id) {
    const escaped = cssEscape(id);
    const label = element.ownerDocument.querySelector(`label[for="${escaped}"]`);
    const text = label?.textContent?.trim();
    if (text) return normalize(text);
  }

  const wrapping = element.closest('label');
  const text = wrapping?.textContent?.trim();
  return text ? normalize(text) : null;
}

/**
 * States, from both ARIA attributes and their native equivalents.
 *
 * A `<input disabled>` and an `<div role="button" aria-disabled="true">` are the
 * same fact reported two ways, and a snapshot that recorded only one would
 * report a real state regression as unchanged whenever a component switched
 * between the native and the ARIA spelling.
 */
export function stateOf(element: Element): Record<string, string | boolean | number> {
  const state: Record<string, string | boolean | number> = {};

  const ariaStates = [
    'checked', 'disabled', 'expanded', 'selected', 'pressed', 'current',
    'invalid', 'required', 'readonly', 'hidden', 'busy', 'live', 'modal',
    'multiselectable', 'sort', 'level', 'valuenow', 'valuemin', 'valuemax',
    'valuetext', 'haspopup', 'setsize', 'posinset', 'placeholder', 'orientation',
  ];

  for (const name of ariaStates) {
    const value = element.getAttribute(`aria-${name}`);
    if (value !== null) state[name] = coerce(value);
  }

  const nativeBooleans = ['disabled', 'checked', 'readonly', 'required', 'hidden', 'open'];
  for (const name of nativeBooleans) {
    if (element.hasAttribute(name)) state[name] = true;
  }

  // `checked` on a live input reflects user interaction; the attribute records
  // only the initial value, which diverges the moment anything is clicked.
  if (element instanceof element.ownerDocument.defaultView!.HTMLInputElement) {
    const input = element as HTMLInputElement;
    if (input.type === 'checkbox' || input.type === 'radio') state['checked'] = input.checked;
  }

  const tag = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag) && state['level'] === undefined) {
    state['level'] = Number.parseInt(tag.slice(1), 10);
  }

  return state;
}

function coerce(value: string): string | boolean | number {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** `CSS.escape` is absent in JSDOM, and an unescaped id breaks the query. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
